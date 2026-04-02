/**
 * research/portfolio-constructor.ts
 * Deterministic portfolio math engine.
 * All constraint enforcement happens here, not inside the LLM.
 * The LLM proposes targets; this module validates and enforces them.
 */

import type {
  ResearchContext,
  PortfolioMathSummary,
  ConcentrationWarning,
  OverlapWarning,
  RecommendationV3,
  HoldingRole,
} from "./types";

// ─── Known sector/theme groupings for overlap detection ───────────────────────

const SECTOR_GROUPS: Record<string, string[]> = {
  "AI & Semiconductors": ["NVDA", "AMD", "INTC", "QCOM", "AVGO", "ARM", "SMCI", "TSM", "ASML", "MRVL"],
  "Big Tech / Cloud": ["MSFT", "GOOGL", "GOOG", "AMZN", "META", "AAPL", "CRM", "ORCL", "SNOW"],
  "Defense": ["LMT", "RTX", "NOC", "GD", "BA", "HII", "LDOS", "CACI", "AXON", "PLTR"],
  "Energy": ["XOM", "CVX", "COP", "SLB", "OXY", "MPC", "VLO", "PSX", "EOG", "PXD"],
  "Financials": ["JPM", "BAC", "WFC", "GS", "MS", "BLK", "C", "AXP", "V", "MA"],
  "Healthcare": ["JNJ", "UNH", "ABT", "TMO", "PFE", "MRK", "ABBV", "DHR", "BMY", "AMGN"],
  "Consumer Discretionary": ["TSLA", "AMZN", "HD", "NKE", "MCD", "SBUX", "LOW", "TGT", "BKNG"],
  "REITs": ["O", "VICI", "AMT", "SBAC", "PLD", "EQR", "WY", "IRM"],
};

// ─── Weight sum validation ────────────────────────────────────────────────────

export function validateWeightSum(recommendations: RecommendationV3[]): {
  sum: number;
  valid: boolean;
  drift: number;
} {
  const sum = recommendations.reduce((acc, r) => acc + r.targetWeight, 0);
  const drift = Math.abs(sum - 100);
  return { sum: Number(sum.toFixed(2)), valid: drift <= 0.5, drift: Number(drift.toFixed(2)) };
}

// ─── Normalize weights to exactly 100% ───────────────────────────────────────

export function normalizeWeights(recommendations: RecommendationV3[]): RecommendationV3[] {
  // Edge-case: if LLM literally gave 0 weights for everything, fall back to pure math
  const allZero = recommendations.every(r => r.targetWeight === 0);
  if (allZero) {
    const totalTarget = recommendations.reduce((acc, r) => acc + (r.targetShares * (r.currentPrice || 0)), 0);
    return recommendations.map(r => {
      const w = totalTarget > 0 ? (r.targetShares * (r.currentPrice || 0) / totalTarget) * 100 : 0;
      return { ...r, targetWeight: Number(w.toFixed(2)) };
    });
  }

  let currentSum = recommendations.reduce((acc, r) => acc + r.targetWeight, 0);
  if (Math.abs(currentSum - 100) < 0.05) return recommendations;

  const hasCash = recommendations.some(r => r.ticker === "CASH");

  // Scenario 1: Underspent (sum < 100) and we possess a CASH holding to absorb it.
  if (currentSum < 100 && hasCash) {
    const missing = 100 - currentSum;
    return recommendations.map(r => {
      if (r.ticker === "CASH") {
        return { ...r, targetWeight: Number((r.targetWeight + missing).toFixed(2)) };
      }
      return r;
    });
  }

  // Scenario 2: Overspent (sum > 100) OR we are underspent but have no CASH position.
  // In this highly invalid state, we must scale all positions proportionally to hit 100.
  const scale = 100 / currentSum;
  return recommendations.map(r => {
    const newTargetWeight = Number((r.targetWeight * scale).toFixed(2));
    
    // Scale the shares to perfectly trace the rescaled weight.
    let newTargetShares = r.targetShares;
    let expectedDelta = r.shareDelta;
    if (r.currentPrice && r.currentPrice > 0 && r.targetWeight > 0) {
      // e.g. if we scale by 0.8x, we must lower targetShares by 0.8x
      newTargetShares = Math.round((r.targetShares * scale) * 100) / 100;
      expectedDelta = Number((newTargetShares - r.currentShares).toFixed(2));
    }
    
    return { 
      ...r, 
      targetWeight: newTargetWeight,
      targetShares: newTargetShares,
      shareDelta: expectedDelta
    };
  });
}

