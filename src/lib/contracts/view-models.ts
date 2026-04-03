import type {
  BundleOutcome,
  ConfidenceBand,
  CurrentBundleRenderState,
  DeliveryStatus,
  EvidenceQualityLevel,
  PositionStatus,
  RecommendationAction,
} from "./enums";
import type { BundleReasonCode } from "./reason-codes";

export interface SourceViewModelContract {
  title: string;
  url: string;
  quality?: string;
  domain?: string;
}

export interface ReasonCodeBadgeViewModelContract {
  code: BundleReasonCode;
  label: string;
  severity: "info" | "warning" | "error";
}

export interface RecommendationRowViewModelContract {
  id: string;
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
  action: RecommendationAction;
  actionLabel: string;
  actionBadgeVariant: "buy" | "hold" | "trim" | "sell" | "exit";
  sortPriority: number;
  confidence: ConfidenceBand;
  positionStatus: PositionStatus;
  evidenceQuality: EvidenceQualityLevel;
  thesisSummary: string;
  detailedReasoning: string;
  whyChanged: string | null;
  systemNote: string | null;
  sources: SourceViewModelContract[];
  isNewPosition: boolean;
  isExiting: boolean;
  hasStcgWarning: boolean;
  isFractionalRebalance: boolean;
}

export interface ReportActionStateViewModelContract {
  bundleId: string;
  outcome: BundleOutcome;
  deliveryStatus: DeliveryStatus;
  isActionable: boolean;
  canAcknowledge: boolean;
  canSendEmail: boolean;
  canManualResend: boolean;
}

export interface EmailRecommendationRowContract {
  ticker: string;
  companyName: string;
  action: RecommendationAction;
  targetShares: number;
  targetWeight: number;
  thesisSummary: string;
}

export interface EmailPayloadContract {
  bundleId: string;
  generatedAt: string;
  subject: string;
  summary: string;
  html: string;
  recommendations: EmailRecommendationRowContract[];
}

export interface ReportViewModelContract {
  bundleId: string;
  bundleOutcome: BundleOutcome;
  renderState: CurrentBundleRenderState;
  createdAt: string;
  finalizedAt: string;
  summaryMessage: string;
  reasoning: string;
  reasonCodes: ReasonCodeBadgeViewModelContract[];
  recommendations: RecommendationRowViewModelContract[];
  deliveryStatus: DeliveryStatus;
  isActionable: boolean;
  isSuperseded: boolean;
  historicalValidatedContextBundleId: string | null;
}

export interface DashboardCurrentBundleViewModelContract {
  currentBundleId: string | null;
  currentOutcome: BundleOutcome | null;
  currentRenderState: CurrentBundleRenderState;
  actionableBundleId: string | null;
  showHistoricalValidatedContext: boolean;
  historicalValidatedContextBundleId: string | null;
  runFailureBanner: {
    visible: boolean;
    message: string | null;
  };
}

export interface HistoryItemViewModelContract {
  bundleId: string;
  outcome: BundleOutcome;
  isSuperseded: boolean;
  deliveryStatus: DeliveryStatus;
  finalizedAt: string;
  isActionable: boolean;
}
