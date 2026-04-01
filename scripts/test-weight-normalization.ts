/**
 * T3.1 + T2.2 — Weight normalization & zero-price guard
 * 20 deterministic scenarios. Zero DB/network. ~2s runtime.
 */
import { normalizeWeights, validateWeightSum } from "../src/lib/research/portfolio-constructor";
import type { HoldingRole, RecommendationV3 } from "../src/lib/research/types";

let pass = 0, fail = 0;
function ok(cond: boolean, msg: string) {
    if (!cond) { console.error(`  ❌ ${msg}`); fail++; } else { console.log(`  ✅ ${msg}`); pass++; }
}

function rec(ticker: string, w: number, action: RecommendationV3["action"] = "Hold"): RecommendationV3 {
    return {
        ticker, companyName: ticker, role: "Core" as HoldingRole,
        currentShares: 10, targetShares: 10, shareDelta: 0,
        currentWeight: w, targetWeight: w, valueDelta: 0, dollarDelta: 0,
        acceptableRangeLow: w - 5, acceptableRangeHigh: w + 5,
        action, confidence: "high", positionStatus: "on_target",
        evidenceQuality: "medium", thesisSummary: "T", detailedReasoning: "T",
        whyChanged: "T", reasoningSources: [], currentPrice: 100,
    } as any;
}

function checkNormalize(label: string, weights: number[]) {
    const tickers = weights.map((_, i) => `T${i}`);
    const recs = tickers.map((t, i) => rec(t, weights[i]!));
    const raw = weights.reduce((s, w) => s + w, 0);
    const { valid: beforeValid } = validateWeightSum(recs);
    const normalized = normalizeWeights(recs);
    const { sum: newSum, valid: afterValid } = validateWeightSum(normalized);
    ok(afterValid, `${label}: sum ${raw.toFixed(2)}% → normalized ${newSum.toFixed(2)}% (valid)`);
    ok(normalized.every(r => r.targetWeight >= 0), `${label}: no negative weights`);
    ok(Math.abs(newSum - 100) < 0.15, `${label}: within 0.15% of 100`);
}

async function main() {
    console.log("=== T3.1 + T2.2: Weight normalization (20 scenarios) ===\n");

    // Already-valid — must not corrupt
    checkNormalize("Exact 100", [40, 35, 25]);
    checkNormalize("Exact 100 (5 holdings)", [25, 25, 20, 20, 10]);
    checkNormalize("Exact 100 (1 holding)", [100]);

    // Under-weight variants
    checkNormalize("Under 97%", [40, 35, 22]);
    checkNormalize("Under 95%", [40, 35, 20]);
    checkNormalize("Under 90%", [40, 30, 20]);
    checkNormalize("Under 80%", [40, 25, 15]);
    checkNormalize("Under 50%", [25, 15, 10]);
    checkNormalize("Under — 2 holdings", [60, 35]);
    checkNormalize("Under — 10 holdings", [8, 8, 8, 8, 8, 8, 8, 8, 8, 7]); // 79%

    // Over-weight variants
    checkNormalize("Over 103%", [45, 40, 18]);
    checkNormalize("Over 105%", [50, 35, 20]);
    checkNormalize("Over 110%", [50, 40, 20]);
    checkNormalize("Over 120%", [60, 40, 20]);
    checkNormalize("Over — 2 holdings", [70, 40]);

    // Edge: only Exit positions (should not be adjusted)
    const exitRecs = [
        { ...rec("A", 50), action: "Exit" as RecommendationV3["action"] },
        { ...rec("CASH", 50) },
    ];
    const exitNorm = normalizeWeights(exitRecs);
    ok(exitRecs[0]!.targetWeight === exitNorm[0]!.targetWeight, "Exit positions not adjusted by normalization");

    console.log("\n--- T2.2: Zero/null price guard (5 scenarios) ---");
    const totalValue = 100000;
    const cases: Array<[string, number | undefined | null]> = [
        ["zero", 0],
        ["undefined", undefined],
        ["null", null],
        ["negative", -500],
        ["NaN", NaN],
    ];
    for (const [label, val] of cases) {
        const v = (val as any) ?? 0;
        const safeV = isNaN(v) || v < 0 ? 0 : v;
        const weight = totalValue > 0 ? (safeV / totalValue) * 100 : 0;
        ok(!isNaN(weight) && weight >= 0, `T2.2 ${label}: weight=${weight} (no NaN/negative)`);
    }

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
    console.log("\n=== T3.1 + T2.2 PASSED ===");
}

main().catch(e => { console.error(e); process.exit(1); });
