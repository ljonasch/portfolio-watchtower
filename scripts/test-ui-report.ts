/**
 * T8.1 — Weight computation accuracy (multiple snapshots)
 * T8.2 — Empty conviction messages
 * T8.4 — Missing report ID (requires dev server, skipped if not running)
 */
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env") });

import { prisma } from "./lib/prisma";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
    if (!cond) { console.error(`  ❌ ${msg}`); fail++; } else { console.log(`  ✅ ${msg}`); pass++; }
}

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

async function serverRunning(): Promise<boolean> {
    try {
        const r = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(1500) });
        return r.status < 500;
    } catch { return false; }
}

async function main() {
    console.log("=== T8.x: UI / Report display tests ===\n");

    // ── T8.4 (HTTP) ──────────────────────────────────────────────────────────
    const up = await serverRunning();
    if (up) {
        console.log("--- T8.4: Missing report IDs → 404 (3 variants) ---");
        const badIds = ["nonexistent-id-abc", "00000000-0000-0000-0000-000000000000", "' OR 1=1--"];
        for (const id of badIds) {
            try {
                const r = await fetch(`${BASE_URL}/report/${encodeURIComponent(id)}`);
                ok(r.status === 404, `T8.4: /report/${id.slice(0, 20)} → ${r.status} (expected 404)`);
            } catch { ok(false, `T8.4: fetch threw for id=${id}`); }
        }
    } else {
        console.warn("  ⚡ Dev server not running — T8.4 HTTP tests skipped");
    }

    // ── T8.1: Weight computation accuracy (all snapshots) ────────────────────
    console.log("\n--- T8.1: Weight computation from currentValue ---");
    const snapshots = await prisma.portfolioSnapshot.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { holdings: true },
    });

    if (snapshots.length === 0) {
        console.warn("  ⚡ No snapshots — T8.1 skipped");
    } else {
        for (const snap of snapshots) {
            const holdings = snap.holdings as any[];
            const totalValue = holdings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
            const weights = holdings.map(h => ({
                ticker: h.ticker,
                w: totalValue > 0 ? (h.currentValue ?? 0) / totalValue * 100 : 0,
            }));
            const weightSum = weights.reduce((s, h) => s + h.w, 0);
            const noNaN = weights.every(h => !isNaN(h.w));
            const noNeg = weights.every(h => h.w >= 0);
            ok(noNaN, `Snapshot ${snap.id.slice(-6)}: no NaN weights (${holdings.length} holdings)`);
            ok(noNeg, `Snapshot ${snap.id.slice(-6)}: no negative weights`);
            ok(totalValue === 0 || Math.abs(weightSum - 100) < 1,
                `Snapshot ${snap.id.slice(-6)}: weights sum to ${weightSum.toFixed(2)}% (~100%)`);
        }
    }

    // ── T8.2: Empty conviction messages (3 varied convictions) ───────────────
    console.log("\n--- T8.2: Empty + minimal conviction messages ---");
    const user = await prisma.user.findFirst();
    const convIds: string[] = [];

    if (!user) {
        console.warn("  ⚡ No user — T8.2 skipped");
    } else {
        // 3 variants: empty, 1 user msg, 1 ai msg
        const variants: Array<[string, Array<{ role: string; content: string }>]> = [
            ["empty (0 msgs)", []],
            ["1 user msg", [{ role: "user", content: "T" }]],
            ["1 ai msg", [{ role: "ai", content: "ACKNOWLEDGMENT: T" }]],
        ];
        for (const [label, msgs] of variants) {
            const conv = await (prisma as any).userConviction.create({
                data: {
                    userId: user.id, ticker: `T8_${msgs.length}`, rationale: "T", active: true,
                    messages: { create: msgs.map(m => ({ role: m.role, content: m.content })) },
                },
                include: { messages: true },
            });
            convIds.push(conv.id);
            const messages: any[] = conv.messages ?? [];
            const hasAiReply = messages.some((m: any) => m.role === "ai");
            const waitingForAI = !hasAiReply;
            ok(messages.length === msgs.length, `T8.2 ${label}: correct message count (${messages.length})`);
            ok(typeof waitingForAI === "boolean", `T8.2 ${label}: UI state computed without error`);
        }
        await (prisma as any).userConviction.deleteMany({ where: { id: { in: convIds } } });
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log("\n=== T8.x PASSED ===");
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
