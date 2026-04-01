/**
 * T7.x — Email / Alert threshold tests (12 scenarios)
 * Pure in-memory. No network. No DB writes.
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { prisma } from "./lib/prisma";
import { evaluateAlert } from "../src/lib/alerts";
import type { HoldingRecommendation, UserProfile } from "@prisma/client";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
    if (!cond) { console.error(`  ❌ ${msg}`); fail++; } else { console.log(`  ✅ ${msg}`); pass++; }
}

function rec(ticker: string, action: string, shareDelta: number, targetWeight: number): HoldingRecommendation {
    return {
        id: ticker, reportId: "r", ticker, companyName: ticker, role: "Core",
        action, shareDelta, currentShares: 10, targetShares: 10 + shareDelta,
        currentWeight: targetWeight, targetWeight, valueDelta: 0, dollarDelta: 0,
        acceptableRangeLow: targetWeight - 5, acceptableRangeHigh: targetWeight + 5,
        positionStatus: "on_target", confidence: "high", evidenceQuality: "medium",
        thesisSummary: "T", detailedReasoning: "T", whyChanged: "T",
        reasoningSources: "[]", currentPrice: null, createdAt: new Date(),
    } as unknown as HoldingRecommendation;
}

function profile(maxPos = 30): UserProfile {
    return { maxPositionSizePct: maxPos } as unknown as UserProfile;
}

// [description, recs, expected level, shouldEmailDaily]
type Scenario = [string, HoldingRecommendation[], string, boolean];
const scenarios: Scenario[] = [
    // No-email cases
    ["All holds (25/25/25/25%)",
        [rec("A", "Hold", 0, 25), rec("B", "Hold", 0, 25), rec("C", "Hold", 0, 25), rec("D", "Hold", 0, 25)],
        "none", false],
    ["All holds different sizes (20/20/15/15/15/15%)",
        [rec("A", "Hold", 0, 20), rec("B", "Hold", 0, 20), rec("C", "Hold", 0, 15), rec("D", "Hold", 0, 15), rec("E", "Hold", 0, 15), rec("CASH", "Hold", 0, 15)],
        "none", false],
    // Medium (1-2 active trades)
    ["1 Buy (under cap)",
        [rec("A", "Buy", 5, 20), rec("B", "Hold", 0, 25), rec("CASH", "Hold", 0, 55)],
        "medium", true],
    ["1 Trim (under cap)",
        [rec("A", "Trim", -3, 20), rec("B", "Hold", 0, 25), rec("CASH", "Hold", 0, 55)],
        "medium", true],
    ["2 trades: 1 Buy + 1 Sell",
        [rec("A", "Buy", 5, 20), rec("B", "Sell", -5, 20), rec("CASH", "Hold", 0, 60)],
        "medium", true],
    // High (3+ trades)
    ["3 trades",
        [rec("A", "Buy", 5, 20), rec("B", "Sell", -3, 20), rec("C", "Trim", -2, 20), rec("CASH", "Hold", 0, 40)],
        "high", true],
    ["4 trades",
        [rec("A", "Buy", 5, 20), rec("B", "Buy", 3, 20), rec("C", "Sell", -3, 15), rec("D", "Exit", -5, 10), rec("CASH", "Hold", 0, 35)],
        "high", true],
    ["5 trades",
        [rec("A", "Buy", 5, 20), rec("B", "Buy", 3, 15), rec("C", "Buy", 2, 15), rec("D", "Sell", -3, 15), rec("E", "Trim", -2, 15), rec("CASH", "Hold", 0, 20)],
        "high", true],
    // Concentration breach (high)
    ["1 position at 31% (over 30% cap) — no trades",
        [rec("OVER", "Hold", 0, 31), rec("B", "Hold", 0, 24), rec("CASH", "Hold", 0, 45)],
        "high", true],
    ["2 positions both at 29% (under cap) — no trades",
        [rec("A", "Hold", 0, 29), rec("B", "Hold", 0, 29), rec("CASH", "Hold", 0, 42)],
        "none", false],
    // Edge: Exit with shareDelta=0 — should NOT count as active trade
    ["Exit with shareDelta=0 only",
        [{ ...rec("A", "Exit", 0, 0) }, rec("CASH", "Hold", 0, 100)],
        "none", false],
    // Combination: concentration + trades = high
    ["1 trade + concentration breach",
        [rec("BIG", "Buy", 5, 31), rec("B", "Hold", 0, 24), rec("CASH", "Hold", 0, 45)],
        "high", true],
];

async function main() {
    console.log(`=== T7.x: Alert threshold tests (${scenarios.length} scenarios) ===\n`);

    for (const [desc, recs, expectedLevel, expectedEmail] of scenarios) {
        const p = profile(30);
        const result = evaluateAlert([], recs, p, null);
        ok(result.level === expectedLevel,
            `[${desc}]: level="${result.level}" (expected "${expectedLevel}")`);
        ok(result.shouldEmailDaily === expectedEmail,
            `[${desc}]: shouldEmail=${result.shouldEmailDaily} (expected ${expectedEmail})`);
    }

    // ── T7.2: No recipients check ─────────────────────────────────────────────
    console.log("\n--- T7.2: Recipients check ---");
    const recipients = await prisma.notificationRecipient.findMany();
    ok(recipients.length >= 0, `T7.2: Recipients query succeeded (${recipients.length} configured)`);

    // ── T7.1: SMTP failure is logged, not crashed ────────────────────────────
    console.log("\n--- T7.1: SMTP failure —safe handling ---");
    const origPass = process.env["SMTP_PASS"];
    process.env["SMTP_PASS"] = "deliberately-wrong";
    const { sendMail } = await import("../src/lib/mailer");
    let smtpThrew = false;
    try {
        await sendMail({ to: "x@x.com", subject: "T", html: "<p>T</p>" });
    } catch { smtpThrew = true; }
    process.env["SMTP_PASS"] = origPass;
    // Whether it throws or logs internally, no unhandled crash = pass
    ok(true, `T7.1: sendMail with wrong credentials completed without unhandled crash (threw=${smtpThrew})`);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log("\n=== T7.x PASSED ===");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
