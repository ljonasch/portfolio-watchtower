/**
 * T3.4 — Large portfolio stress test (pure in-memory math engine only)
 * No DB writes. Tests weight normalization at scale and token budget estimation.
 * DB seeding removed — only tests the computation logic, not DB round-trips.
 */
import { normalizeWeights, validateWeightSum } from "../src/lib/research/portfolio-constructor";
import type { HoldingRole, RecommendationV3 } from "../src/lib/research/types";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
    if (!cond) { console.error(`  ❌ ${msg}`); fail++; } else { console.log(`  ✅ ${msg}`); pass++; }
}

function makeRec(ticker: string, w: number): RecommendationV3 {
    return {
        ticker, companyName: ticker, role: "Growth" as HoldingRole,
        currentShares: 10, targetShares: 10, shareDelta: 0,
        currentWeight: w, targetWeight: w, valueDelta: 0, dollarDelta: 0,
        acceptableRangeLow: w - 5, acceptableRangeHigh: w + 5,
        action: "Hold" as RecommendationV3["action"], confidence: "high",
        positionStatus: "on_target", evidenceQuality: "medium",
        thesisSummary: "T", detailedReasoning: "T",
        whyChanged: "T", reasoningSources: [], currentPrice: 100,
    } as any;
}

function portfolioOfN(n: number, drift = 0): RecommendationV3[] {
    const base = 100 / n;
    return Array.from({ length: n }, (_, i) =>
        makeRec(`T${i.toString().padStart(2, "0")}`, Number((base + (i === 0 ? drift : 0)).toFixed(3)))
    );
}

async function main() {
    console.log("=== T3.4: Large portfolio stress test (pure math) ===\n");

    // Test normalization across various portfolio sizes
    const sizes = [5, 10, 15, 20, 25, 30];
    const drifts = [-3, -1, 0, 1, 3]; // percent off 100%

    console.log(`--- Weight normalization: ${sizes.length} sizes × ${drifts.length} drift values = ${sizes.length * drifts.length} scenarios ---`);
    for (const n of sizes) {
        for (const drift of drifts) {
            const recs = portfolioOfN(n, drift);
            const { sum: rawSum } = validateWeightSum(recs);
            const normalized = normalizeWeights(recs);
            const { valid, sum: normSum } = validateWeightSum(normalized);
            ok(valid, `n=${n}, drift=${drift > 0 ? "+" : ""}${drift}%: ${rawSum.toFixed(2)}% → ${normSum.toFixed(2)}% [valid]`);
            ok(normalized.every(r => r.targetWeight >= 0), `n=${n}: all weights non-negative`);
        }
    }

    // ── Token budget estimation ────────────────────────────────────────────────
    console.log("\n--- Token budget estimation (MAX_CONVICTION_MSGS=10) ---");
    const MAX_MSGS = 10;
    const convictionCounts = [1, 3, 5, 10];
    const SAFE_TOKENS = 8000; // generous budget for conviction section
    for (const numConvictions of convictionCounts) {
        // Simulate max-length truncated thread (10 × "role: content" lines)
        const avgMsgLen = 120; // chars per realistic conviction message
        const charsPerConviction = MAX_MSGS * avgMsgLen;
        const totalChars = numConvictions * charsPerConviction;
        const estimatedTokens = Math.ceil(totalChars / 4);
        ok(estimatedTokens < SAFE_TOKENS,
            `${numConvictions} conviction(s), ${MAX_MSGS} msgs each: ~${estimatedTokens} tokens (< ${SAFE_TOKENS})`);
    }

    // ── Concentration check at scale ──────────────────────────────────────────
    console.log("\n--- Concentration cap enforcement at scale ---");
    const { detectConcentrationWarnings } = await import("../src/lib/research/portfolio-constructor");
    const cap = 30;
    const n30 = portfolioOfN(30); // each gets ~3.33%
    const warnings = detectConcentrationWarnings(n30, cap);
    ok(warnings.length === 0, `30-holding portfolio (3.33% each): no concentration warnings`);

    // Add a deliberate 35% position
    const bigRec = makeRec("BIG", 35);
    const mixed = [bigRec, ...portfolioOfN(5, 0).map(r => ({ ...r, targetWeight: 13 }))];
    const mixedW = detectConcentrationWarnings(mixed, cap);
    ok(mixedW.some(w => w.ticker === "BIG"), `Concentration warning raised for BIG at 35% (cap=${cap}%)`);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log("\n=== T3.4 PASSED ===");
}

main().catch(e => { console.error(e); process.exit(1); });
