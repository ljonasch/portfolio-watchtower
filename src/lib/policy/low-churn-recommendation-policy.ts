import type { RecommendationV3, ResearchContext } from "@/lib/research/types";

export const LOW_CHURN_MAX_TOUCHED_POSITIONS = 4;

const LOW_CHURN_MIN_DOLLAR_DELTA_FLOOR = 250;
const LOW_CHURN_MIN_DOLLAR_DELTA_PCT = 0.0035;
const BALANCE_TOLERANCE_WEIGHT = 0.05;

type CandidateActionSide = "buy" | "sell";

interface PolicyCandidate {
  recommendation: RecommendationV3;
  rank: readonly [number, number, number, number, number, string];
  weightDelta: number;
  dollarDelta: number;
  side: CandidateActionSide;
  protectedExit: boolean;
}

export interface ApplyLowChurnPolicyResult {
  recommendations: RecommendationV3[];
  meta: {
    touchedPositions: number;
    protectedExitCount: number;
    suppressedBelowThresholdCount: number;
    suppressedInBandCount: number;
    suppressedByCapCount: number;
    finalWeightDrift: number;
  };
}

function confidenceRank(value: RecommendationV3["confidence"]): number {
  switch (value) {
    case "high":
      return 0;
    case "medium":
      return 1;
    default:
      return 2;
  }
}

function evidenceQualityRank(value: RecommendationV3["evidenceQuality"]): number {
  switch (value) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "mixed":
      return 2;
    default:
      return 3;
  }
}

function actionPriority(value: RecommendationV3["action"]): number {
  switch (value) {
    case "Exit":
    case "Sell":
      return 0;
    case "Add":
    case "Buy":
      return 1;
    case "Trim":
      return 2;
    default:
      return 3;
  }
}

function roundToTwo(value: number): number {
  return Number(value.toFixed(2));
}

function minActionDollarDelta(totalValue: number): number {
  return roundToTwo(Math.max(LOW_CHURN_MIN_DOLLAR_DELTA_FLOOR, totalValue * LOW_CHURN_MIN_DOLLAR_DELTA_PCT));
}

function weightDelta(rec: RecommendationV3): number {
  return roundToTwo((rec.targetWeight ?? 0) - (rec.currentWeight ?? 0));
}

function isCash(rec: RecommendationV3): boolean {
  return rec.ticker === "CASH";
}

function isProtectedExit(rec: RecommendationV3): boolean {
  return rec.action === "Exit" || rec.action === "Sell";
}

function isSellSide(rec: RecommendationV3): boolean {
  return (rec.dollarDelta ?? 0) < 0 || rec.action === "Exit" || rec.action === "Sell" || rec.action === "Trim";
}

function isMaterialChange(
  rec: RecommendationV3,
  totalValue: number,
  noTradeBandPct: number
): boolean {
  const absDollar = Math.abs(rec.dollarDelta ?? 0);
  const absWeight = Math.abs(weightDelta(rec));
  return absDollar >= minActionDollarDelta(totalValue) || absWeight >= noTradeBandPct;
}

function isInsideNoTradeBand(rec: RecommendationV3): boolean {
  if (isProtectedExit(rec)) return false;
  if (rec.currentShares <= 0) return false;
  return rec.currentWeight >= rec.acceptableRangeLow && rec.currentWeight <= rec.acceptableRangeHigh;
}

function buildRank(rec: RecommendationV3): readonly [number, number, number, number, number, string] {
  return [
    actionPriority(rec.action),
    evidenceQualityRank(rec.evidenceQuality),
    confidenceRank(rec.confidence),
    -Math.abs(rec.dollarDelta ?? 0),
    -Math.abs(weightDelta(rec)),
    rec.ticker,
  ] as const;
}

