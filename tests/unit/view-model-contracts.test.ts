import type {
  DashboardCurrentBundleViewModelContract,
  EmailPayloadContract,
  HistoryItemViewModelContract,
  ReportViewModelContract,
} from "@/lib/contracts";

describe("view-model contract fixtures", () => {
  test("validated report view model remains actionable", () => {
    const report: ReportViewModelContract = {
      bundleId: "bundle_validated",
      bundleOutcome: "validated",
      renderState: "validated_actionable",
      createdAt: "2026-04-02T10:00:00.000Z",
      finalizedAt: "2026-04-02T10:02:00.000Z",
      summaryMessage: "Validated analysis complete",
      reasoning: "Reasoning",
      reasonCodes: [],
      recommendations: [],
      deliveryStatus: "awaiting_ack",
      isActionable: true,
      isSuperseded: false,
      historicalValidatedContextBundleId: null,
    };

    expect(report.isActionable).toBe(true);
    expect(report.bundleOutcome).toBe("validated");
  });

  test("abstained and degraded reports require recommendations: []", () => {
    const abstained: ReportViewModelContract = {
      bundleId: "bundle_abstained",
      bundleOutcome: "abstained",
      renderState: "abstained_summary_only",
      createdAt: "2026-04-02T10:00:00.000Z",
      finalizedAt: "2026-04-02T10:02:00.000Z",
      summaryMessage: "Analysis incomplete. No recommendations were saved.",
      reasoning: "Reason codes only",
      reasonCodes: [],
      recommendations: [],
      deliveryStatus: "not_eligible",
      isActionable: false,
      isSuperseded: false,
      historicalValidatedContextBundleId: "bundle_previous_validated",
    };

    const degraded: ReportViewModelContract = {
      ...abstained,
      bundleId: "bundle_degraded",
      bundleOutcome: "degraded",
      renderState: "degraded_summary_only",
    };

    expect(abstained.recommendations).toEqual([]);
    expect(degraded.recommendations).toEqual([]);
  });

  test("dashboard VM captures failed-run prior-bundle-retained mode", () => {
    const vm: DashboardCurrentBundleViewModelContract = {
      currentBundleId: "bundle_prior",
      currentOutcome: "validated",
      currentRenderState: "failed_run_prior_bundle_retained",
      actionableBundleId: "bundle_prior",
      showHistoricalValidatedContext: false,
      historicalValidatedContextBundleId: null,
      runFailureBanner: {
        visible: true,
        message: "Latest run failed. Showing last completed bundle.",
      },
    };

    expect(vm.runFailureBanner.visible).toBe(true);
  });

  test("history and email payload contracts are frozen bundle snapshots", () => {
    const history: HistoryItemViewModelContract = {
      bundleId: "bundle_validated",
      outcome: "validated",
      isSuperseded: false,
      deliveryStatus: "sent",
      finalizedAt: "2026-04-02T10:02:00.000Z",
      isActionable: true,
    };

    const email: EmailPayloadContract = {
      bundleId: "bundle_validated",
      generatedAt: "2026-04-02T10:02:00.000Z",
      subject: "Portfolio update",
      html: "<p>Validated analysis complete</p>",
      summary: "Validated analysis complete",
      recommendations: [],
    };

    expect(history.bundleId).toBe(email.bundleId);
  });
});
