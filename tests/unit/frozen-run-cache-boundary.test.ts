import {
  clearRuntimeCacheStore,
  freezeRuntimeEvidence,
  invalidateRuntimeCacheByDomain,
} from "@/lib/cache";
import { fetchYahooFinanceFallback } from "@/lib/research/news-fetcher";
import { freezeRunEvidenceSet } from "@/lib/research/analysis-orchestrator";

describe("frozen run cache boundary", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearRuntimeCacheStore();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("cache invalidation changes future reads but not already-frozen evidence", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          news: [{ title: "Initial headline", link: "https://example.com/initial" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          news: [{ title: "Refreshed headline", link: "https://example.com/refreshed" }],
        }),
      });
    global.fetch = fetchMock as typeof fetch;

    const first = await fetchYahooFinanceFallback(["AAPL"]);
    const frozen = freezeRunEvidenceSet(first);

    invalidateRuntimeCacheByDomain("news_search_cache");

    const second = await fetchYahooFinanceFallback(["AAPL"]);
    const standaloneFrozen = freezeRuntimeEvidence(first);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(frozen.summary).toContain("Initial headline");
    expect(standaloneFrozen.summary).toContain("Initial headline");
    expect(second.summary).toContain("Refreshed headline");
    expect(frozen.summary).not.toContain("Refreshed headline");
  });
});
