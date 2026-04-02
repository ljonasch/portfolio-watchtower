/**
 * src/lib/view-models/index.ts
 * Projection functions: Prisma rows → typed ViewModels.
 *
 * RULES (enforced in Batch 4):
 * - No Prisma type leaks into components. Every component receives a ViewModel.
 * - All formatting derived from formatters.ts — never inline in components.
 * - All defaults come from defaults.ts.
 *
 * Added in Batch 4.
 */

import type {
  RecommendationViewModel,
  WatchlistIdeaViewModel,
  ChangeLogEntryViewModel,
  RunMetaViewModel,
  ConvictionMessageViewModel,
  ConvictionViewModel,
  NotificationEventViewModel,
  NotificationRecipientViewModel,
  ActionEnum,
  ConfidenceEnum,
  PositionStatusEnum,
  EvidenceQualityEnum,
  AlertLevelEnum,
  RunStatusEnum,
  AnalysisRunSummaryViewModel,
  EvidenceAuditViewModel,
  AppSettingsViewModel,
} from "./types";
import type { AbstainReason } from "@/lib/research/types";
import {
  getActionBadgeVariant,
  getActionSortPriority,
  getActionLabel,
} from "./formatters";
import {
  RECOMMENDATION_DEFAULTS,
  RUN_META_DEFAULTS,
  DEFAULT_ALERT_LEVEL,
  SNAPSHOT_STALE_THRESHOLD_DAYS,
} from "./defaults";

// ─── Enum coercion helpers ────────────────────────────────────────────────────

function coerceAction(raw: string | null | undefined): ActionEnum {
  const allowed: ActionEnum[] = ["Buy", "Sell", "Hold", "Exit", "Trim"];
  if (raw?.trim() === "Add") return "Buy";
  const v = raw?.trim() as ActionEnum;
  return allowed.includes(v) ? v : "Hold";
}

function coerceConfidence(raw: string | null | undefined): ConfidenceEnum {
  const allowed: ConfidenceEnum[] = ["high", "medium", "low"];
  const v = (raw?.toLowerCase() ?? "") as ConfidenceEnum;
  return allowed.includes(v) ? v : "low";
}

function coercePositionStatus(raw: string | null | undefined): PositionStatusEnum {
  const allowed: PositionStatusEnum[] = ["underweight", "overweight", "on_target", "unknown"];
  const v = (raw ?? "unknown") as PositionStatusEnum;
  return allowed.includes(v) ? v : "unknown";
}

function coerceEvidenceQuality(raw: string | null | undefined): EvidenceQualityEnum {
  const allowed: EvidenceQualityEnum[] = ["high", "medium", "low", "mixed", "unknown"];
  const v = (raw ?? "unknown") as EvidenceQualityEnum;
  return allowed.includes(v) ? v : "unknown";
}

function coerceAlertLevel(raw: string | null | undefined): AlertLevelEnum {
  const allowed: AlertLevelEnum[] = ["none", "low", "medium", "high", "urgent"];
  const v = (raw ?? DEFAULT_ALERT_LEVEL) as AlertLevelEnum;
  return allowed.includes(v) ? v : DEFAULT_ALERT_LEVEL;
}

function coerceRunStatus(raw: string | null | undefined): RunStatusEnum {
  const allowed: RunStatusEnum[] = ["pending", "running", "complete", "failed", "abstained"];
  const v = (raw ?? "pending") as RunStatusEnum;
  return allowed.includes(v) ? v : "pending";
}

// ─── projectRecommendation ────────────────────────────────────────────────────

/**
 * Projects a raw Prisma HoldingRecommendation row + hold-over context into
 * a fully typed RecommendationViewModel with all derived fields computed once.
 *
 * antichurnPct: read from AppSettings.antichurn_threshold_pct at call site.
 */
