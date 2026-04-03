import {
  buildLegacyArtifactIdentityKey,
  evaluateLegacyBackfillReadiness,
} from "@/lib/backfill";

describe("legacy backfill readiness", () => {
  test("coherent legacy artifact is ready for actionable backfill", () => {
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
        bundleArtifactId: null,
      })
    ).toBe("ready_for_actionable_backfill");
  });

  test("legacy artifact can be backfill-ready but not actionable-ready", () => {
    expect(
      evaluateLegacyBackfillReadiness({
        legacyArtifactId: "report_2",
        scope: {
          userId: "user_1",
          bundleScope: "PRIMARY_PORTFOLIO",
          analysisRunId: "run_2",
          portfolioSnapshotId: "snapshot_2",
        },
        hasSnapshot: true,
        hasRecommendations: true,
        hasReportContent: true,
        hasCoherentLinks: true,
        hasPersistedProfileSnapshot: false,
        hasPersistedConvictionsSnapshot: false,
        bundleArtifactId: null,
      })
    ).toBe("ready_for_backfill");
  });

  test("exact legacy artifact identity key is user scope plus run and snapshot scope", () => {
    expect(
      buildLegacyArtifactIdentityKey({
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        analysisRunId: "run_1",
        portfolioSnapshotId: "snapshot_1",
      })
    ).toBe("artifact::user_1::PRIMARY_PORTFOLIO::run_1::snapshot_1");
  });

  test("missing snapshot blocks backfill readiness", () => {
    expect(
      evaluateLegacyBackfillReadiness({
        legacyArtifactId: "report_3",
        scope: {
          userId: "user_1",
          bundleScope: "PRIMARY_PORTFOLIO",
          analysisRunId: "run_3",
          portfolioSnapshotId: null,
        },
        hasSnapshot: false,
        hasRecommendations: true,
        hasReportContent: true,
        hasCoherentLinks: true,
        hasPersistedProfileSnapshot: true,
        hasPersistedConvictionsSnapshot: true,
        bundleArtifactId: null,
      })
    ).toBe("not_backfillable_missing_snapshot");
  });
});
