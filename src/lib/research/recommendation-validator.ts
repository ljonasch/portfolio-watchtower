/**
 * research/recommendation-validator.ts
 * Validates and deterministically corrects LLM recommendation outputs
 * before they are persisted to the database.
 * Returns structured validation errors rather than throwing exceptions.
 */

import type {
  PortfolioReportV3,
  RecommendationV3,
  ValidationResult,
  ValidationError,
  HoldingRole,
  ConfidenceLevel,
  EvidenceQuality,
} from "./types";
import { validateWeightSum, normalizeWeights } from "./portfolio-constructor";

// ─── Allowed enum values ──────────────────────────────────────────────────────

const VALID_ROLES: HoldingRole[] = [
  "Core", "Growth", "Tactical", "Hedge", "Speculative", "Income", "Watchlist",
];

const VALID_ACTIONS = new Set(["Buy", "Sell", "Hold", "Exit", "Trim"]);

const VALID_CONFIDENCE: ConfidenceLevel[] = ["high", "medium", "low"];

const VALID_EVIDENCE_QUALITY: EvidenceQuality[] = ["high", "medium", "low", "mixed"];

const VALID_POSITION_STATUS = new Set(["underweight", "overweight", "on_target"]);

// ─── Normalizers ──────────────────────────────────────────────────────────────

function normalizeRole(raw: string | undefined | null): HoldingRole {
  if (!raw) return "Growth";
  const titleCase = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  if (VALID_ROLES.includes(titleCase as HoldingRole)) return titleCase as HoldingRole;
  // Fuzzy match
  if (raw.toLowerCase().includes("core")) return "Core";
  if (raw.toLowerCase().includes("spec")) return "Speculative";
  if (raw.toLowerCase().includes("income")) return "Income";
  if (raw.toLowerCase().includes("hedge")) return "Hedge";
  if (raw.toLowerCase().includes("tactical")) return "Tactical";
  if (raw.toLowerCase().includes("watch")) return "Watchlist";
  return "Growth"; // safe default
}

function normalizeAction(raw: string | undefined | null): RecommendationV3["action"] {
  if (!raw) return "Hold";
  if (raw.trim().toLowerCase() === "add") return "Buy";
  const candidates = ["Buy", "Sell", "Hold", "Exit", "Trim"];
  const found = candidates.find((a) => a.toLowerCase() === raw.trim().toLowerCase());
  return (found as RecommendationV3["action"]) ?? "Hold";
}

function normalizeConfidence(raw: string | undefined | null): ConfidenceLevel {
  const lower = (raw ?? "").toLowerCase();
  if (lower === "high") return "high";
  if (lower === "low") return "low";
  return "medium";
}

function normalizeEvidenceQuality(raw: string | undefined | null): EvidenceQuality {
  const lower = (raw ?? "").toLowerCase();
  if (VALID_EVIDENCE_QUALITY.includes(lower as EvidenceQuality)) return lower as EvidenceQuality;
  return "medium";
}

// ─── Per-recommendation validation ───────────────────────────────────────────

