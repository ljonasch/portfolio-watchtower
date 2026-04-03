import {
  applyAntiChurnOverride,
  enforceFinalRecommendationConsistency,
} from "@/lib/analyzer";
import type { RecommendationV3 } from "@/lib/research/types";

function buildRecommendation(
  overrides: Partial<RecommendationV3> & Pick<RecommendationV3, "ticker">
): RecommendationV3 {
  return {
    ticker: overrides.ticker,
    companyName: overrides.companyName ?? overrides.ticker,
    role: overrides.role ?? "Core",
    currentShares: overrides.currentShares ?? 10,
    currentPrice: overrides.currentPrice ?? 100,
    targetShares: overrides.targetShares ?? 10,
    shareDelta: overrides.shareDelta ?? 0,
    dollarDelta: overrides.dollarDelta ?? 0,
    currentWeight: overrides.currentWeight ?? 10,
    targetWeight: overrides.targetWeight ?? 10,
    acceptableRangeLow: overrides.acceptableRangeLow ?? 8,
    acceptableRangeHigh: overrides.acceptableRangeHigh ?? 12,
    valueDelta: overrides.valueDelta ?? overrides.dollarDelta ?? 0,
    action: overrides.action ?? "Hold",
    confidence: overrides.confidence ?? "medium",
    positionStatus: overrides.positionStatus ?? "on_target",
    evidenceQuality: overrides.evidenceQuality ?? "medium",
    thesisSummary: overrides.thesisSummary ?? "Thesis",
    detailedReasoning: overrides.detailedReasoning ?? "Detailed reasoning",
    whyChanged: overrides.whyChanged ?? "Original rationale.",
    systemNote: overrides.systemNote,
    reasoningSources: overrides.reasoningSources ?? [],
  };
}

describe("analyzer action consistency", () => {
  test("below-threshold anti-churn suppression collapses a row into true Hold semantics", () => {
    const [rec] = applyAntiChurnOverride([
      buildRecommendation({
        ticker: "NVDA",
        currentShares: 10,
        targetShares: 11,
        shareDelta: 1,
        currentWeight: 10,
        targetWeight: 10.8,
        dollarDelta: 80,
        valueDelta: 80,
        action: "Buy",
        whyChanged: "Model wanted to restore a little exposure after earnings.",
      }),
    ], 1.5);

    expect(rec).toEqual(expect.objectContaining({
      action: "Hold",
      targetShares: 10,
      shareDelta: 0,
      targetWeight: 10,
      dollarDelta: 0,
      valueDelta: 0,
    }));
    expect(rec.whyChanged).toContain("Anti-churn override deferred this below-threshold rebalance");
    expect(rec.whyChanged).toContain("Original rationale:");
    expect(rec.systemNote).toContain("Target shares and deltas were reset to preserve Hold semantics");
  });

  test("materially different current size for the same ticker still preserves a warranted non-Hold action", () => {
    const [rec] = applyAntiChurnOverride([
      buildRecommendation({
        ticker: "NVDA",
        currentShares: 2,
        targetShares: 8,
        shareDelta: 6,
        currentWeight: 2,
        targetWeight: 8,
        dollarDelta: 600,
        valueDelta: 600,
        action: "Buy",
        whyChanged: "Model wants to rebuild exposure materially.",
      }),
    ], 1.5);

    expect(rec).toEqual(expect.objectContaining({
      action: "Buy",
      targetShares: 8,
      shareDelta: 6,
      targetWeight: 8,
      dollarDelta: 600,
    }));
  });

  test("final consistency guard restores a non-Hold action when post-processing leaves a material delta on Hold", () => {
    const [rec] = enforceFinalRecommendationConsistency([
      buildRecommendation({
        ticker: "AAPL",
        currentShares: 10,
        targetShares: 15,
        shareDelta: 5,
        currentWeight: 10,
        targetWeight: 15,
        dollarDelta: 500,
        valueDelta: 500,
        action: "Hold",
        whyChanged: "Restore exposure after conviction improved.",
      }),
    ]);

    expect(rec.action).toBe("Buy");
    expect(rec.systemNote).toContain('Final consistency guard restored action "Buy"');
    expect(rec.whyChanged).toContain('Final consistency guard restored action "Buy"');
    expect(rec.whyChanged).toContain("Original rationale:");
  });
});
