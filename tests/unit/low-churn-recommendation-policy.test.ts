import { applyLowChurnRecommendationPolicy, LOW_CHURN_MAX_TOUCHED_POSITIONS } from "@/lib/policy/low-churn-recommendation-policy";
import type { RecommendationV3, ResearchContext } from "@/lib/research/types";

function buildContext(): ResearchContext {
  return {
    today: "2026-04-02",
    age: 40,
    profile: {},
    frozenProfileJson: "{}",
    constraints: {
      maxSinglePositionPct: 20,
      targetHoldingCount: 10,
      speculativeCapPct: 10,
      driftTolerancePct: 1.5,
      cashTargetPct: 5,
      maxDrawdownTolerancePct: 25,
    },
    holdings: [
      { ticker: "AAPL", companyName: "Apple", shares: 10, currentPrice: 100, currentValue: 1000, computedValue: 1000, computedWeight: 20, isCash: false },
      { ticker: "MSFT", companyName: "Microsoft", shares: 10, currentPrice: 100, currentValue: 1000, computedValue: 1000, computedWeight: 20, isCash: false },
      { ticker: "NVDA", companyName: "NVIDIA", shares: 10, currentPrice: 100, currentValue: 1000, computedValue: 1000, computedWeight: 20, isCash: false },
      { ticker: "AVGO", companyName: "Broadcom", shares: 10, currentPrice: 100, currentValue: 1000, computedValue: 1000, computedWeight: 20, isCash: false },
      { ticker: "CASH", companyName: "Cash", shares: 2000, currentPrice: 1, currentValue: 1000, computedValue: 1000, computedWeight: 20, isCash: true },
    ],
    totalValue: 5000,
    priorRecommendations: [],
  };
}

function buildRecommendation(overrides: Partial<RecommendationV3> & Pick<RecommendationV3, "ticker">): RecommendationV3 {
  const currentWeight = overrides.currentWeight ?? 20;
  const targetWeight = overrides.targetWeight ?? currentWeight;
  const currentShares = overrides.currentShares ?? 10;
  const targetShares = overrides.targetShares ?? currentShares;
  const currentPrice = overrides.currentPrice ?? 100;

  return {
    ticker: overrides.ticker,
    companyName: overrides.companyName ?? overrides.ticker,
    role: overrides.role ?? "Core",
    currentShares,
    currentPrice,
    targetShares,
    shareDelta: overrides.shareDelta ?? Number((targetShares - currentShares).toFixed(2)),
    dollarDelta: overrides.dollarDelta ?? Number((((targetWeight - currentWeight) / 100) * 5000).toFixed(2)),
    currentWeight,
    targetWeight,
    acceptableRangeLow: overrides.acceptableRangeLow ?? 18.5,
    acceptableRangeHigh: overrides.acceptableRangeHigh ?? 21.5,
    valueDelta: overrides.valueDelta ?? Number((((targetWeight - currentWeight) / 100) * 5000).toFixed(2)),
    action: overrides.action ?? "Hold",
    confidence: overrides.confidence ?? "medium",
    positionStatus: overrides.positionStatus ?? "on_target",
    evidenceQuality: overrides.evidenceQuality ?? "medium",
    thesisSummary: overrides.thesisSummary ?? "Thesis",
    detailedReasoning: overrides.detailedReasoning ?? "Detailed",
    whyChanged: overrides.whyChanged ?? "Changed",
    reasoningSources: overrides.reasoningSources ?? [],
    systemNote: overrides.systemNote,
  };
}

