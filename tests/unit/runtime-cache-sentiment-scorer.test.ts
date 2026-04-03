import { clearRuntimeCacheStore } from "@/lib/cache";
import { scoreTickerSentiment } from "@/lib/research/sentiment-scorer";

describe("runtime cache sentiment scorer", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearRuntimeCacheStore();
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("reuses cache_layer-backed sentiment extraction outputs across calls", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [[{ label: "positive", score: 0.9 }]],
    });
    global.fetch = fetchMock as typeof fetch;

    const articles = [
      {
        title: "Apple beats estimates",
        text: "Apple beats estimates",
        publishedAt: "2026-04-02T10:00:00.000Z",
      },
    ];

    const first = await scoreTickerSentiment("AAPL", articles, [], "hf_key", () => {});
    const second = await scoreTickerSentiment("AAPL", articles, [], "hf_key", () => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.finalScore).toBe(second.finalScore);
    expect(first.direction).toBe("buy");
  });
});
