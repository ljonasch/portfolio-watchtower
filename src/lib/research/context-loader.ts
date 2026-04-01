/**
 * research/context-loader.ts
 * Assembles the ResearchContext object before any API calls.
 * All profile-derived constraints are computed here, deterministically.
 */

import type {
  ResearchContext,
  HoldingInput,
  PriorRecommendation,
  DerivedConstraints,
} from "./types";

// ─── Speculative cap by risk tolerance ───────────────────────────────────────

function deriveSpeculativeCap(riskTolerance: string | undefined): number {
  const r = (riskTolerance ?? "").toLowerCase();
  if (r === "speculative") return 40;
  if (r === "high") return 20;
  if (r === "medium") return 10;
  return 0; // low risk: no speculative positions
}

function deriveDriftTolerance(profile: Record<string, any>): number {
  // If user has set maxDrawdownTolerancePct, scale drift tolerance proportionally
  // Aggressive = looser drift tolerance (allow more drift before acting)
  // Conservative = tighter drift tolerance
  const riskTolerance = (profile.trackedAccountRiskTolerance ?? "medium").toLowerCase();
  if (riskTolerance === "speculative") return 6;
  if (riskTolerance === "high") return 5;
  if (riskTolerance === "medium") return 4;
  return 3; // low: tighter
}

function deriveCashTarget(profile: Record<string, any>): number {
  const objective = (profile.trackedAccountObjective ?? "").toLowerCase();
  // Income / preservation objectives hold more cash
  if (objective.includes("income") || objective.includes("preservation")) return 8;
  if (objective.includes("growth") || objective.includes("aggressive")) return 3;
  return 5; // default
}

// ─── Main context loader ──────────────────────────────────────────────────────

export function buildResearchContext(opts: {
  profile: Record<string, any>;
  holdings: Array<{
    ticker: string;
    companyName?: string | null;
    shares: number;
    currentPrice?: number | null;
    currentValue?: number | null;
    isCash?: boolean;
    lastBoughtAt?: Date | null;
  }>;
  priorRecommendations?: Array<{
    ticker: string;
    targetShares: number;
    targetWeight: number;
    action: string;
    role?: string | null;
  }>;
  customPrompt?: string;
}): ResearchContext {
  const { profile, holdings, priorRecommendations = [], customPrompt } = opts;

  // Dynamic age — always computed from birthYear, never stored as a static field
  const currentYear = new Date().getFullYear();
  const age = profile.birthYear ? currentYear - profile.birthYear : 0;
  const today = new Date().toISOString().split("T")[0];

  // Compute holding values and weights
  const holdingsWithValues: HoldingInput[] = holdings.map((h) => {
    const computedValue = h.currentValue ?? (h.shares * (h.currentPrice ?? 0));
    return {
      ticker: h.ticker,
      companyName: h.companyName ?? null,
      shares: h.shares,
      currentPrice: h.currentPrice ?? null,
      currentValue: h.currentValue ?? null,
      computedValue,
      computedWeight: 0, // computed after totalValue is known
      isCash: h.isCash ?? false,
      lastBoughtAt: h.lastBoughtAt,
    };
  });

  const totalValue = holdingsWithValues.reduce((sum, h) => sum + h.computedValue, 0);

  // If all computed values are 0 (e.g. prices not yet fetched), fall back to equal
  // weights based on share count so the context is still usable.
  const totalShares = totalValue === 0
    ? holdingsWithValues.filter(h => !h.isCash).reduce((sum, h) => sum + h.shares, 0)
    : 0;

  // Now assign weights
  const holdingsWithWeights: HoldingInput[] = holdingsWithValues.map((h) => ({
    ...h,
    computedWeight: totalValue > 0
      ? Number(((h.computedValue / totalValue) * 100).toFixed(2))
      : (totalShares > 0 && !h.isCash)
        ? Number(((h.shares / totalShares) * 100).toFixed(2))
        : 0,
  }));

  // Derive constraints from actual profile fields
  const constraints: DerivedConstraints = {
    maxSinglePositionPct: profile.maxPositionSizePct ?? 20,
    targetHoldingCount: profile.targetNumberOfHoldings ?? 12,
    speculativeCapPct: deriveSpeculativeCap(profile.trackedAccountRiskTolerance),
    driftTolerancePct: deriveDriftTolerance(profile),
    cashTargetPct: deriveCashTarget(profile),
    maxDrawdownTolerancePct: profile.maxDrawdownTolerancePct ?? 25,
  };

  // Freeze the profile for historical auditability
  const frozenProfileJson = JSON.stringify({
    ...profile,
    _computedAge: age,
    _computedAt: today,
    _constraints: constraints,
  });

  const priorRecs: PriorRecommendation[] = priorRecommendations.map((r) => ({
    ticker: r.ticker,
    targetShares: r.targetShares,
    targetWeight: r.targetWeight,
    action: r.action,
    role: r.role ?? null,
  }));

  return {
    today,
    age,
    profile,
    frozenProfileJson,
    constraints,
    holdings: holdingsWithWeights,
    totalValue,
    priorRecommendations: priorRecs,
    customPrompt,
  };
}
