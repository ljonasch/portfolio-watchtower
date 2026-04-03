import {
  CACHE_LAYER_OWNER,
  assertCacheLayerWriter,
  createCacheWriteRequest,
} from "@/lib/cache";

describe("cache ownership", () => {
  test("cache layer is the only allowed writer", () => {
    expect(() => assertCacheLayerWriter("analysis_lifecycle_service")).toThrow(
      "Cache writes are owned exclusively by cache_layer"
    );
  });

  test("cache write requests are created with the canonical owner only", () => {
    const request = createCacheWriteRequest(
      "price_snapshot_cache",
      "price_snapshot_cache::AAPL::2026-04-02::provider_v1",
      { close: 100 },
      "provider_v1"
    );

    expect(request.writer).toBe(CACHE_LAYER_OWNER);
  });
});
