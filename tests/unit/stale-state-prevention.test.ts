import { evaluateFrozenRunInvalidation, type CacheInvalidationTrigger } from "@/lib/cache";

describe("stale-state prevention", () => {
  test("cache invalidation after evidence freeze cannot affect the frozen run", () => {
    const frozenDecision = evaluateFrozenRunInvalidation(
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
        type: "provider_version_changed",
        domain: "price_snapshot_cache",
        providerVersion: "provider_v2",
      } satisfies CacheInvalidationTrigger
    );

    expect(frozenDecision.affectsFrozenRun).toBe(false);
    expect(frozenDecision.affectsFutureRuns).toBe(true);
    expect(frozenDecision.reason).toContain("future runs");
  });
});
