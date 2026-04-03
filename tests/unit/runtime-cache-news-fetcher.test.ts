import { clearRuntimeCacheStore } from "@/lib/cache";
import { fetchYahooFinanceFallback } from "@/lib/research/news-fetcher";

describe("runtime cache news fetcher", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearRuntimeCacheStore();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("reuses cache_layer-backed news search results across calls", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        news: [
          {
            title: "Apple extends rally",
            link: "https://example.com/apple-rally",
          },
        ],
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    const first = await fetchYahooFinanceFallback(["AAPL"]);
    const second = await fetchYahooFinanceFallback(["AAPL"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.summary).toContain("Apple extends rally");
  });
});
