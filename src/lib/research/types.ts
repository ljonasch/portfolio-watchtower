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
  | "STAGE3_PREFLIGHT_BUDGET_EXCEEDED"
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

// ─── Gap analysis + macro environment ────────────────────────────────────────

export interface GapItem {
  type: "critical" | "opportunity" | "redundancy" | "mismatch";
  description: string;
  affectedTickers?: string[];
  priority: number;
}

export type MacroQueryFamilyKey =
  | "rates_inflation_central_banks"
  | "recession_labor_growth"
  | "energy_commodities"
  | "geopolitics_shipping_supply_chain"
  | "regulation_export_controls_ai_policy"
  | "credit_liquidity_banking_stress"
  | "defense_fiscal_industrial_policy";

export type MacroThemeKey =
  | "higher_for_longer_rates"
  | "growth_slowdown_risk"
  | "energy_supply_tightness"
  | "shipping_disruption"
  | "ai_policy_export_controls"
  | "credit_liquidity_stress"
  | "defense_fiscal_upcycle";

export type MacroCandidateLaneKey =
  | "rate_resilience"
  | "defense_fiscal_beneficiaries"
  | "energy_supply_chain"
  | "shipping_resilience"
  | "ai_infrastructure_policy"
  | "liquidity_defense";

export interface MacroNewsArticle {
  articleId: string;
  canonicalUrl: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
  publishedAtBucket: string;
  trusted: boolean;
  queryFamily: MacroQueryFamilyKey;
  retrievalReason: string;
  topicHints: string[];
  dedupKey: string;
  stableSortKey: string;
  evidenceHash: string;
}

export interface MacroNewsEnvironmentResult {
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason: NewsDegradedReason | null;
  statusSummary: string;
  articleCount: number;
  trustedArticleCount: number;
  distinctPublisherCount: number;
  sourceDiversity: {
    distinctPublishers: number;
    trustedPublishers: number;
    trustedRatio: number;
  };
  issues: NewsFetchIssue[];
  articles: MacroNewsArticle[];
}

export interface MacroThemeConsensus {
  themeId: string;
  themeKey: MacroThemeKey;
  themeLabel: string;
  queryFamilies: MacroQueryFamilyKey[];
  supportingArticleIds: string[];
  counterArticleIds: string[];
  supportingArticleCount: number;
  trustedSupportingCount: number;
  distinctPublisherCount: number;
  supportRatio: number;
  contradictionLevel: "low" | "medium" | "high";
  recentSupportingCount7d: number;
  confidence: "high" | "medium" | "low";
  severity: "high" | "medium" | "low";
  actionable: boolean;
  exposureTags: string[];
  candidateSearchTags: string[];
  summary: string;
}

export interface MacroThemeConsensusResult {
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason: NewsDegradedReason | null;
  thresholds: {
    minSupportingArticles: number;
    minTrustedSupportingArticles: number;
    minDistinctPublishers: number;
    minSupportRatio: number;
    minRecentSupportingArticles7d: number;
  };
  statusSummary: string;
  themes: MacroThemeConsensus[];
}

export interface MacroExposureBridgeRule {
  ruleId: string;
  label: string;
  themeKeys: MacroThemeKey[];
  matchTokens: string[];
  emittedExposureTags: string[];
  emittedEnvironmentalGapHints: string[];
  emittedLaneHints: MacroCandidateLaneKey[];
  emittedSectorTags: string[];
  emittedSensitivityTags: string[];
}

export interface MacroExposureBridgeHit {
  bridgeHitId: string;
  ruleId: string;
  themeId: string;
  matchedToken: string;
  exposureTags: string[];
  environmentalGapHints: string[];
  laneHints: MacroCandidateLaneKey[];
  sectorTags: string[];
  sensitivityTags: string[];
  rationaleSummary: string;
}

export interface MacroExposureBridgeResult {
  statusSummary: string;
  hits: MacroExposureBridgeHit[];
}

export interface EnvironmentalGap {
  gapId: string;
  themeId: string;
  themeKey: MacroThemeKey;
  bridgeRuleIds: string[];
  description: string;
  authority: "environmental";
  urgency: "high" | "medium" | "low";
  exposureTags: string[];
  candidateSearchTags: string[];
  reviewCurrentHoldings: boolean;
  reviewCandidates: boolean;
  openCandidateDiscovery: boolean;
  regimeAlignment: "aligned" | "neutral" | "countervailing";
  profileAlignment: "aligned" | "neutral" | "conflicted";
  rationaleSummary: string;
}

