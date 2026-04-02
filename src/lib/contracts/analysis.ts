import type {
  AnalysisRunStage,
  BundleLifecycleState,
  BundleOutcome,
  BundleScope,
  ConfidenceBand,
  CurrentBundleRenderState,
  DeliveryChannel,
  DeliveryStatus,
  EvidenceQualityLevel,
  NotificationEventStatus,
  NotificationEventType,
  PositionStatus,
  RecommendationAction,
  TriggerSource,
} from "./enums";
import type {
  AbstainReasonCode,
  BundleReasonCode,
  DegradedReasonCode,
  DeliveryErrorCode,
  RunFailureCode,
} from "./reason-codes";
import type {
  EmailPayloadContract,
  ReportViewModelContract,
  SourceViewModelContract,
} from "./view-models";

export interface AnalysisVersionStamp {
  analysisPolicyVersion: string;
  schemaVersion: string;
  promptVersion: string;
  viewModelVersion: string;
  emailTemplateVersion: string;
  modelPolicyVersion: string;
}

export interface FrozenProfileSnapshotContract {
  profileId: string | null;
  capturedAt: string;
  payload: Record<string, unknown>;
}

export interface ConvictionSnapshotItemContract {
  ticker: string;
  rationale: string;
  active: boolean;
  messageCount: number;
}

export interface FrozenConvictionSnapshotContract {
  capturedAt: string;
  items: ConvictionSnapshotItemContract[];
}

export interface EvidenceFreshnessContract {
  priceAgeDays: number | null;
  newsAgeHours: number | null;
  marketContextAgeHours: number | null;
}

export interface ValidationSummaryContract {
  hardErrorCount: number;
  warningCount: number;
  reasonCodes: BundleReasonCode[];
  debugDetailsRef: string | null;
}

export interface ModelInvocationMetaContract {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  retryCount: number;
  responseHash: string | null;
}

export interface HoldingRecommendationProjectionContract {
  id: string;
  analysisBundleId: string;
  ticker: string;
  companyName: string;
  role: string | null;
  action: RecommendationAction;
  confidence: ConfidenceBand;
  positionStatus: PositionStatus;
  evidenceQuality: EvidenceQualityLevel;
  currentShares: number;
  targetShares: number;
  shareDelta: number;
  currentWeight: number;
  targetWeight: number;
  acceptableRangeLow: number | null;
  acceptableRangeHigh: number | null;
  dollarDelta: number;
  thesisSummary: string;
  detailedReasoning: string;
  whyChanged: string | null;
  systemNote: string | null;
  citations: SourceViewModelContract[];
}

export interface DeliveryEligibilityContract {
  bundleId: string;
  isValidated: boolean;
  isCurrentBundle: boolean;
  isAcknowledged: boolean;
  isSuperseded: boolean;
  deliveryStatus: DeliveryStatus;
  isEligibleForInitialSend: boolean;
  isEligibleForManualResend: boolean;
}

export interface NotificationEventContract {
  id: string;
  userId: string;
  analysisRunId: string | null;
  analysisBundleId: string | null;
  type: NotificationEventType;
  channel: DeliveryChannel;
  status: NotificationEventStatus;
  recipient: string | null;
  subject: string | null;
  errorCode: DeliveryErrorCode | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AnalysisRunContract {
  id: string;
  userId: string;
  bundleScope: BundleScope;
  portfolioSnapshotId: string;
  portfolioSnapshotHash: string;
  profileHash: string;
  convictionHash: string;
  triggerSource: TriggerSource;
  triggeredBy: string | null;
  stage: AnalysisRunStage;
  idempotencyKey: string;
  attemptNumber: number;
  repairAttemptUsed: boolean;
  evidenceHash: string | null;
  promptVersion: string;
  schemaVersion: string;
  primaryModel: string;
  failureCode: RunFailureCode | null;
  failureMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdBundleId: string | null;
}

export interface AnalysisBundleContract {
  id: string;
  userId: string;
  bundleScope: BundleScope;
  sourceRunId: string;
  createdAt: string;
  finalizedAt: string;
  lifecycleState: BundleLifecycleState;
  isSuperseded: boolean;
  supersededAt: string | null;
  portfolioSnapshotId: string;
  portfolioSnapshotHash: string;
  userProfileSnapshot: FrozenProfileSnapshotContract;
  userProfileHash: string;
  convictionSnapshot: FrozenConvictionSnapshotContract;
  convictionHash: string;
  versions: AnalysisVersionStamp;
  evidencePacket: Record<string, unknown>;
  evidenceHash: string;
  evidenceFreshness: EvidenceFreshnessContract;
  sourceList: SourceViewModelContract[];
  primaryModel: string;
  llmStructuredScore: Record<string, unknown>;
  llmInvocation: ModelInvocationMetaContract;
  factorLedger: Record<string, unknown>;
  recommendationDecision: Record<string, unknown>;
  positionSizing: Record<string, unknown>;
  bundleOutcome: BundleOutcome;
  abstainReasonCodes: AbstainReasonCode[];
  degradedReasonCodes: DegradedReasonCode[];
  validationSummary: ValidationSummaryContract;
  reportViewModel: ReportViewModelContract;
  emailPayload: EmailPayloadContract | null;
  exportPayload: Record<string, unknown>;
  deliveryStatus: DeliveryStatus;
  acknowledgedAt: string | null;
  deliveryAttemptCount: number;
  deliveryLastErrorCode: DeliveryErrorCode | null;
}

export interface CurrentBundlePartitionContract {
  userId: string;
  bundleScope: BundleScope;
  portfolioSnapshotId?: string | null;
  profileHash?: string | null;
  convictionHash?: string | null;
}

export interface CurrentBundleSelectionInput {
  partition: CurrentBundlePartitionContract;
  terminalBundles: Array<{
    bundleId: string;
    bundleScope: BundleScope;
    portfolioSnapshotId: string;
    profileHash: string;
    convictionHash: string;
    bundleOutcome: BundleOutcome;
    finalizedAt: string;
    isSuperseded: boolean;
  }>;
  latestRun: {
    runId: string;
    stage: AnalysisRunStage;
    failureCode: RunFailureCode | null;
    completedAt: string | null;
  } | null;
}

export interface CurrentBundleSelectionResult {
  currentBundleId: string | null;
  actionableBundleId: string | null;
  historicalValidatedContextBundleId: string | null;
  dashboardMode: CurrentBundleRenderState;
}
