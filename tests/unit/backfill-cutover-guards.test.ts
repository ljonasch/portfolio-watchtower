import {
  classifyLegacyReadOnlyArtifact,
  evaluateLegacyBackfillReadiness,
} from "@/lib/backfill";

describe("backfill cutover guards", () => {
  test("legacy fallback remains explicitly legacy_read_only when no bundle exists", () => {
    expect(classifyLegacyReadOnlyArtifact()).toBe("legacy_read_only");
  });

  test("legacy artifact with existing bundle is treated as legacy_only", () => {
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
        hasPersistedProfileSnapshot: true,
        hasPersistedConvictionsSnapshot: true,
        bundleArtifactId: "bundle_1",
      })
    ).toBe("legacy_only");
  });
});
