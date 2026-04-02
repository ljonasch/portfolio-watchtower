import type {
  AnalysisBundleContract,
  AnalysisRunContract,
  DeliveryEligibilityContract,
  HoldingRecommendationProjectionContract,
  NotificationEventContract,
} from "@/lib/contracts";

describe("analysis contract fixtures", () => {
  const baseRun: AnalysisRunContract = {
    id: "run_1",
    userId: "user_1",
    bundleScope: "PRIMARY_PORTFOLIO",
    portfolioSnapshotId: "snapshot_1",
    portfolioSnapshotHash: "snap_hash",
    profileHash: "profile_hash",
    convictionHash: "conviction_hash",
    triggerSource: "manual_ui",
    triggeredBy: "user_1",
    stage: "finalized_validated",
    idempotencyKey: "idemp_1",
    attemptNumber: 1,
    repairAttemptUsed: false,
    evidenceHash: "evidence_hash",
    promptVersion: "prompt_v1",
    schemaVersion: "schema_v1",
    primaryModel: "gpt-5.4",
    failureCode: null,
    failureMessage: null,
    startedAt: "2026-04-02T10:00:00.000Z",
    completedAt: "2026-04-02T10:02:00.000Z",
    createdBundleId: "bundle_validated",
  };

  const validatedBundle: AnalysisBundleContract = {
    id: "bundle_validated",
    userId: "user_1",
    bundleScope: "PRIMARY_PORTFOLIO",
    sourceRunId: "run_1",
    createdAt: "2026-04-02T10:02:00.000Z",
    finalizedAt: "2026-04-02T10:02:00.000Z",
    lifecycleState: "active",
    isSuperseded: false,
    supersededAt: null,
    portfolioSnapshotId: "snapshot_1",
    portfolioSnapshotHash: "snap_hash",
    userProfileSnapshot: { profileId: "profile_1", capturedAt: "2026-04-02T10:00:00.000Z", payload: {} },
    userProfileHash: "profile_hash",
    convictionSnapshot: { capturedAt: "2026-04-02T10:00:00.000Z", items: [] },
    convictionHash: "conviction_hash",
    versions: {
      analysisPolicyVersion: "policy_v1",
      schemaVersion: "schema_v1",
      promptVersion: "prompt_v1",
      viewModelVersion: "vm_v1",
      emailTemplateVersion: "email_v1",
      modelPolicyVersion: "model_v1",
    },
    evidencePacket: {},
    evidenceHash: "evidence_hash",
    evidenceFreshness: { priceAgeDays: 0, newsAgeHours: 2, marketContextAgeHours: 1 },
    sourceList: [],
    primaryModel: "gpt-5.4",
    llmStructuredScore: {},
    llmInvocation: { model: "gpt-5.4", inputTokens: 1200, outputTokens: 500, retryCount: 0, responseHash: "resp_hash" },
    factorLedger: {},
    recommendationDecision: {},
    positionSizing: {},
    bundleOutcome: "validated",
    abstainReasonCodes: [],
    degradedReasonCodes: [],
    validationSummary: { hardErrorCount: 0, warningCount: 0, reasonCodes: [], debugDetailsRef: null },
    reportViewModel: {
      bundleId: "bundle_validated",
      bundleOutcome: "validated",
      renderState: "validated_actionable",
      createdAt: "2026-04-02T10:02:00.000Z",
      finalizedAt: "2026-04-02T10:02:00.000Z",
      summaryMessage: "Validated report",
      reasoning: "Reasoning",
      reasonCodes: [],
      recommendations: [],
      deliveryStatus: "awaiting_ack",
      isActionable: true,
      isSuperseded: false,
      historicalValidatedContextBundleId: null,
    },
    emailPayload: {
      bundleId: "bundle_validated",
      generatedAt: "2026-04-02T10:02:00.000Z",
      subject: "Portfolio update",
      summary: "Validated report",
      recommendations: [],
    },
    exportPayload: {},
    deliveryStatus: "awaiting_ack",
    acknowledgedAt: null,
    deliveryAttemptCount: 0,
    deliveryLastErrorCode: null,
  };

  test("validated fixtures compile with email payload and actionable state", () => {
    expect(baseRun.createdBundleId).toBe(validatedBundle.id);
    expect(validatedBundle.bundleOutcome).toBe("validated");
    expect(validatedBundle.emailPayload).not.toBeNull();
  });

  test("abstained and degraded fixtures require empty recommendations and no email payload", () => {
    const abstained: AnalysisBundleContract = {
      ...validatedBundle,
      id: "bundle_abstained",
      bundleOutcome: "abstained",
      reportViewModel: {
        ...validatedBundle.reportViewModel,
        bundleId: "bundle_abstained",
        bundleOutcome: "abstained",
        renderState: "abstained_summary_only",
        recommendations: [],
        isActionable: false,
      },
      emailPayload: null,
      abstainReasonCodes: ["SEMANTIC_VALIDATION_FAILED"],
      deliveryStatus: "not_eligible",
    };

    const degraded: AnalysisBundleContract = {
      ...validatedBundle,
      id: "bundle_degraded",
      bundleOutcome: "degraded",
      reportViewModel: {
        ...validatedBundle.reportViewModel,
        bundleId: "bundle_degraded",
        bundleOutcome: "degraded",
        renderState: "degraded_summary_only",
        recommendations: [],
        isActionable: false,
      },
      emailPayload: null,
      degradedReasonCodes: ["PRICE_DATA_STALE"],
      deliveryStatus: "not_eligible",
    };

    expect(abstained.reportViewModel.recommendations).toEqual([]);
    expect(abstained.emailPayload).toBeNull();
    expect(degraded.reportViewModel.recommendations).toEqual([]);
    expect(degraded.emailPayload).toBeNull();
  });

  test("failed runs remain run-only and do not require bundles", () => {
    const failedRun: AnalysisRunContract = {
      ...baseRun,
      id: "run_failed",
      stage: "failed",
      failureCode: "MODEL_TIMEOUT",
      failureMessage: "Timed out",
      createdBundleId: null,
      completedAt: "2026-04-02T10:05:00.000Z",
    };

    expect(failedRun.stage).toBe("failed");
    expect(failedRun.createdBundleId).toBeNull();
  });

  test("projection and delivery eligibility contracts compile with explicit eligibility state", () => {
    const projection: HoldingRecommendationProjectionContract = {
      id: "rec_1",
      analysisBundleId: "bundle_validated",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      role: "Core",
      action: "Buy",
      confidence: "high",
      positionStatus: "underweight",
      evidenceQuality: "high",
      currentShares: 10,
      targetShares: 12,
      shareDelta: 2,
      currentWeight: 10,
      targetWeight: 12,
      acceptableRangeLow: 8,
      acceptableRangeHigh: 14,
      dollarDelta: 300,
      thesisSummary: "Strong setup",
      detailedReasoning: "Detailed reasoning",
      whyChanged: "Changed due to evidence",
      systemNote: null,
      citations: [],
    };

    const eligibility: DeliveryEligibilityContract = {
      bundleId: "bundle_validated",
      isValidated: true,
      isCurrentBundle: true,
      isAcknowledged: false,
      isSuperseded: false,
      deliveryStatus: "awaiting_ack",
      isEligibleForInitialSend: false,
      isEligibleForManualResend: false,
    };

    expect(projection.analysisBundleId).toBe(eligibility.bundleId);
    expect(eligibility.isEligibleForInitialSend).toBe(false);
  });

  test("notification event contract links to run and bundle ids", () => {
    const event: NotificationEventContract = {
      id: "evt_1",
      userId: "user_1",
      analysisRunId: "run_1",
      analysisBundleId: "bundle_validated",
      type: "email_send_requested",
      channel: "email",
      status: "pending",
      recipient: "user@example.com",
      subject: "Portfolio update",
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-04-02T10:03:00.000Z",
    };

    expect(event.analysisRunId).toBe("run_1");
    expect(event.analysisBundleId).toBe("bundle_validated");
  });
});
