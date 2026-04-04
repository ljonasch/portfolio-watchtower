import { clearRuntimeCacheStore } from "@/lib/cache";
import { fetchValuationForAllDetailed } from "@/lib/research/valuation-fetcher";

describe("runtime cache valuation fetcher", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearRuntimeCacheStore();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("reuses cache-backed valuation snapshots within the daily window", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        quoteSummary: {
          result: [
            {
              summaryDetail: {
                trailingPE: { raw: 25 },
                forwardPE: { raw: 22 },
                fiftyTwoWeekHigh: { raw: 220 },
                fiftyTwoWeekLow: { raw: 140 },
              },
              defaultKeyStatistics: {
                priceToBook: { raw: 12 },
              },
              financialData: {
                currentPrice: { raw: 200 },
                targetMeanPrice: { raw: 230 },
              },
            },
          ],
        },
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    const first = await fetchValuationForAllDetailed(["AAPL"], "2026-04-02", () => {});
    const second = await fetchValuationForAllDetailed(["AAPL"], "2026-04-02", () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.valuations.get("AAPL")).toEqual(second.valuations.get("AAPL"));
    expect(second.diagnostics.providerCallCount).toBe(0);
    expect(second.diagnostics.cacheHitCount).toBe(1);
    expect(second.diagnostics.resultState).toBe("cache_hit");
  });
});
