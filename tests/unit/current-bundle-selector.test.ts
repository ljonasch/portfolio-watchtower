import { selectCurrentBundle } from "@/lib/read-models";

describe("current-bundle-selector", () => {
  test("latest non-superseded terminal bundle wins", () => {
    const result = selectCurrentBundle({
      partition: {
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
      },
      terminalBundles: [
        {
          bundleId: "bundle_old",
          bundleScope: "PRIMARY_PORTFOLIO",
          portfolioSnapshotId: "snapshot_1",
          profileHash: "p1",
          convictionHash: "c1",
          bundleOutcome: "validated",
          finalizedAt: "2026-04-01T00:00:00.000Z",
          isSuperseded: true,
        },
        {
          bundleId: "bundle_new",
          bundleScope: "PRIMARY_PORTFOLIO",
          portfolioSnapshotId: "snapshot_1",
          profileHash: "p1",
          convictionHash: "c1",
          bundleOutcome: "validated",
          finalizedAt: "2026-04-02T00:00:00.000Z",
          isSuperseded: false,
        },
      ],
      latestRun: null,
    });

    expect(result.currentBundleId).toBe("bundle_new");
    expect(result.actionableBundleId).toBe("bundle_new");
    expect(result.dashboardMode).toBe("validated_actionable");
  });

  test("abstained current bundle removes actionability and retains prior validated context", () => {
    const result = selectCurrentBundle({
      partition: {
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
      },
      terminalBundles: [
        {
          bundleId: "bundle_abstain",
          bundleScope: "PRIMARY_PORTFOLIO",
          portfolioSnapshotId: "snapshot_1",
          profileHash: "p1",
          convictionHash: "c1",
          bundleOutcome: "abstained",
          finalizedAt: "2026-04-02T00:00:00.000Z",
          isSuperseded: false,
        },
        {
          bundleId: "bundle_prior_validated",
          bundleScope: "PRIMARY_PORTFOLIO",
          portfolioSnapshotId: "snapshot_1",
          profileHash: "p1",
          convictionHash: "c1",
          bundleOutcome: "validated",
          finalizedAt: "2026-04-01T00:00:00.000Z",
          isSuperseded: true,
        },
      ],
      latestRun: null,
    });

    expect(result.currentBundleId).toBe("bundle_abstain");
    expect(result.actionableBundleId).toBeNull();
    expect(result.historicalValidatedContextBundleId).toBe("bundle_prior_validated");
    expect(result.dashboardMode).toBe("abstained_summary_only");
  });

  test("failed runs do not replace current bundle", () => {
    const result = selectCurrentBundle({
      partition: {
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
      },
      terminalBundles: [],
      latestRun: {
        runId: "run_1",
        stage: "failed",
        failureCode: "UNHANDLED_EXCEPTION",
        completedAt: "2026-04-02T01:00:00.000Z",
      },
    });

    expect(result.currentBundleId).toBeNull();
    expect(result.dashboardMode).toBe("failed_run_prior_bundle_retained");
  });
});
