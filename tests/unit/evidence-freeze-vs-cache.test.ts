import {
  buildEvidencePacketCacheMetadataKey,
  evaluateFrozenRunInvalidation,
} from "@/lib/cache";

describe("evidence freeze vs cache invalidation", () => {
  test("frozen run metadata key is stable and fully scoped", () => {
    expect(
      buildEvidencePacketCacheMetadataKey({
        runId: "run_1",
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
        portfolioSnapshotHash: "snapshot_hash",
        profileHash: "profile_hash",
        convictionHash: "conviction_hash",
        evidenceHash: "evidence_hash",
      })
    ).toBe(
      "evidence_packet_cache_metadata::run_1::user_1::PRIMARY_PORTFOLIO::snapshot_1::snapshot_hash::profile_hash::conviction_hash::evidence_hash"
    );
  });

  test("later cache refresh cannot alter an already-frozen run evidence set", () => {
    const decision = evaluateFrozenRunInvalidation(
      {
        runId: "run_1",
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
        portfolioSnapshotHash: "snapshot_hash",
        profileHash: "profile_hash",
        convictionHash: "conviction_hash",
        evidenceHash: "evidence_hash",
      },
      {
        type: "new_market_session",
        marketDate: "2026-04-03",
      }
    );

    expect(decision.affectsFrozenRun).toBe(false);
    expect(decision.reason).toContain("remains immutable");
  });
});