describe("low-churn recommendation policy", () => {
  test("drops micro-adjustments below the materiality threshold", () => {
    const context = buildContext();
    const result = applyLowChurnRecommendationPolicy([
      buildRecommendation({
        ticker: "AAPL",
        targetWeight: 20.4,
        targetShares: 10.2,
        shareDelta: 0.2,
        action: "Buy",
      }),
      buildRecommendation({ ticker: "MSFT" }),
      buildRecommendation({ ticker: "NVDA" }),
      buildRecommendation({ ticker: "AVGO" }),
      buildRecommendation({ ticker: "CASH", currentWeight: 20, targetWeight: 19.6, currentPrice: 1, currentShares: 1000, targetShares: 980, action: "Trim" }),
    ], context, 1.5);

    const aapl = result.recommendations.find((rec) => rec.ticker === "AAPL");
    expect(aapl).toEqual(expect.objectContaining({
      action: "Hold",
      shareDelta: 0,
      dollarDelta: 0,
    }));
    expect(result.meta.suppressedBelowThresholdCount).toBeGreaterThan(0);
  });

  test("suppresses non-exit changes already inside the no-trade band", () => {
    const context = buildContext();
    const result = applyLowChurnRecommendationPolicy([
      buildRecommendation({
        ticker: "AAPL",
        currentWeight: 20,
        targetWeight: 22,
        acceptableRangeLow: 18,
        acceptableRangeHigh: 22,
        targetShares: 11,
        action: "Buy",
      }),
      buildRecommendation({ ticker: "MSFT" }),
      buildRecommendation({ ticker: "NVDA" }),
      buildRecommendation({ ticker: "AVGO" }),
      buildRecommendation({ ticker: "CASH", currentWeight: 20, targetWeight: 18, currentPrice: 1, currentShares: 1000, targetShares: 900, action: "Trim" }),
    ], context, 1.5);

    expect(result.recommendations.find((rec) => rec.ticker === "AAPL")).toEqual(
      expect.objectContaining({
        action: "Hold",
        shareDelta: 0,
      })
    );
    expect(result.meta.suppressedInBandCount).toBeGreaterThan(0);
  });

  test("caps touched positions deterministically while preserving the top-ranked actions", () => {
    const context = buildContext();
    const result = applyLowChurnRecommendationPolicy([
      buildRecommendation({ ticker: "AAPL", targetWeight: 10, targetShares: 5, action: "Trim", confidence: "low", evidenceQuality: "low", acceptableRangeLow: 8.5, acceptableRangeHigh: 11.5 }),
      buildRecommendation({ ticker: "MSFT", targetWeight: 30, targetShares: 15, action: "Buy", confidence: "high", evidenceQuality: "high", acceptableRangeLow: 28.5, acceptableRangeHigh: 31.5 }),
      buildRecommendation({ ticker: "NVDA", targetWeight: 30, targetShares: 15, action: "Buy", confidence: "medium", evidenceQuality: "high", acceptableRangeLow: 28.5, acceptableRangeHigh: 31.5 }),
      buildRecommendation({ ticker: "AVGO", targetWeight: 10, targetShares: 5, action: "Trim", confidence: "high", evidenceQuality: "high", acceptableRangeLow: 8.5, acceptableRangeHigh: 11.5 }),
      buildRecommendation({ ticker: "AMD", currentWeight: 0, targetWeight: 10, currentShares: 0, targetShares: 5, action: "Buy", confidence: "high", evidenceQuality: "high", acceptableRangeLow: 8.5, acceptableRangeHigh: 11.5 }),
      buildRecommendation({ ticker: "CASH", currentWeight: 20, targetWeight: 10, currentPrice: 1, currentShares: 1000, targetShares: 500, action: "Trim" }),
    ], context, 1.5);

    const touched = result.recommendations.filter((rec) => rec.ticker !== "CASH" && rec.shareDelta !== 0);
    expect(touched.length).toBeLessThanOrEqual(LOW_CHURN_MAX_TOUCHED_POSITIONS);
    expect(touched.map((rec) => rec.ticker)).toEqual(["AMD", "AVGO", "MSFT", "NVDA"]);
  });

  test("protects high-priority exits ahead of lower-priority adds under the cap", () => {
    const context = buildContext();
    const result = applyLowChurnRecommendationPolicy([
      buildRecommendation({ ticker: "AAPL", targetWeight: 0, targetShares: 0, action: "Exit", confidence: "high", evidenceQuality: "high", acceptableRangeLow: 0, acceptableRangeHigh: 1.5 }),
      buildRecommendation({ ticker: "MSFT", targetWeight: 0, targetShares: 0, action: "Sell", confidence: "high", evidenceQuality: "medium", acceptableRangeLow: 0, acceptableRangeHigh: 1.5 }),
      buildRecommendation({ ticker: "NVDA", targetWeight: 35, targetShares: 17.5, action: "Buy", confidence: "high", evidenceQuality: "high", acceptableRangeLow: 33.5, acceptableRangeHigh: 36.5 }),
      buildRecommendation({ ticker: "AVGO", targetWeight: 25, targetShares: 12.5, action: "Buy", confidence: "medium", evidenceQuality: "high", acceptableRangeLow: 23.5, acceptableRangeHigh: 26.5 }),
      buildRecommendation({ ticker: "AMD", currentWeight: 0, targetWeight: 20, currentShares: 0, targetShares: 10, action: "Add", confidence: "high", evidenceQuality: "medium", acceptableRangeLow: 18.5, acceptableRangeHigh: 21.5 }),
      buildRecommendation({ ticker: "CASH", currentWeight: 20, targetWeight: 20, currentPrice: 1, currentShares: 1000, targetShares: 1000, action: "Hold" }),
    ], context, 1.5);

    const touchedTickers = result.recommendations.filter((rec) => rec.ticker !== "CASH" && rec.shareDelta !== 0).map((rec) => rec.ticker);
    expect(touchedTickers).toContain("AAPL");
    expect(touchedTickers).toContain("MSFT");
    expect(result.meta.protectedExitCount).toBe(2);
  });

  test("preserves balanced-dollar behavior by rebalancing through cash", () => {
    const context = buildContext();
    const result = applyLowChurnRecommendationPolicy([
      buildRecommendation({ ticker: "AAPL", targetWeight: 10, targetShares: 5, action: "Trim", confidence: "high", evidenceQuality: "high", acceptableRangeLow: 8.5, acceptableRangeHigh: 11.5 }),
      buildRecommendation({ ticker: "MSFT", targetWeight: 30, targetShares: 15, action: "Buy", confidence: "high", evidenceQuality: "high", acceptableRangeLow: 28.5, acceptableRangeHigh: 31.5 }),
      buildRecommendation({ ticker: "NVDA" }),
      buildRecommendation({ ticker: "AVGO" }),
      buildRecommendation({ ticker: "CASH", currentWeight: 20, targetWeight: 20, currentPrice: 1, currentShares: 1000, targetShares: 1000, action: "Hold" }),
    ], context, 1.5);

    const totalTargetWeight = result.recommendations.reduce((sum, rec) => sum + rec.targetWeight, 0);
    const cash = result.recommendations.find((rec) => rec.ticker === "CASH");

    expect(Number(totalTargetWeight.toFixed(2))).toBe(100);
    expect(cash).toEqual(expect.objectContaining({
      targetWeight: 20,
      shareDelta: 0,
    }));
  });
});
