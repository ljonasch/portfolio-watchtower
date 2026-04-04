import { clearRuntimeCacheStore } from "@/lib/cache";
import { buildNewsSignalSet, fetchAllNewsWithFallback, fetchAllNewsWithFallbackDetailed } from "@/lib/research/news-fetcher";

describe("news fetcher structured signals", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearRuntimeCacheStore();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  test("primary success path produces structured primary signals", async () => {
    const openai = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: `=== BREAKING 24H NEWS ===
[AAPL] Apple wins contract
=== MACRO & GEOPOLITICS ===
Rates remain stable
=== COMPANY-SPECIFIC ===
[AAPL] Apple beats earnings and raises guidance`,
                  annotations: [
                    {
                      type: "url_citation",
                      url_citation: {
                        title: "Reuters Apple",
                        url: "https://www.reuters.com/technology/apple-contract",
                      },
                    },
                    {
                      type: "url_citation",
                      url_citation: {
                        title: "Bloomberg Apple",
                        url: "https://www.bloomberg.com/news/apple-guidance",
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      },
    };

    const result = await fetchAllNewsWithFallback(openai, ["AAPL"], "2026-04-03");

    expect(result.availabilityStatus).toBe("primary_success");
    expect(result.usingFallback).toBe(false);
    expect(result.statusSummary).toContain("Primary live-news search succeeded");
    expect(result.issues).toEqual([]);
    expect(result.signals.availabilityStatus).toBe("primary_success");
    expect(result.signals.articleCount).toBeGreaterThan(0);
    expect(result.signals.tickerSignals.AAPL.directionalSupport).toBe("positive");
  });

  test("primary empty result falls back to Yahoo and keeps the empty-result reason explicit", async () => {
    const openai = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: "",
                  annotations: [],
                },
              },
            ],
          }),
        },
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        news: [{ title: "Apple fallback headline", link: "https://finance.yahoo.com/apple" }],
      }),
    }) as typeof fetch;

    const result = await fetchAllNewsWithFallback(openai, ["AAPL"], "2026-04-03");

    expect(result.availabilityStatus).toBe("fallback_success");
    expect(result.degradedReason).toBe("primary_empty_result");
    expect(result.usingFallback).toBe(true);
    expect(result.statusSummary).toContain("returned no usable results");
    expect(result.issues.map((issue) => issue.kind)).toEqual(
      expect.arrayContaining(["primary_empty_result", "fallback_used"])
    );
  });

  test("transport failure falls back and captures structured connection metadata", async () => {
    const error = Object.assign(new Error("Connection error."), {
      name: "APIConnectionError",
      code: "ECONNRESET",
      cause: new Error("socket hang up"),
    });
    const openai = {
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(error),
        },
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        news: [{ title: "Apple fallback headline", link: "https://finance.yahoo.com/apple" }],
      }),
    }) as typeof fetch;

    const result = await fetchAllNewsWithFallback(openai, ["AAPL"], "2026-04-03");
    const transportIssue = result.issues.find((issue) => issue.kind === "primary_transport_failure");

    expect(result.availabilityStatus).toBe("fallback_success");
    expect(result.degradedReason).toBe("primary_transport_failure");
    expect(transportIssue).toEqual(
      expect.objectContaining({
        name: "APIConnectionError",
        code: "ECONNRESET",
        cause: "socket hang up",
        retryPath: "yahoo_fallback",
      })
    );
  });

  test("rate-limit path remains diagnosable and falls back after exhausted retries", async () => {
    jest.useFakeTimers();
    const openai = {
      chat: {
        completions: {
          create: jest.fn().mockRejectedValue(Object.assign(new Error("Rate limited"), { status: 429 })),
        },
      },
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        news: [{ title: "Apple fallback headline", link: "https://finance.yahoo.com/apple" }],
      }),
    }) as typeof fetch;

    const promise = fetchAllNewsWithFallback(openai, ["AAPL"], "2026-04-03");
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result.availabilityStatus).toBe("fallback_success");
    expect(result.degradedReason).toBe("primary_rate_limited");
    expect(result.issues.filter((issue) => issue.kind === "primary_rate_limited").length).toBeGreaterThan(0);
  });

  test("structured signal derivation is deterministic for the same effective inputs", () => {
    const first = buildNewsSignalSet({
      tickers: ["MSFT", "AAPL"],
      combinedSummary: "[MSFT] Microsoft beats earnings\n[AAPL] Apple launches product",
      breaking24h: "[AAPL] Apple launches product",
      sources: [
        { title: "Reuters AAPL", url: "https://www.reuters.com/apple" },
        { title: "Bloomberg MSFT", url: "https://www.bloomberg.com/msft" },
      ],
      availabilityStatus: "primary_success",
      degradedReason: null,
      issues: [],
      usingFallback: false,
    });

    const second = buildNewsSignalSet({
      tickers: ["AAPL", "MSFT"],
      combinedSummary: "[MSFT] Microsoft beats earnings\n[AAPL] Apple launches product",
      breaking24h: "[AAPL] Apple launches product",
      sources: [
        { title: "Bloomberg MSFT", url: "https://www.bloomberg.com/msft" },
        { title: "Reuters AAPL", url: "https://www.reuters.com/apple" },
      ],
      availabilityStatus: "primary_success",
      degradedReason: null,
      issues: [],
      usingFallback: false,
    });

    expect(first).toEqual(second);
  });

  test("detailed ticker-news fetch diagnostics retain deterministic deduped sources", async () => {
    const openai = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: `=== BREAKING 24H NEWS ===
[AAPL] Apple extends AI partnership
=== MACRO & GEOPOLITICS ===
Rates remain stable
=== COMPANY-SPECIFIC ===
[AAPL] Apple extends AI partnership`,
                  annotations: [
                    {
                      type: "url_citation",
                      url_citation: {
                        title: "Reuters Apple",
                        url: "https://www.reuters.com/apple-ai",
                      },
                    },
                    {
                      type: "url_citation",
                      url_citation: {
                        title: "Reuters Apple duplicate",
                        url: "https://www.reuters.com/apple-ai",
                      },
                    },
                    {
                      type: "url_citation",
                      url_citation: {
                        title: "Bloomberg Apple",
                        url: "https://www.bloomberg.com/apple-ai",
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
      },
    };

    const result = await fetchAllNewsWithFallbackDetailed(openai, ["AAPL"], "2026-04-03");

    expect(result.newsResult.allSources).toEqual([
      expect.objectContaining({ url: "https://www.bloomberg.com/apple-ai", quality: "high" }),
      expect.objectContaining({ url: "https://www.reuters.com/apple-ai", quality: "high" }),
    ]);
    expect(result.diagnostics).toEqual(
      expect.objectContaining({
        providerCallCount: 1,
        retryCount: 0,
        resultState: "fresh",
        rawArticleCountFetched: 3,
        normalizedArticleCountRetained: 2,
        droppedArticleCount: 1,
        articleSetFingerprint: expect.any(String),
      })
    );
  });
});
