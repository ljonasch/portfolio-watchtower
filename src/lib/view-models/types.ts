/**
 * src/lib/view-models/types.ts
 * All ViewModel interfaces. Components consume ONLY these types — never raw Prisma objects.
 *
 * Added in Batch 2.
 */

import type { AbstainReason } from "@/lib/research/types";

// Action enum — exact strings used in DB and by LLM
export type ActionEnum = "Buy" | "Sell" | "Hold" | "Exit" | "Trim";

// Confidence enum
export type ConfidenceEnum = "high" | "medium" | "low";

// Position status
export type PositionStatusEnum = "underweight" | "overweight" | "on_target" | "unknown";

// Evidence quality
export type EvidenceQualityEnum = "high" | "medium" | "low" | "mixed" | "unknown";

// Alert level
export type AlertLevelEnum = "none" | "low" | "medium" | "high" | "urgent";

// Run status
export type RunStatusEnum = "pending" | "running" | "complete" | "failed" | "abstained";

// Source for a recommendation
export interface SourceViewModel {
  title: string;
  url: string;
  quality?: string;
  domain?: string;
}

// ─── Core ViewModels ───────────────────────────────────────────────────────────

export interface RecommendationViewModel {
  id: string;                    // DB row id — used as React key
  ticker: string;
  companyName: string;
  role: string;
  currentShares: number;
  targetShares: number;
  shareDelta: number;
  currentWeight: number;
  targetWeight: number;
  acceptableRangeLow: number | null;
  acceptableRangeHigh: number | null;
  dollarDelta: number;
  action: ActionEnum;
  actionLabel: string;           // from formatters.ts — "Buy 5 shares"
  actionBadgeVariant: "buy" | "hold" | "trim" | "sell" | "exit";
  sortPriority: number;          // Exit=0, Sell=1, Trim=2, Buy=3, Hold=4
  confidence: ConfidenceEnum;
  positionStatus: PositionStatusEnum;
  evidenceQuality: EvidenceQualityEnum;
  thesisSummary: string;
  detailedReasoning: string;
  whyChanged: string | null;     // LLM text — immutable after parse
  systemNote: string | null;     // Deterministic annotations — separate field
  sources: SourceViewModel[];
  isNewPosition: boolean;        // currentShares === 0
  isExiting: boolean;            // targetShares === 0
  hasStcgWarning: boolean;       // derived: systemNote contains STCG annotation
  isFractionalRebalance: boolean; // |∆weight| < antichurnPct AND action overridden to Hold
}

export interface MarketContextViewModel {
  shortTerm: Array<{ factor: string; explanation: string }>;
  mediumTerm: Array<{ factor: string; explanation: string }>;
  longTerm: Array<{ factor: string; explanation: string }>;
}

export interface PortfolioMathViewModel {
  totalValue: number;
  cashPct: number;
  speculativeExposurePct: number;
  holdingCount: number;
  weightSumCheck: number;
}

export interface WatchlistIdeaViewModel {
  ticker: string;
  companyName: string | null;  // null when not provided by LLM
  role: string | null;
  rationale: string | null;
  whyNow: string | null;
  confidence: ConfidenceEnum | null;
  recommendedStarterShares: number | null;
  recommendedStarterDollars: number | null;
  recommendedStarterWeight: number | null;
  wouldReduceTicker: string | null;
  evidenceQuality: EvidenceQualityEnum | null;
}

export interface ChangeLogEntryViewModel {
  ticker: string;
  previousAction: ActionEnum | null;
  currentAction: ActionEnum;
  deltaShares: number;
  deltaWeight: number | null;
  deltaDollar: number | null;
  changedAt: string;
  runId: string;
}

export interface RunMetaViewModel {
  runId: string;
  status: RunStatusEnum;
  modelUsed: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  retryCount: number;
  startedAt: string;
  completedAt: string | null;
  validationWarningCount: number;
  usingFallbackNews: boolean;
  isCronRun: boolean;
  abstainReason?: AbstainReason;
}

export interface ReportViewModel {
  id: string;
  createdAt: string;
  snapshotId: string;
  summary: string;
  reasoning: string;
  evidenceQualitySummary: string;
  alertLevel: AlertLevelEnum;
  alertReason: string | null;
  marketContext: MarketContextViewModel;
  portfolioMath: PortfolioMathViewModel;
  recommendations: RecommendationViewModel[];
  watchlistIdeas: WatchlistIdeaViewModel[];
  changeLog: ChangeLogEntryViewModel[];
  runMeta: RunMetaViewModel;
  isStale: boolean;       // snapshot > 7 days old
  isDegraded: boolean;    // any stage used fallback
  isAbstained: boolean;   // run returned AbstainResult
}

// ─── Holdings VM ──────────────────────────────────────────────────────────────

export interface HoldingViewModel {
  id: string;
  ticker: string;
  companyName: string | null;
  shares: number;
  currentPrice: number | null;
  currentValue: number | null;
  dailyChangePct: number | null;
  isCash: boolean;
  computedWeight: number;        // derived from currentValue / totalValue
  snapshotAgedays: number;
}

// ─── Conviction VMs ───────────────────────────────────────────────────────────

export interface ConvictionMessageViewModel {
  id: string;
  role: "user" | "ai";
  content: string;       // prefix stripped in projection (render-time)
  rawContent: string;    // original DB value — for debug transcript only
  marker: "ACKNOWLEDGMENT" | "COUNTERPOINT" | "AGREEMENT" | null;
  markerBadgeVariant: "acknowledge" | "counter" | "agree" | null;
  createdAt: string;
}

export interface ConvictionViewModel {
  id: string;
  ticker: string;
  rationale: string;
  active: boolean;
  messages: ConvictionMessageViewModel[];
  createdAt: string;
}

// ─── Notification VMs ─────────────────────────────────────────────────────────

export interface NotificationEventViewModel {
  id: string;
  type: "email";
  recipientEmail: string | null;
  status: "sent" | "failed" | "pending";
  sentAt: string | null;
  errorMessage: string | null;
  runId: string | null;
  reportId: string | null;
}

export interface NotificationRecipientViewModel {
  id: string;
  email: string;
  label: string | null;
  active: boolean;
}

// ─── AppSettings VM ───────────────────────────────────────────────────────────

export interface AppSettingsViewModel {
  antichurnThresholdPct: number;
  validationEnforceBlock: boolean;
  cacheEnabled: boolean;
  emailAutoSend: boolean;
}

// ─── Evidence Audit VM ────────────────────────────────────────────────────────

export interface EvidenceAuditViewModel {
  runId: string;
  snapshotId: string;
  frozenAt: string;
  schemaVersion: number;
  promptHash: string | null;
  totalInputChars: number;
  perSectionChars: Record<string, number>;
  outcome: "pending" | "used" | "abstained";
  debugPayload?: {
    holdings: unknown;
    news: unknown;
    sentiment: unknown;
    valuation: unknown;
    regime: unknown;
    candidates: unknown;
  };
}

// ─── Analysis Run Summary VM (for history page) ───────────────────────────────

export interface AnalysisRunSummaryViewModel {
  id: string;
  status: RunStatusEnum;
  triggerType: string;
  triggeredBy: string | null;
  modelUsed: string | null;
  retryCount: number;
  isCronRun: boolean;
  startedAt: string;
  completedAt: string | null;
  alertLevel: AlertLevelEnum | null;
  isAbstained: boolean;
  abstainReason?: AbstainReason;
}