function validateRecommendation(
  rec: Partial<RecommendationV3>,
  index: number,
  totalValue: number
): { errors: ValidationError[]; warnings: ValidationError[]; corrected: RecommendationV3 } {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  const ticker = rec.ticker ?? `[index ${index}]`;

  // Required fields
  if (!rec.ticker) {
    errors.push({ field: "ticker", message: "Missing ticker", ticker });
  }
  if (rec.targetShares === undefined || rec.targetShares === null) {
    errors.push({ field: "targetShares", message: "Missing targetShares", ticker });
  }
  if (rec.targetWeight === undefined || rec.targetWeight === null) {
    errors.push({ field: "targetWeight", message: "Missing targetWeight", ticker });
  }

  // Role normalization
  const correctedRole = normalizeRole(rec.role);
  if (rec.role && !VALID_ROLES.includes(rec.role as HoldingRole)) {
    warnings.push({
      field: "role",
      message: `Invalid role "${rec.role}" normalized to "${correctedRole}"`,
      ticker: ticker,
      corrected: true,
    });
  }

  // Math consistency: shareDelta should equal targetShares - currentShares
  const expectedDelta = (rec.targetShares ?? 0) - (rec.currentShares ?? 0);

  // Action normalization & Hard Math Override
  let correctedAction = normalizeAction(rec.action);
  if (expectedDelta > 0 && (rec.currentShares ?? 0) === 0) correctedAction = "Buy";
  else if (expectedDelta > 0 && (rec.currentShares ?? 0) > 0) correctedAction = "Buy";
  else if (expectedDelta < 0 && (rec.targetShares ?? 0) === 0) correctedAction = "Exit";
  else if (expectedDelta < 0 && (rec.targetShares ?? 0) > 0) correctedAction = "Trim";
  else if (expectedDelta === 0) correctedAction = "Hold";

  if (rec.action && !VALID_ACTIONS.has(rec.action)) {
    warnings.push({
      field: "action",
      message: `Invalid action "${rec.action}" normalized to "${correctedAction}"`,
      ticker,
      corrected: true,
    });
  }

  const reportedDelta = rec.shareDelta ?? 0;
  if (Math.abs(expectedDelta - reportedDelta) > 0.5) {
    warnings.push({
      field: "shareDelta",
      message: `shareDelta mismatch: reported ${reportedDelta}, expected ${expectedDelta.toFixed(1)}`,
      ticker,
      corrected: true,
    });
  }

  // Dollar delta: compute deterministically
  const currentPrice = rec.currentPrice ?? 0;
  const deterministicDollarDelta = currentPrice > 0
    ? Number(((expectedDelta) * currentPrice).toFixed(2))
    : (rec.dollarDelta ?? 0);

  // Weight vs price sanity check — the LLM frequently hallucinates targetWeight that contradicts targetShares.
  // We MUST mathematically enforce that targetWeight == (targetShares * price) / totalValue
  let finalTargetWeight = rec.targetWeight ?? 0;
  if (currentPrice > 0 && totalValue > 0 && rec.targetShares !== undefined) {
    const impliedWeight = Number(((rec.targetShares * currentPrice / totalValue) * 100).toFixed(2));
    if (Math.abs(impliedWeight - finalTargetWeight) > 0.1) {
      warnings.push({
        field: "targetWeight",
        message: `Overriding hallucinated targetWeight ${finalTargetWeight}% with mathematically correct implied weight ${impliedWeight}% (from ${rec.targetShares} shares × $${currentPrice})`,
        ticker,
        corrected: true,
      });
      finalTargetWeight = impliedWeight;
    }
  }

  // Confidence normalization
  const correctedConfidence = normalizeConfidence(rec.confidence);

  // Build corrected recommendation
  const corrected: RecommendationV3 = {
    ticker: rec.ticker ?? "",
    companyName: rec.companyName ?? rec.ticker ?? "",
    role: correctedRole,
    currentShares: rec.currentShares ?? 0,
    currentPrice: currentPrice,
    targetShares: rec.targetShares ?? 0,
    shareDelta: Number(expectedDelta.toFixed(2)),
    dollarDelta: deterministicDollarDelta,
    currentWeight: rec.currentWeight ?? 0,
    targetWeight: finalTargetWeight,
    acceptableRangeLow: rec.acceptableRangeLow ?? Math.max(0, finalTargetWeight - 4),
    acceptableRangeHigh: rec.acceptableRangeHigh ?? (finalTargetWeight + 4),
    valueDelta: rec.valueDelta ?? deterministicDollarDelta,
    action: correctedAction,
    confidence: correctedConfidence,
    positionStatus: VALID_POSITION_STATUS.has(rec.positionStatus ?? "")
      ? (rec.positionStatus as RecommendationV3["positionStatus"])
      : "on_target",
    evidenceQuality: normalizeEvidenceQuality(rec.evidenceQuality),
    thesisSummary: rec.thesisSummary ?? "",
    detailedReasoning: rec.detailedReasoning ?? "",
    whyChanged: rec.whyChanged ?? "No prior recommendation for comparison.",
    reasoningSources: rec.reasoningSources ?? [],
  };

  return { errors, warnings, corrected };
}

// ─── Full report validation ───────────────────────────────────────────────────

export function validatePortfolioReport(
  rawReport: Partial<PortfolioReportV3>,
  totalValue: number
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!rawReport.summary) {
    errors.push({ field: "summary", message: "Report is missing summary" });
  }
  if (!rawReport.recommendations || rawReport.recommendations.length === 0) {
    errors.push({ field: "recommendations", message: "Report has no recommendations" });
    return { valid: false, errors, warnings };
  }

  // Per-recommendation validation
  const correctedRecs: RecommendationV3[] = [];
  const seenTickers = new Set<string>();

  for (let i = 0; i < rawReport.recommendations.length; i++) {
    const rec = rawReport.recommendations[i];

    // Deduplicate by ticker
    if (seenTickers.has(rec?.ticker ?? "")) {
      warnings.push({
        field: "ticker",
        message: `Duplicate ticker "${rec?.ticker}" removed`,
        ticker: rec?.ticker,
        corrected: true,
      });
      continue;
    }
    seenTickers.add(rec?.ticker ?? "");

    const { errors: recErrors, warnings: recWarnings, corrected } = validateRecommendation(
      rec,
      i,
      totalValue
    );
    errors.push(...recErrors);
    warnings.push(...recWarnings);
    correctedRecs.push(corrected);
  }

  // Weight sum validation and normalization
  const { sum, valid: weightValid, drift } = validateWeightSum(correctedRecs);
  if (!weightValid) {
    warnings.push({
      field: "targetWeight",
      message: `Weights sum to ${sum}% (drift: ${drift}%) — normalizing to 100%`,
      corrected: true,
    });
    const normalized = normalizeWeights(correctedRecs);
    correctedRecs.splice(0, correctedRecs.length, ...normalized);
  }

  const correctedReport: Partial<PortfolioReportV3> = {
    ...rawReport,
    recommendations: correctedRecs,
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    correctedReport,
  };
}