export function projectRecommendation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: Record<string, any>,
  antichurnPct = 1.5
): RecommendationViewModel {
  const action = coerceAction(raw.action);
  const shareDelta = raw.shareDelta ?? 0;
  const dollarDelta = raw.dollarDelta ?? RECOMMENDATION_DEFAULTS.dollarDelta;
  const currentShares = raw.currentShares ?? 0;
  const targetShares = raw.targetShares ?? 0;
  const currentWeight = raw.currentWeight ?? 0;
  const targetWeight = raw.targetWeight ?? 0;
  const weightShift = Math.abs(targetWeight - currentWeight);

  // Parse sources
  const sources = (() => {
    try {
      const parsed = typeof raw.reasoningSources === "string"
        ? JSON.parse(raw.reasoningSources)
        : (raw.reasoningSources ?? []);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  // Derived flags
  const isNewPosition = currentShares === 0 && action === "Buy";
  const isExiting = targetShares === 0 && (action === "Exit" || action === "Sell");
  const hasStcgWarning = typeof raw.systemNote === "string" && raw.systemNote.includes("STCG");
  const isFractionalRebalance =
    (action === "Trim" || action === "Buy") &&
    weightShift < antichurnPct &&
    targetShares > 0 &&
    currentShares > 0;

  return {
    id: raw.id ?? "",
    ticker: raw.ticker,
    companyName: raw.companyName ?? raw.ticker,
    role: raw.role ?? "Core",
    currentShares,
    targetShares,
    shareDelta,
    currentWeight,
    targetWeight,
    acceptableRangeLow: raw.acceptableRangeLow ?? RECOMMENDATION_DEFAULTS.acceptableRangeLow,
    acceptableRangeHigh: raw.acceptableRangeHigh ?? RECOMMENDATION_DEFAULTS.acceptableRangeHigh,
    dollarDelta,
    action,
    actionLabel: getActionLabel(action, shareDelta),
    actionBadgeVariant: getActionBadgeVariant(action),
    sortPriority: getActionSortPriority(action),
    confidence: coerceConfidence(raw.confidence),
    positionStatus: coercePositionStatus(raw.positionStatus),
    evidenceQuality: coerceEvidenceQuality(raw.evidenceQuality),
    thesisSummary: raw.thesisSummary ?? "",
    detailedReasoning: raw.detailedReasoning ?? "",
    whyChanged: raw.whyChanged ?? RECOMMENDATION_DEFAULTS.whyChanged,
    systemNote: raw.systemNote ?? RECOMMENDATION_DEFAULTS.systemNote,
    sources,
    isNewPosition,
    isExiting,
    hasStcgWarning,
    isFractionalRebalance,
  };
}

// ─── projectWatchlistIdea ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectWatchlistIdea(raw: Record<string, any>): WatchlistIdeaViewModel {
  return {
    ticker: raw.ticker,
    companyName: raw.companyName ?? null,
    role: raw.role ?? null,
    rationale: raw.rationale ?? null,
    whyNow: raw.whyNow ?? null,
    confidence: raw.confidence ? coerceConfidence(raw.confidence) : null,
    recommendedStarterShares: raw.recommendedStarterShares ?? null,
    recommendedStarterDollars: raw.recommendedStarterDollars ?? null,
    recommendedStarterWeight: raw.recommendedStarterWeight ?? null,
    wouldReduceTicker: raw.wouldReduceTicker ?? null,
    evidenceQuality: raw.evidenceQuality ? coerceEvidenceQuality(raw.evidenceQuality) : null,
  };
}

// ─── projectChangeLogEntry ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectChangeLogEntry(raw: Record<string, any>): ChangeLogEntryViewModel {
  return {
    ticker: raw.ticker,
    previousAction: raw.priorAction ? coerceAction(raw.priorAction) : null,
    currentAction: coerceAction(raw.newAction),
    deltaShares: raw.sharesDelta ?? 0,
    deltaWeight: raw.deltaWeight ?? null,
    deltaDollar: raw.deltaDollar ?? null,
    changedAt: raw.createdAt instanceof Date
      ? raw.createdAt.toISOString()
      : (raw.createdAt ?? new Date().toISOString()),
    runId: raw.runId ?? "",
  };
}

// ─── projectRunMeta ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectRunMeta(raw: Record<string, any> | null | undefined): RunMetaViewModel {
  if (!raw) {
    return {
      runId: "",
      status: "complete",
      modelUsed: RUN_META_DEFAULTS.modelUsed,
      inputTokens: RUN_META_DEFAULTS.inputTokens,
      outputTokens: RUN_META_DEFAULTS.outputTokens,
      retryCount: RUN_META_DEFAULTS.retryCount,
      startedAt: new Date().toISOString(),
      completedAt: RUN_META_DEFAULTS.completedAt,
      validationWarningCount: 0,
      usingFallbackNews: false,
      isCronRun: RUN_META_DEFAULTS.isCronRun,
    };
  }

  // Parse qualityMeta for validation warning count + fallback flag
  const qualityMeta = (() => {
    try { return JSON.parse(raw.qualityMeta ?? "{}"); }
    catch { return {}; }
  })();

  const abstainReason = qualityMeta.abstainReason as AbstainReason | undefined;

  return {
    runId: raw.id ?? "",
    status: coerceRunStatus(raw.status),
    modelUsed: raw.modelUsed ?? RUN_META_DEFAULTS.modelUsed,
    inputTokens: raw.inputTokens ?? RUN_META_DEFAULTS.inputTokens,
    outputTokens: raw.outputTokens ?? RUN_META_DEFAULTS.outputTokens,
    retryCount: raw.retryCount ?? RUN_META_DEFAULTS.retryCount,
    startedAt: raw.startedAt instanceof Date
      ? raw.startedAt.toISOString()
      : (raw.startedAt ?? new Date().toISOString()),
    completedAt: raw.completedAt instanceof Date
      ? raw.completedAt.toISOString()
      : (raw.completedAt ?? null),
    validationWarningCount: qualityMeta.validationWarningCount ?? 0,
    usingFallbackNews: qualityMeta.usingFallbackNews ?? false,
    isCronRun: raw.isCronRun ?? RUN_META_DEFAULTS.isCronRun,
    ...(abstainReason ? { abstainReason } : {}),
  };
}

