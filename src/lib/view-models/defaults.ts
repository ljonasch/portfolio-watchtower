/**
 * src/lib/view-models/defaults.ts
 * Null defaults for pre-Batch-1 records that are missing fields.
 * Projection functions import from here — never inline defaults in components.
 *
 * Added in Batch 2.
 */

import type {
  PositionStatusEnum,
  EvidenceQualityEnum,
  AlertLevelEnum,
} from "./types";

/**
 * HoldingRecommendation field defaults.
 * Applied when DB row has null values for fields added in Batch 0.
 */
export const RECOMMENDATION_DEFAULTS = {
  dollarDelta: 0 as number,
  whyChanged: null as null,
  systemNote: null as null,
  positionStatus: "unknown" as PositionStatusEnum,
  evidenceQuality: "unknown" as EvidenceQualityEnum,
  acceptableRangeLow: null as null,
  acceptableRangeHigh: null as null,
} as const;

/**
 * AnalysisRun field defaults for RunMetaViewModel.
 */
export const RUN_META_DEFAULTS = {
  modelUsed: null as null,
  inputTokens: null as null,
  outputTokens: null as null,
  retryCount: 0 as number,
  completedAt: null as null,
  isCronRun: false as boolean,
} as const;

/**
 * Default alert level for runs that predate the alertLevel field.
 */
export const DEFAULT_ALERT_LEVEL: AlertLevelEnum = "none";

/**
 * Number of days after which a snapshot is considered stale.
 */
export const SNAPSHOT_STALE_THRESHOLD_DAYS = 7;
