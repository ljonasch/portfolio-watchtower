import { clearRuntimeCacheStore } from "@/lib/cache";
import { fetchPriceTimelines } from "@/lib/research/price-timeline";

describe("runtime cache price timeline", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearRuntimeCacheStore();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("reuses cache_layer-backed price snapshots across calls", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            {
              timestamp: [1712050200, 1712050500],
              meta: {
                previousClose: 100,
                tradingPeriods: {
                  regular: [[{ start: 1712050200, end: 1712073600 }]],
                },
              },
              indicators: {
                quote: [
                  {
                    close: [101, 102],
                    volume: [1000, 1200],
                  },
                ],
              },
            },
          ],
        },
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    const articleMap = new Map([
      [
        "AAPL",
        [{ title: "Apple event", publishedAt: "2026-04-02T14:30:00.000Z" }],
      ],
    ]);

    const first = await fetchPriceTimelines(["AAPL"], articleMap, "2026-04-02", () => {});
    const second = await fetchPriceTimelines(["AAPL"], articleMap, "2026-04-02", () => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.get("AAPL")).toEqual(second.get("AAPL"));
    expect(first.get("AAPL")?.bars).toHaveLength(2);
  });
});