// ─── Compute dollar delta ─────────────────────────────────────────────────────

export function computeDollarDelta(
  rec: RecommendationV3,
  totalValue: number
): number {
  const targetDollars = (rec.targetWeight / 100) * totalValue;
  const currentDollars = (rec.currentWeight / 100) * totalValue;
  return Number((targetDollars - currentDollars).toFixed(2));
}

// ─── Compute acceptable ranges ────────────────────────────────────────────────

export function computeAcceptableRange(
  targetWeight: number,
  driftTolerancePct: number,
  role: HoldingRole
): { low: number; high: number } {
  // Core positions get tighter drift tolerance
  // Speculative / Tactical positions get looser
  const roleDriftMultiplier: Record<HoldingRole, number> = {
    Core: 0.75,
    Income: 0.75,
    Hedge: 0.75,
    Growth: 1.0,
    Tactical: 1.25,
    Speculative: 1.5,
    Watchlist: 1.5,
  };
  const multiplier = roleDriftMultiplier[role] ?? 1.0;
  const tolerance = driftTolerancePct * multiplier;

  return {
    low: Number(Math.max(0, targetWeight - tolerance).toFixed(1)),
    high: Number((targetWeight + tolerance).toFixed(1)),
  };
}

// ─── Detect concentration warnings ───────────────────────────────────────────

export function detectConcentrationWarnings(
  recommendations: RecommendationV3[],
  maxSinglePositionPct: number
): ConcentrationWarning[] {
  return recommendations
    .filter((r) => r.ticker !== "CASH" && r.targetWeight > maxSinglePositionPct * 0.9)
    .map((r) => ({
      ticker: r.ticker,
      currentWeight: r.currentWeight,
      cap: maxSinglePositionPct,
      severity: r.targetWeight > maxSinglePositionPct ? "breach" : "warning",
    }));
}

// ─── Detect sector overlap warnings ──────────────────────────────────────────

export function detectOverlapWarnings(
  recommendations: RecommendationV3[],
  thresholdPct = 40
): OverlapWarning[] {
  const warnings: OverlapWarning[] = [];
  const recMap = new Map(recommendations.map((r) => [r.ticker, r]));

  for (const [theme, tickers] of Object.entries(SECTOR_GROUPS)) {
    const held = tickers.filter((t) => recMap.has(t));
    if (held.length < 2) continue;
    const combinedWeight = held.reduce(
      (sum, t) => sum + (recMap.get(t)?.targetWeight ?? 0),
      0
    );
    if (combinedWeight >= thresholdPct) {
      warnings.push({ tickers: held, theme, combinedWeight: Number(combinedWeight.toFixed(1)) });
    }
  }

  return warnings;
}

// ─── Compute speculative exposure ─────────────────────────────────────────────

export function computeSpeculativeExposure(recommendations: RecommendationV3[]): number {
  return Number(
    recommendations
      .filter((r) => r.role === "Speculative" && r.ticker !== "CASH")
      .reduce((sum, r) => sum + r.targetWeight, 0)
      .toFixed(1)
  );
}

// ─── Full portfolio math summary ─────────────────────────────────────────────

export function buildPortfolioMathSummary(
  recommendations: RecommendationV3[],
  context: ResearchContext
): PortfolioMathSummary {
  const { constraints, totalValue } = context;

  const cashRec = recommendations.find((r) => r.ticker === "CASH");
  const cashPct = cashRec?.targetWeight ?? 0;
  const speculativeExposurePct = computeSpeculativeExposure(recommendations);
  const concentrationWarnings = detectConcentrationWarnings(
    recommendations,
    constraints.maxSinglePositionPct
  );
  const overlapWarnings = detectOverlapWarnings(recommendations);
  const { sum } = validateWeightSum(recommendations);

  return {
    totalValue,
    cashPct: Number(cashPct.toFixed(1)),
    speculativeExposurePct,
    concentrationWarnings,
    overlapWarnings,
    holdingCount: recommendations.filter((r) => r.ticker !== "CASH").length,
    weightSumCheck: sum,
  };
}

