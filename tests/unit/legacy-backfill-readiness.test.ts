import { evaluateLegacyBackfillReadiness } from "@/lib/backfill";

describe("legacy backfill readiness", () => {
  test("coherent legacy artifact is ready for backfill", () => {
    expect(
      evaluateLegacyBackfillReadiness({
        legacyArtifactId: "report_1",
        scope: {
          userId: "user_1",
          bundleScope: "PRIMARY_PORTFOLIO",
          analysisRunId: "run_1",
          portfolioSnapshotId: "snapshot_1",
        },
        hasSnapshot: true,
        hasRecommendations: true,
        hasReportContent: true,
        hasCoherentLinks: true,
        bundleArtifactId: null,
      })
    ).toBe("ready_for_backfill");
  });

  test("missing snapshot blocks backfill readiness", () => {
    expect(
      evaluateLegacyBackfillReadiness({
        legacyArtifactId: "report_2",
        scope: {
          userId: "user_1",
          bundleScope: "PRIMARY_PORTFOLIO",
          analysisRunId: "run_2",
          portfolioSnapshotId: null,
        },
        hasSnapshot: false,
        hasRecommendations: true,
        hasReportContent: true,
        hasCoherentLinks: true,
        bundleArtifactId: null,
      })
    ).toBe("not_backfillable_missing_snapshot");
  });
});
