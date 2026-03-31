/**
 * research/types.ts
 * Shared type definitions for the MVP 3 research pipeline.
 * All pipeline stages use these types to ensure consistency.
 */

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

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
  ticker?: string;
  corrected?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  correctedReport?: Partial<PortfolioReportV3>;
}