function compareCandidateRank(a: PolicyCandidate, b: PolicyCandidate): number {
  const max = Math.max(a.rank.length, b.rank.length);
  for (let i = 0; i < max; i += 1) {
    const left = a.rank[i];
    const right = b.rank[i];
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

function compareRecommendationTicker(a: RecommendationV3, b: RecommendationV3): number {
  return a.ticker.localeCompare(b.ticker);
}

function appendSystemNote(rec: RecommendationV3, note: string): string {
  return rec.systemNote ? `${rec.systemNote} ${note}` : note;
}

function revertToNoChange(rec: RecommendationV3, note: string): RecommendationV3 | null {
  if (!isCash(rec) && rec.currentShares === 0 && rec.currentWeight === 0) {
    return null;
  }

  return {
    ...rec,
    targetShares: rec.currentShares,
    shareDelta: 0,
    targetWeight: roundToTwo(rec.currentWeight),
    dollarDelta: 0,
    valueDelta: 0,
    action: "Hold",
    systemNote: appendSystemNote(rec, note),
  };
}

function updateCashRecommendation(cash: RecommendationV3, targetWeight: number, context: ResearchContext): RecommendationV3 {
  const safeTargetWeight = roundToTwo(Math.max(0, targetWeight));
  const currentPrice = cash.currentPrice && cash.currentPrice > 0 ? cash.currentPrice : 1;
  const currentTargetValue = (cash.currentWeight / 100) * context.totalValue;
  const nextTargetValue = (safeTargetWeight / 100) * context.totalValue;
  const nextTargetShares = roundToTwo(nextTargetValue / currentPrice);
  const nextShareDelta = roundToTwo(nextTargetShares - cash.currentShares);
  const nextDollarDelta = roundToTwo(nextTargetValue - currentTargetValue);

  return {
    ...cash,
    targetWeight: safeTargetWeight,
    targetShares: nextTargetShares,
    shareDelta: nextShareDelta,
    dollarDelta: nextDollarDelta,
    valueDelta: nextDollarDelta,
    action: nextDollarDelta > 0 ? "Buy" : nextDollarDelta < 0 ? "Trim" : "Hold",
    systemNote: appendSystemNote(
      cash,
      "Low-churn policy used cash as the balancing bucket after trimming lower-priority changes."
    ),
  };
}

function buildCandidate(rec: RecommendationV3): PolicyCandidate {
  const deltaWeight = weightDelta(rec);
  return {
    recommendation: rec,
    rank: buildRank(rec),
    weightDelta: deltaWeight,
    dollarDelta: rec.dollarDelta ?? 0,
    side: isSellSide(rec) ? "sell" : "buy",
    protectedExit: isProtectedExit(rec),
  };
}

function trimForBalance(candidates: PolicyCandidate[]): PolicyCandidate[] {
  const kept = [...candidates];

  const totalWeightDelta = () => kept.reduce((sum, candidate) => sum + candidate.weightDelta, 0);

  while (Math.abs(totalWeightDelta()) > BALANCE_TOLERANCE_WEIGHT && kept.length > 0) {
    const delta = totalWeightDelta();
    const offendingSide: CandidateActionSide = delta > 0 ? "buy" : "sell";
    const removableIndex = [...kept]
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.side === offendingSide && !candidate.protectedExit)
      .sort((left, right) => compareCandidateRank(right.candidate, left.candidate))[0];

    if (!removableIndex) {
      break;
    }

    kept.splice(removableIndex.index, 1);
  }

  return kept;
}

export function applyLowChurnRecommendationPolicy(
  recommendations: RecommendationV3[],
  context: ResearchContext,
  noTradeBandPct: number
): ApplyLowChurnPolicyResult {
  let suppressedBelowThresholdCount = 0;
  let suppressedInBandCount = 0;
  let suppressedByCapCount = 0;

  const cashRecommendation = recommendations.find(isCash) ?? null;
  const nonCashRecommendations = recommendations.filter((rec) => !isCash(rec));
  const keptCandidates: PolicyCandidate[] = [];
  const survivorMap = new Map<string, RecommendationV3>();

  const candidates = nonCashRecommendations.flatMap((rec) => {
    if (!isMaterialChange(rec, context.totalValue, noTradeBandPct)) {
      suppressedBelowThresholdCount += 1;
      const reverted = revertToNoChange(
        rec,
        `Low-churn policy suppressed this action because it did not clear the minimum materiality threshold (${minActionDollarDelta(context.totalValue).toFixed(0)} dollars or ${noTradeBandPct.toFixed(1)}% weight shift).`
      );
      if (reverted) survivorMap.set(reverted.ticker, reverted);
      return [];
    }

    if (isInsideNoTradeBand(rec)) {
      suppressedInBandCount += 1;
      const reverted = revertToNoChange(
        rec,
        "Low-churn policy suppressed this action because the holding was already inside its no-trade tolerance band."
      );
      if (reverted) survivorMap.set(reverted.ticker, reverted);
      return [];
    }

    return [buildCandidate(rec)];
  });

  const sortedCandidates = [...candidates].sort(compareCandidateRank);
  const protectedExits = sortedCandidates.filter((candidate) => candidate.protectedExit);
  const rankedOthers = sortedCandidates.filter((candidate) => !candidate.protectedExit);

  for (const candidate of protectedExits) {
    if (keptCandidates.length >= LOW_CHURN_MAX_TOUCHED_POSITIONS) break;
    keptCandidates.push(candidate);
  }

  for (const candidate of rankedOthers) {
    if (keptCandidates.length >= LOW_CHURN_MAX_TOUCHED_POSITIONS) {
      suppressedByCapCount += 1;
      const reverted = revertToNoChange(
        candidate.recommendation,
        "Low-churn policy deferred this lower-priority action to keep the number of touched positions within the capped change set."
      );
      if (reverted) survivorMap.set(reverted.ticker, reverted);
      continue;
    }

    keptCandidates.push(candidate);
  }

  const balancedCandidates = cashRecommendation ? keptCandidates : trimForBalance(keptCandidates);

  for (const candidate of keptCandidates) {
    if (!balancedCandidates.some((kept) => kept.recommendation.ticker === candidate.recommendation.ticker)) {
      suppressedByCapCount += 1;
      const reverted = revertToNoChange(
        candidate.recommendation,
        "Low-churn policy deferred this action because keeping it would have broken the balanced-dollar recommendation set."
      );
      if (reverted) survivorMap.set(reverted.ticker, reverted);
    }
  }

  for (const candidate of balancedCandidates) {
    survivorMap.set(candidate.recommendation.ticker, candidate.recommendation);
  }

  const finalRecommendations: RecommendationV3[] = [];
  for (const rec of nonCashRecommendations) {
    const next = survivorMap.get(rec.ticker) ?? revertToNoChange(
      rec,
      "Low-churn policy deferred this action after ranking higher-priority portfolio changes."
    );

    if (next) {
      finalRecommendations.push(next);
    }
  }

  finalRecommendations.sort(compareRecommendationTicker);

  if (cashRecommendation) {
    const targetSumWithoutCash = finalRecommendations.reduce((sum, rec) => sum + rec.targetWeight, 0);
    const nextCashTargetWeight = roundToTwo(100 - targetSumWithoutCash);
    finalRecommendations.push(updateCashRecommendation(cashRecommendation, nextCashTargetWeight, context));
  }

  const touchedPositions = finalRecommendations.filter((rec) => !isCash(rec) && Math.abs(rec.shareDelta) > 0).length;
  const finalWeightDrift = roundToTwo(Math.abs(finalRecommendations.reduce((sum, rec) => sum + rec.targetWeight, 0) - 100));

  return {
    recommendations: finalRecommendations,
    meta: {
      touchedPositions,
      protectedExitCount: balancedCandidates.filter((candidate) => candidate.protectedExit).length,
      suppressedBelowThresholdCount,
      suppressedInBandCount,
      suppressedByCapCount,
      finalWeightDrift,
    },
  };
}
