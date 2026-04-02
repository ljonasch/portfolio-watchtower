export const BUNDLE_SCOPES = ["PRIMARY_PORTFOLIO"] as const;
export type BundleScope = (typeof BUNDLE_SCOPES)[number];

export const ANALYSIS_RUN_STAGES = [
  "queued",
  "preparing_inputs",
  "building_evidence",
  "scoring",
  "validating",
  "finalized_validated",
  "finalized_abstained",
  "finalized_degraded",
  "failed",
] as const;
export type AnalysisRunStage = (typeof ANALYSIS_RUN_STAGES)[number];

export const BUNDLE_OUTCOMES = ["validated", "abstained", "degraded"] as const;
export type BundleOutcome = (typeof BUNDLE_OUTCOMES)[number];

export const BUNDLE_LIFECYCLE_STATES = ["active", "superseded"] as const;
export type BundleLifecycleState = (typeof BUNDLE_LIFECYCLE_STATES)[number];

export const DELIVERY_STATUSES = [
  "not_eligible",
  "awaiting_ack",
  "acknowledged",
  "sending",
  "sent",
  "send_failed",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const RECOMMENDATION_ACTIONS = ["Buy", "Sell", "Hold", "Exit", "Trim"] as const;
export type RecommendationAction = (typeof RECOMMENDATION_ACTIONS)[number];

export const CONFIDENCE_BANDS = ["high", "medium", "low"] as const;
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

export const POSITION_STATUSES = ["underweight", "overweight", "on_target", "unknown"] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

export const EVIDENCE_QUALITY_LEVELS = ["high", "medium", "low", "mixed", "unknown"] as const;
export type EvidenceQualityLevel = (typeof EVIDENCE_QUALITY_LEVELS)[number];

export const TRIGGER_SOURCES = ["manual_ui", "scheduler", "retry"] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export const DELIVERY_CHANNELS = ["email"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export const NOTIFICATION_EVENT_TYPES = [
  "report_acknowledged",
  "email_send_requested",
  "email_sent",
  "email_failed",
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const NOTIFICATION_EVENT_STATUSES = ["pending", "sent", "failed"] as const;
export type NotificationEventStatus = (typeof NOTIFICATION_EVENT_STATUSES)[number];

export const CONVICTION_MARKER_TYPES = ["ACKNOWLEDGMENT", "COUNTERPOINT", "AGREEMENT"] as const;
export type ConvictionMarkerType = (typeof CONVICTION_MARKER_TYPES)[number];

export const CURRENT_BUNDLE_RENDER_STATES = [
  "validated_actionable",
  "abstained_summary_only",
  "degraded_summary_only",
  "failed_run_prior_bundle_retained",
] as const;
export type CurrentBundleRenderState = (typeof CURRENT_BUNDLE_RENDER_STATES)[number];
