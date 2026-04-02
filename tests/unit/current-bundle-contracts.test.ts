import type { CurrentBundleSelectionInput, CurrentBundleSelectionResult } from "@/lib/contracts";

describe("current bundle contract fixtures", () => {
  test("selection input makes the partition explicit", () => {
    const input: CurrentBundleSelectionInput = {
      partition: {
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_2",
        profileHash: "profile_hash_v2",
        convictionHash: "conviction_hash_v3",
      },
      terminalBundles: [
        {
          bundleId: "bundle_old",
          bundleScope: "PRIMARY_PORTFOLIO",
          portfolioSnapshotId: "snapshot_1",
          profileHash: "profile_hash_v1",
          convictionHash: "conviction_hash_v1",
          bundleOutcome: "validated",
          finalizedAt: "2026-04-01T09:00:00.000Z",
          isSuperseded: true,
        },
        {
          bundleId: "bundle_new",
          bundleScope: "PRIMARY_PORTFOLIO",
          portfolioSnapshotId: "snapshot_2",
          profileHash: "profile_hash_v2",
          convictionHash: "conviction_hash_v3",
          bundleOutcome: "abstained",
          finalizedAt: "2026-04-02T09:00:00.000Z",
          isSuperseded: false,
        },
      ],
      latestRun: {
        runId: "run_2",
        stage: "finalized_abstained",
        failureCode: null,
        completedAt: "2026-04-02T09:00:00.000Z",
      },
    };

    expect(input.partition.bundleScope).toBe("PRIMARY_PORTFOLIO");
    expect(input.partition.portfolioSnapshotId).toBe("snapshot_2");
  });

  test("selection result can represent abstained current bundle with historical validated context", () => {
    const result: CurrentBundleSelectionResult = {
      currentBundleId: "bundle_new",
      actionableBundleId: null,
      historicalValidatedContextBundleId: "bundle_old_validated",
      dashboardMode: "abstained_summary_only",
    };

    expect(result.actionableBundleId).toBeNull();
    expect(result.historicalValidatedContextBundleId).toBe("bundle_old_validated");
  });

  test("selection result can represent failed-run prior bundle retained state", () => {
    const result: CurrentBundleSelectionResult = {
      currentBundleId: "bundle_prior",
      actionableBundleId: "bundle_prior",
      historicalValidatedContextBundleId: null,
      dashboardMode: "failed_run_prior_bundle_retained",
    };

    expect(result.currentBundleId).toBe("bundle_prior");
    expect(result.dashboardMode).toBe("failed_run_prior_bundle_retained");
  });
});
