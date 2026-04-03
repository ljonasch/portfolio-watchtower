/**
 * research/types.ts
 * Shared research-pipeline DTOs.
 * Canonical outcome/state/reason contracts now live in @/lib/contracts.
 */

export type {
  BundleReasonCode,
  DegradedReasonCode,
  DeliveryErrorCode,
  RunFailureCode,
} from "@/lib/contracts";

export type LegacyAbstainReason =
  | "finish_reason_length"
  | "empty_response_after_retry"
  | "schema_validation_failed_after_retry"
  | "weight_sum_zero"
  | "incomplete_coverage"
  | "repair_still_invalid"
  | "evidence_packet_persist_failed"
  | "circuit_breaker_open"
  | "CONTEXT_TOO_LONG"
  | "LLM_FAILURE"
  | "VALIDATION_HARD_ERROR";

export type AbstainReason = import("@/lib/contracts").AbstainReasonCode | LegacyAbstainReason;

// ─── Source quality ───────────────────────────────────────────────────────────

export type SourceQuality = "high" | "medium" | "low" | "unknown";

export interface Source {
  title: string;
  url: string;
  quality?: SourceQuality;
  domain?: string;
}

export type EvidenceType = "primary" | "secondary" | "opinion";

export interface EvidenceItem {
  content: string;
  sources: Source[];
  evidenceType: EvidenceType;
  ticker?: string; // if company-specific
  category: "macro" | "company" | "sector";
}

// ─── Research context (assembled before any LLM call) ─────────────────────────

export interface DerivedConstraints {
  maxSinglePositionPct: number;   // from profile.maxPositionSizePct or default 20%
  targetHoldingCount: number;     // from profile.targetNumberOfHoldings or default 12
  speculativeCapPct: number;      // derived from risk tolerance
  driftTolerancePct: number;      // default 4%
  cashTargetPct: number;          // default 5%
  maxDrawdownTolerancePct: number; // from profile or default 25%
}

export interface ResearchContext {
  today: string;                  // ISO date string
  age: number;                    // dynamically computed from birthYear
  profile: Record<string, any>;   // frozen profile snapshot
  frozenProfileJson: string;      // JSON string for storage
  constraints: DerivedConstraints;
  holdings: HoldingInput[];
  totalValue: number;
  priorRecommendations: PriorRecommendation[];
  customPrompt?: string;
}

export interface HoldingInput {
  ticker: string;
  companyName: string | null;
  shares: number;
  currentPrice: number | null;
  currentValue: number | null;
  computedValue: number;
  computedWeight: number;
  isCash: boolean;
  lastBoughtAt?: Date | null;
}

export interface PriorRecommendation {
  ticker: string;
  targetShares: number;
  targetWeight: number;
  action: string;
  role: string | null;
}

// ─── Portfolio construction ───────────────────────────────────────────────────

export interface ConcentrationWarning {
  ticker: string;
  currentWeight: number;
  cap: number;
  severity: "warning" | "breach";
}

export interface OverlapWarning {
  tickers: string[];
  theme: string;
  combinedWeight: number;
}

export interface PortfolioMathSummary {
  totalValue: number;
  cashPct: number;
  speculativeExposurePct: number;
  concentrationWarnings: ConcentrationWarning[];
  overlapWarnings: OverlapWarning[];
  holdingCount: number;
  weightSumCheck: number; // should be ~100
}

// ─── Recommendation output (V3) ───────────────────────────────────────────────

export type HoldingRole =
  | "Core"
  | "Growth"
  | "Tactical"
  | "Hedge"
  | "Speculative"
  | "Income"
  | "Watchlist";

export type ConfidenceLevel = "high" | "medium" | "low";

export type PositionStatus = "underweight" | "overweight" | "on_target";

export type EvidenceQuality = "high" | "medium" | "low" | "mixed";