// ─── projectConvictionMessage ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectConvictionMessage(raw: Record<string, any>): ConvictionMessageViewModel {
  const content = raw.content ?? "";
  const MARKERS = ["ACKNOWLEDGMENT:", "COUNTERPOINT:", "AGREEMENT:"] as const;
  type Marker = (typeof MARKERS)[number];
  const foundMarker = MARKERS.find(m => content.startsWith(m)) as Marker | undefined;

  const markerMap: Record<Marker, ConvictionMessageViewModel["marker"]> = {
    "ACKNOWLEDGMENT:": "ACKNOWLEDGMENT",
    "COUNTERPOINT:": "COUNTERPOINT",
    "AGREEMENT:": "AGREEMENT",
  };

  const badgeMap: Record<Marker, ConvictionMessageViewModel["markerBadgeVariant"]> = {
    "ACKNOWLEDGMENT:": "acknowledge",
    "COUNTERPOINT:": "counter",
    "AGREEMENT:": "agree",
  };

  const marker = foundMarker ? markerMap[foundMarker] : null;
  const markerBadgeVariant = foundMarker ? badgeMap[foundMarker] : null;
  const displayContent = foundMarker
    ? content.slice(foundMarker.length).trimStart()
    : content;

  return {
    id: raw.id ?? "",
    role: raw.role === "ai" ? "ai" : "user",
    content: displayContent,
    rawContent: content,
    marker,
    markerBadgeVariant,
    createdAt: raw.createdAt instanceof Date
      ? raw.createdAt.toISOString()
      : (raw.createdAt ?? new Date().toISOString()),
  };
}

// ─── projectConviction ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectConviction(raw: Record<string, any>): ConvictionViewModel {
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map(projectConvictionMessage)
    : [];
  return {
    id: raw.id ?? "",
    ticker: raw.ticker ?? "",
    rationale: raw.rationale ?? "",
    active: raw.active ?? true,
    messages,
    createdAt: raw.createdAt instanceof Date
      ? raw.createdAt.toISOString()
      : (raw.createdAt ?? new Date().toISOString()),
  };
}

// ─── projectNotificationEvent ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectNotificationEvent(raw: Record<string, any>): NotificationEventViewModel {
  const statusMap: Record<string, NotificationEventViewModel["status"]> = {
    sent: "sent",
    failed: "failed",
    pending: "pending",
  };
  return {
    id: raw.id ?? "",
    type: "email",
    recipientEmail: raw.recipient ?? null,
    status: statusMap[raw.status as string] ?? "pending",
    sentAt: raw.status === "sent" && raw.createdAt instanceof Date
      ? raw.createdAt.toISOString()
      : null,
    errorMessage: raw.errorMessage ?? null,
    runId: raw.runId ?? null,
    reportId: raw.reportId ?? null,
  };
}