export interface CandidateSearchLane {
  laneId: string;
  laneKey: MacroCandidateLaneKey;
  description: string;
  allowedAssetClasses: string[];
  searchTags: string[];
  priority: number;
  sortBehavior: "priority_then_ticker";
  origin: "environmental_gap";
  themeIds: string[];
  environmentalGapIds: string[];
  bridgeRuleIds: string[];
  rationaleSummary: string;
}

export interface FrozenMacroEvidencePacket {
  schemaVersion: "macro_evidence_v1";
  replayContextFingerprint?: string;
  macroEnvironment: MacroNewsEnvironmentResult;
  actionableThemeIds: string[];
  bridgeHitIds: string[];
  macroBridge: MacroExposureBridgeResult;
  environmentalGapIds: string[];
  candidateLaneIds: string[];
}

export interface GapReport {
  gaps: GapItem[];
  structuralGaps: GapItem[];
  environmentalGaps: EnvironmentalGap[];
  candidateSearchLanes: CandidateSearchLane[];
  searchBrief: string;
  profilePreferences: string;
}

export type StageProviderPressureResultState =
  | "fresh"
  | "reused"
  | "cache_hit"
  | "frozen_artifact_reuse";

export interface StageProviderPressureDiagnostics {
  providerCallCount: number;
  retryCount: number;
  totalBackoffSeconds: number;
  maxSingleBackoffSeconds: number;
  stageLatencyMs: number;
  resultState: StageProviderPressureResultState;
  reuseSourceBundleId: string | null;
  reuseMissReason: string | null;
}

export interface GapAnalysisDiagnostics extends StageProviderPressureDiagnostics {
  fingerprint: string;
  reuseHit: boolean;
}

export interface GapAnalysisArtifact {
  fingerprint: string;
  report: GapReport;
  diagnostics: GapAnalysisDiagnostics;
}

export interface GapAnalysisResult {
  report: GapReport;
  diagnostics: GapAnalysisDiagnostics;
}

export interface MacroEnvironmentDiagnostics extends StageProviderPressureDiagnostics {
  replayContextFingerprint: string;
  reuseHit: boolean;
  queryFamilyCountAttempted: number;
  queryFamilyCountWithArticles: number;
  queryFamilyKeysAttempted: MacroQueryFamilyKey[];
  queryFamilyKeysWithArticles: MacroQueryFamilyKey[];
}

export interface MacroEnvironmentCollectionResult {
  macroEnvironment: MacroNewsEnvironmentResult;
  diagnostics: MacroEnvironmentDiagnostics;
}

export interface TickerNewsDiagnostics extends StageProviderPressureDiagnostics {
  requestFingerprint: string;
  materialTickerSet: string[];
  queryMode: string;
  selectionContract: string;
  articleSetFingerprint: string | null;
  reuseHit: boolean;
  rawArticleCountFetched: number;
  normalizedArticleCountRetained: number;
  droppedArticleCount: number;
  freshnessDecisionReason: string | null;
}

export interface TickerNewsArtifact {
  schemaVersion: "ticker_news_v1";
  requestFingerprint: string;
  materialTickerSet: string[];
  queryMode: string;
  selectionContract: string;
  articleSetFingerprint: string | null;
  newsResult: NewsResult;
}

export interface TickerNewsFetchResult {
  newsResult: NewsResult;
  diagnostics: TickerNewsDiagnostics;
}

