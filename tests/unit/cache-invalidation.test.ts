import {
  getCacheInvalidationTargets,
  type CacheInvalidationTrigger,
} from "@/lib/cache";

describe("cache invalidation", () => {
  test("conviction invalidation targets the exact user/profile/context scope", () => {
    const trigger: CacheInvalidationTrigger = {
      type: "conviction_edited",
      scope: {
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        profileHash: "profile_hash",
        convictionHash: "conviction_hash",
      },
      parserVersion: "parser_v1",
    };

    expect(getCacheInvalidationTargets(trigger)).toEqual([
      {
        domain: "conviction_normalization_cache",
        scopeKey: "user_1:PRIMARY_PORTFOLIO:profile_hash:conviction_hash:parser_v1",
        reason: expect.stringContaining("exact user/profile/context scope"),
      },
    ]);
  });

  test("snapshot replacement targets the exact snapshot scope", () => {
    const trigger: CacheInvalidationTrigger = {
      type: "snapshot_replaced",
      scope: {
        userId: "user_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
        portfolioSnapshotHash: "snapshot_hash",
      },
      parserVersion: "parser_v2",
    };

    expect(getCacheInvalidationTargets(trigger)).toEqual([
      {
        domain: "holdings_normalization_cache",
        scopeKey: "user_1:PRIMARY_PORTFOLIO:snapshot_1:snapshot_hash:parser_v2",
        reason: expect.stringContaining("exact snapshot scope"),
      },
    ]);
  });

  test("article body changes invalidate both article and downstream sentiment caches", () => {
    const targets = getCacheInvalidationTargets({
      type: "article_body_changed",
      articleChecksum: "article_checksum",
    });

    expect(targets).toEqual([
      {
        domain: "article_body_cache",
        scopeKey: "article_checksum",
        reason: "article body changed",
      },
      {
        domain: "sentiment_extraction_cache",
        scopeKey: "article_checksum",
        reason: "article body changed invalidates downstream sentiment extraction",
      },
    ]);
  });
});