// ─── projectNotificationRecipient ────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectNotificationRecipient(raw: Record<string, any>): NotificationRecipientViewModel {
  return {
    id: raw.id ?? "",
    email: raw.email ?? "",
    label: raw.label ?? null,
    active: raw.active ?? true,
  };
}

// ─── projectAnalysisRunSummary ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectAnalysisRunSummary(raw: Record<string, any>): AnalysisRunSummaryViewModel {
  const qualityMeta = (() => {
    try { return JSON.parse(raw.qualityMeta ?? "{}"); }
    catch { return {}; }
  })();
  return {
    id: raw.id ?? "",
    status: coerceRunStatus(raw.status),
    triggerType: raw.triggerType ?? "manual",
    triggeredBy: raw.triggeredBy ?? null,
    modelUsed: raw.modelUsed ?? null,
    retryCount: raw.retryCount ?? 0,
    isCronRun: raw.isCronRun ?? false,
    startedAt: raw.startedAt instanceof Date
      ? raw.startedAt.toISOString()
      : (raw.startedAt ?? new Date().toISOString()),
    completedAt: raw.completedAt instanceof Date
      ? raw.completedAt.toISOString()
      : (raw.completedAt ?? null),
    alertLevel: coerceAlertLevel(raw.alertLevel),
    isAbstained: raw.status === "abstained",
    ...(qualityMeta.abstainReason ? { abstainReason: qualityMeta.abstainReason as AbstainReason } : {}),
  };
}

// ─── isSnapshotStale ─────────────────────────────────────────────────────────

// ─── projectEvidenceAudit ────────────────────────────────────────────────────
// Added Batch 8 — maps raw EvidencePacket DB row to EvidenceAuditViewModel.

const VALID_OUTCOMES = new Set(["pending", "used", "abstained"]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectEvidenceAudit(raw: Record<string, any>): EvidenceAuditViewModel {
  const safeJsonParse = (s: string | null | undefined, fallback: unknown) => {
    try { return s ? JSON.parse(s) : fallback; }
    catch { return fallback; }
  };

  const outcome = VALID_OUTCOMES.has(raw.outcome) ? raw.outcome : "pending";

  return {
    runId: raw.runId ?? "",
    snapshotId: raw.snapshotId ?? "",
    frozenAt: raw.frozenAt instanceof Date
      ? raw.frozenAt.toISOString()
      : (raw.frozenAt ?? new Date().toISOString()),
    schemaVersion: typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1,
    promptHash: raw.promptHash ?? null,
    totalInputChars: typeof raw.totalInputChars === "number" ? raw.totalInputChars : 0,
    perSectionChars: safeJsonParse(raw.perSectionCharsJson, {}) as Record<string, number>,
    outcome: outcome as EvidenceAuditViewModel["outcome"],
    debugPayload: {
      holdings: safeJsonParse(raw.holdingsJson, null),
      news: safeJsonParse(raw.newsJson, null),
      sentiment: safeJsonParse(raw.sentimentJson, null),
      valuation: safeJsonParse(raw.valuationJson, null),
      regime: safeJsonParse(raw.regimeJson, null),
      candidates: safeJsonParse(raw.candidatesJson, null),
    },
  };
}

// ─── projectAppSettings ───────────────────────────────────────────────────────
// Added Batch 8 — maps an array of AppSettings key/value rows to the typed VM.
// Missing keys fall back to safe defaults.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function projectAppSettings(rows: Array<Record<string, any>>): AppSettingsViewModel {
  const map = new Map(rows.map(r => [r.key as string, r.value as string]));
  const parseFloat_ = (k: string, def: number) => {
    const raw = map.get(k);
    const n = parseFloat(raw ?? "");
    return isNaN(n) ? def : n;
  };
  const parseBool = (k: string, def: boolean) => {
    const raw = map.get(k);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return def;
  };
  return {
    antichurnThresholdPct: parseFloat_("antichurn_threshold_pct", 1.5),
    validationEnforceBlock: parseBool("validation_enforce_block", false),
    cacheEnabled: parseBool("cache_enabled", true),
    emailAutoSend: parseBool("email_auto_send", false),
  };
}


// --- isSnapshotStale ---

export function isSnapshotStale(snapshotCreatedAt: Date | string): boolean {
  const date = typeof snapshotCreatedAt === 'string'
    ? new Date(snapshotCreatedAt)
    : snapshotCreatedAt;
  const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays > SNAPSHOT_STALE_THRESHOLD_DAYS;
}