export interface RecommendationV3 {
  ticker: string;
  companyName: string;
  role: HoldingRole;
  currentShares: number;
  currentPrice: number;
  targetShares: number;
  shareDelta: number;
  dollarDelta: number;
  currentWeight: number;
  targetWeight: number;
  acceptableRangeLow: number;
  acceptableRangeHigh: number;
  valueDelta: number;
  action: "Buy" | "Sell" | "Hold" | "Exit" | "Add" | "Trim";
  confidence: ConfidenceLevel;
  positionStatus: PositionStatus;
  evidenceQuality: EvidenceQuality;
  thesisSummary: string;
  detailedReasoning: string;
  whyChanged: string;
  systemNote?: string;
  reasoningSources: Source[];
}

export interface WatchlistIdeaV3 {
  ticker: string;
  companyName: string;
  role: HoldingRole;
  recommendedStarterShares: number;
  recommendedStarterDollars: number;
  recommendedStarterWeight: number;
  wouldReduceTicker: string | null;
  whyNow: string;
  confidence: ConfidenceLevel;
  profileFitReason: string;
  sources: Source[];
}

export interface PortfolioReportV3 {
  summary: string;
  reasoning: string;
  evidenceQualitySummary: string; // honest meta-assessment
  marketContext: {
    shortTerm: Array<{ factor: string; explanation: string; sources: Source[] }>;
    mediumTerm: Array<{ factor: string; explanation: string; sources: Source[] }>;
    longTerm: Array<{ factor: string; explanation: string; sources: Source[] }>;
  };
  portfolioMath: PortfolioMathSummary;
  recommendations: RecommendationV3[];
  watchlistIdeas: WatchlistIdeaV3[];
}

export interface ValidationError {
  field: string;
  ticker?: string;
  expected?: string;       // what was expected (added Batch 2)
  received?: string;       // what was received
  corrected?: boolean;
  correctionApplied?: string;
  // kept for backward compat with validator layer
  message?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  correctedReport?: Partial<PortfolioReportV3>;
}

// ─── New shared types added in Batch 2 ───────────────────────────────────────

// Candidate universe — deterministic output of candidate_universe_filter
export interface Candidate {
  ticker: string;
  companyName: string;
  reason: string;
  sectorGap: string | null;
  weightGap: number | null;
  source: "sector_gap" | "weight_gap" | "watchlist";
}
export type CandidateList = Candidate[]; // max 5 items

// Market regime — gpt-5.4-mini output, schemaVersion enforced at write
export interface MarketRegime {
  schemaVersion: 1;
  trend: "bull" | "bear" | "sideways";
  volatilityRegime: "low" | "normal" | "high" | "extreme";
  riskOnOffSignal: "risk-on" | "neutral" | "risk-off";
  summary: string;       // max 200 chars
  generatedAt: string;   // ISO timestamp
  modelUsed: string;
}

// News types — structured output of news_ingestion_and_dedup
export interface NewsArticle {
  title: string;
  source: string;
  publishedAt: string;
  url: string;
  snippet: string;
  qualityTag: "high" | "medium" | "low";
  ticker: string | null;
}

export interface NewsResult {
  combinedSummary: string;
  breaking24h: NewsArticle[];
  allSources: NewsArticle[];
  usingFallback: boolean;
  fetchedAt: string;
}

export interface AbstainResult {
  type: "abstain";
  reason: AbstainReason;
  stage: string;
  retryCount: number;
  validationErrors?: ValidationError[];
  runId: string;
  timestamp: string;
}

export class AnalysisAbstainedError extends Error {
  readonly result: AbstainResult;

  constructor(result: AbstainResult, detail?: string) {
    super(detail ? `Analysis abstained (${result.reason}): ${detail}` : `Analysis abstained (${result.reason})`);
    this.name = "AnalysisAbstainedError";
    this.result = result;
  }
}

// Retry utility config — used by withRetry (implemented Batch 3)
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  abortOnLengthError?: boolean;
}
