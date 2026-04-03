import {
  buildConvictionNormalizationCacheKey,
  buildHoldingsNormalizationCacheKey,
} from "@/lib/cache";

describe("user-derived cache key scope", () => {
  test("conviction normalization cache key encodes exact user/profile/context scope", () => {
    expect(
      buildConvictionNormalizationCacheKey(
        {
          userId: "user_1",
          bundleScope: "PRIMARY_PORTFOLIO",
          profileHash: "profile_hash",
          convictionHash: "conviction_hash",
        },
        "parser_v1"
      )
    ).toBe("conviction_normalization_cache::user_1::PRIMARY_PORTFOLIO::profile_hash::conviction_hash::parser_v1");
  });

  test("holdings normalization cache key encodes exact snapshot scope", () => {
    expect(
      buildHoldingsNormalizationCacheKey(
        {
          userId: "user_1",
          bundleScope: "PRIMARY_PORTFOLIO",
          portfolioSnapshotId: "snapshot_1",
          portfolioSnapshotHash: "snapshot_hash",
        },
        "parser_v1"
      )
    ).toBe("holdings_normalization_cache::user_1::PRIMARY_PORTFOLIO::snapshot_1::snapshot_hash::parser_v1");
  });
});