// ─── Enforce speculative cap ──────────────────────────────────────────────────

export function enforceSpeculativeCap(
  recommendations: RecommendationV3[],
  speculativeCapPct: number
): RecommendationV3[] {
  if (speculativeCapPct <= 0) return recommendations;

  const speculativeRecs = recommendations.filter((r) => r.role === "Speculative");
  const totalSpecWeight = speculativeRecs.reduce((sum, r) => sum + r.targetWeight, 0);

  if (totalSpecWeight <= speculativeCapPct) return recommendations;

  // Scale speculative positions down proportionally
  const scaleFactor = speculativeCapPct / totalSpecWeight;
  const freedWeight = totalSpecWeight - speculativeCapPct;

  // Find the largest non-speculative, non-cash hold to absorb freed weight
  const largestCore = [...recommendations]
    .filter((r) => r.role !== "Speculative" && r.ticker !== "CASH")
    .sort((a, b) => b.targetWeight - a.targetWeight)[0];

  return recommendations.map((r) => {
    if (r.role === "Speculative") {
      const newWeight = Number((r.targetWeight * scaleFactor).toFixed(2));
      const newShares = r.currentPrice
        ? Math.round((newWeight / 100) * (recommendations.reduce((s, rec) => s + rec.targetWeight, 0)) / r.currentPrice)
        : r.targetShares;
      return { ...r, targetWeight: newWeight, targetShares: newShares };
    }
    if (largestCore && r.ticker === largestCore.ticker) {
      return { ...r, targetWeight: Number((r.targetWeight + freedWeight).toFixed(2)) };
    }
    return r;
  });
}

// ─── Enforce max single position cap ─────────────────────────────────────────

export function enforcePositionCap(
  recommendations: RecommendationV3[],
  maxSinglePositionPct: number
): RecommendationV3[] {
  if (maxSinglePositionPct <= 0 || maxSinglePositionPct >= 100) return recommendations;

  let totalReduction = 0;

  const capped = recommendations.map(r => {
    if (r.ticker !== "CASH" && r.targetWeight > maxSinglePositionPct) {
      const reduction = r.targetWeight - maxSinglePositionPct;
      totalReduction += reduction;
      // Recompute shares proportionally based on targetWeight
      // Note: assumes total weight sum is approx 100
      const newShares = r.currentPrice && r.currentPrice > 0
        ? Math.round((maxSinglePositionPct / r.targetWeight) * r.targetShares)
        : r.targetShares;
      return { ...r, targetWeight: maxSinglePositionPct, targetShares: newShares };
    }
    return r;
  });

  if (totalReduction === 0) return capped;

  // Add the freed weight to CASH
  return capped.map(r => {
    if (r.ticker === "CASH") {
      return { ...r, targetWeight: Number((r.targetWeight + totalReduction).toFixed(2)) };
    }
    return r;
  });
}

// ─── Enrich recommendations with computed math ────────────────────────────────

export function enrichRecommendationsWithMath(
  recommendations: RecommendationV3[],
  context: ResearchContext
): RecommendationV3[] {
  const { constraints, totalValue } = context;

  return recommendations.map((r) => {
    const range = computeAcceptableRange(
      r.targetWeight,
      constraints.driftTolerancePct,
      r.role as HoldingRole
    );
    const dollarDelta = computeDollarDelta(r, totalValue);
    const positionStatus =
      r.currentWeight < range.low
        ? "underweight"
        : r.currentWeight > range.high
        ? "overweight"
        : "on_target";

    return {
      ...r,
      acceptableRangeLow: range.low,
      acceptableRangeHigh: range.high,
      dollarDelta,
      positionStatus,
    };
  });
}