export interface MarketDataHelperDiagnostics extends StageProviderPressureDiagnostics {
  helperCallCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  inputTickerCount: number;
  outputTickerCount: number;
  freshnessDecisionReason: string | null;
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

export type ScreenedCandidateSource = "gap_screener" | "macro_lane" | "momentum";

export interface ScreenedCandidate {
  ticker: string;
  companyName: string;
  source: ScreenedCandidateSource;
  candidateOrigin: "structural" | "macro_lane";
  reason: string;
  catalyst?: string;
  analystRating?: string;
  validatedPrice?: number;
  discoveryLaneId?: string | null;
  macroThemeIds?: string[];
  environmentalGapIds?: string[];
}

export type CandidateScreeningMode = "lite" | "full";
export type CandidateScreeningModePreference = "normal" | "lite";
export type CandidateScreeningModeSelection = "default_normal" | "explicit_manual_lite";

export interface CandidateScreeningDiagnostics {
  triggerType: "manual" | "scheduled" | "debug";
  mode: CandidateScreeningMode;
  modeLabel: CandidateScreeningModePreference;
  modeSelection: CandidateScreeningModeSelection;
  fingerprint: string;
  maxMacroLanes: number | null;
  targetValidatedCandidateCount: number;
  totalProviderPromptCount: number;
  structuralPromptCount: number;
  macroLanePromptCount: number;
  retryCount: number;
  totalBackoffSeconds: number;
  rateLimitedPromptCount: number;
  macroLaneIdsAvailable: string[];
  macroLaneIdsConsidered: string[];
  queriedLaneIds: string[];
  skippedLaneIds: string[];
  laneCountQueried: number;
  laneCountSkipped: number;
  skippedLanesDueToEnoughSurvivors: number;
  rawCandidateCount: number;
  dedupedCandidateCount: number;
  candidatesSentToPriceValidation: number;
  validatedSurvivors: number;
  validatedSurvivorsByOrigin: {
    structural: number;
    macroLane: number;
  };
  reuseHit: boolean;
  reuseSourceBundleId: string | null;
  reuseMissReason: string | null;
  stoppedEarly: boolean;
}

export interface CandidateScreeningArtifact {
  fingerprint: string;
  mode: CandidateScreeningMode;
  candidates: ScreenedCandidate[];
  diagnostics: CandidateScreeningDiagnostics;
}

export interface CandidateScreeningResult {
  candidates: ScreenedCandidate[];
  diagnostics: CandidateScreeningDiagnostics;
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

export type NewsAvailabilityStatus =
  | "primary_success"
  | "primary_empty"
  | "primary_transport_failure"
  | "primary_rate_limited"
  | "fallback_success"
  | "no_usable_news";

export type NewsDirectionalSupport = "positive" | "negative" | "mixed" | "neutral" | "insufficient";
export type NewsContradictionLevel = "low" | "medium" | "high";
export type NewsConfidenceLevel = "high" | "medium" | "low";
export type NewsDegradedReason =
  | "primary_transport_failure"
  | "primary_rate_limited"
  | "primary_empty_result"
  | "fallback_used"
  | "no_usable_news";

export interface NewsFetchIssue {
  kind: "primary_transport_failure" | "primary_rate_limited" | "primary_empty_result" | "fallback_used" | "no_usable_news";
  model: string | null;
  attempt: number | null;
  message: string;
  name?: string | null;
  status?: number | null;
  code?: string | null;
  type?: string | null;
  cause?: string | null;
  retryPath?: string | null;
}

export interface TickerNewsSignal {
  ticker: string;
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason: NewsDegradedReason | null;
  articleCount: number;
  trustedSourceCount: number;
  sourceDiversityCount: number;
  recent24hCount: number;
  recent7dCount: number;
  directionalSupport: NewsDirectionalSupport;
  catalystPresence: boolean;
  riskEventPresence: boolean;
  contradictionLevel: NewsContradictionLevel;
  newsConfidence: NewsConfidenceLevel;
  explanatoryNote: string;
}

export interface NewsSignalSet {
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason: NewsDegradedReason | null;
  articleCount: number;
  trustedSourceCount: number;
  sourceDiversityCount: number;
  recent24hCount: number;
  recent7dCount: number;
  directionalSupport: NewsDirectionalSupport;
  contradictionLevel: NewsContradictionLevel;
  catalystPresence: boolean;
  riskEventPresence: boolean;
  confidence: NewsConfidenceLevel;
  statusSummary: string;
  tickerSignals: Record<string, TickerNewsSignal>;
  issues: NewsFetchIssue[];
}

export interface NewsResult {
  evidence: EvidenceItem[];
  combinedSummary: string;
  breaking24h: NewsArticle[] | string;
  allSources: NewsArticle[] | Source[];
  usingFallback: boolean;
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason?: NewsDegradedReason | null;
  statusSummary: string;
  issues: NewsFetchIssue[];
  signals: NewsSignalSet;
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
