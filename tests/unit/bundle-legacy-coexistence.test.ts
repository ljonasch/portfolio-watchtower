import {
  buildBundleArtifactIdentityKey,
  buildLegacyReportArtifactIdentityKey,
  classifyBundleHistoryArtifact,
  classifyLegacyReadOnlyArtifact,
  resolveBundleLegacyCoexistence,
} from "@/lib/backfill";

describe("bundle and legacy coexistence", () => {
  test("bundle wins and suppresses legacy when both share the same artifact identity", () => {
    const key = buildBundleArtifactIdentityKey({
      userId: "user_1",
      bundleScope: "PRIMARY_PORTFOLIO",
      sourceRunId: "run_1",
      portfolioSnapshotId: "snapshot_1",
    });

    expect(
      resolveBundleLegacyCoexistence({
        bundleArtifactIdentityKey: key,
        legacyArtifactIdentityKey: buildLegacyReportArtifactIdentityKey({
          userId: "user_1",
          bundleScope: "PRIMARY_PORTFOLIO",
          analysisRunId: "run_1",
          portfolioSnapshotId: "snapshot_1",
        }),
      })
    ).toEqual({
      preferredSource: "bundle",
      suppressLegacy: true,
    });
  });

  test("legacy artifact is explicitly classified as legacy_read_only", () => {
    expect(classifyLegacyReadOnlyArtifact()).toBe("legacy_read_only");
  });

  test("backfilled bundles carry explicit provenance classification", () => {
    expect(
      classifyBundleHistoryArtifact({
        evidencePacketJson: JSON.stringify({ origin: "backfilled_legacy" }),
      })
    ).toBe("backfilled_legacy");
  });
});
