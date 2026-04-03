import { screenCandidates } from "@/lib/research/candidate-screener";

type CandidateFixture = {
  ticker: string;
  companyName: string;
  reason: string;
  catalyst?: string;
  analystRating?: string;
};

const originalFetch = global.fetch;

function buildOpenAi(candidates: CandidateFixture[]) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify(candidates),
              },
            },
          ],
        }),
      },
    },
  };
}

function installFetchMock(delays: Record<string, number>) {
  Object.defineProperty(global, "fetch", {
    configurable: true,
    writable: true,
    value: jest.fn(async (url: string) => {
      const ticker = decodeURIComponent(String(url).match(/chart\/([^?]+)/)?.[1] ?? "");
      const delay = delays[ticker] ?? 0;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      return {
        ok: true,
        json: async () => ({
          chart: {
            result: [
              {
                meta: { regularMarketPrice: 100 },
                indicators: {
                  quote: [{ close: [100, 102, 103] }],
                },
              },
            ],
          },
        }),
      };
    }),
  });
}

function pickStableShape(result: Awaited<ReturnType<typeof screenCandidates>>) {
  return result.map((candidate) => ({
    ticker: candidate.ticker,
    companyName: candidate.companyName,
    source: candidate.source,
    candidateOrigin: candidate.candidateOrigin,
    discoveryLaneId: candidate.discoveryLaneId ?? null,
    reason: candidate.reason,
    catalyst: candidate.catalyst ?? null,
    validatedPrice: candidate.validatedPrice ?? null,
  }));
}

describe("candidate screener determinism", () => {
  afterEach(() => {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: originalFetch,
    });
  });

  test("same effective inputs return identical validated candidates despite different async validation completion order", async () => {
    const rawCandidates: CandidateFixture[] = [
      { ticker: "MSFT", companyName: "Microsoft", reason: "Cloud and AI leader" },
      { ticker: "AAPL", companyName: "Apple", reason: "Consumer ecosystem strength" },
      { ticker: "NVDA", companyName: "NVIDIA", reason: "AI accelerator leader" },
    ];

    installFetchMock({ MSFT: 30, AAPL: 5, NVDA: 15 });
    const first = await screenCandidates(
      buildOpenAi(rawCandidates),
      ["AMZN"],
      "Find high-quality large-cap additions.",
      [],
      { trackedAccountRiskTolerance: "medium", permittedAssetClasses: "Stocks, ETFs" },
      "2026-04-02",
      jest.fn()
    );

    installFetchMock({ MSFT: 5, AAPL: 30, NVDA: 10 });
    const second = await screenCandidates(
      buildOpenAi(rawCandidates),
      ["AMZN"],
      "Find high-quality large-cap additions.",
      [],
      { trackedAccountRiskTolerance: "medium", permittedAssetClasses: "Stocks, ETFs" },
      "2026-04-02",
      jest.fn()
    );

    expect(pickStableShape(first)).toEqual(pickStableShape(second));
    expect(first.map((candidate) => candidate.ticker)).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  test("same candidate set returns the same final order even when raw model order changes", async () => {
    const firstRawOrder: CandidateFixture[] = [
      { ticker: "MSFT", companyName: "Microsoft", reason: "Cloud and AI leader" },
      { ticker: "AAPL", companyName: "Apple", reason: "Consumer ecosystem strength" },
      { ticker: "NVDA", companyName: "NVIDIA", reason: "AI accelerator leader" },
    ];
    const secondRawOrder: CandidateFixture[] = [
      { ticker: "NVDA", companyName: "NVIDIA", reason: "AI accelerator leader" },
      { ticker: "MSFT", companyName: "Microsoft", reason: "Cloud and AI leader" },
      { ticker: "AAPL", companyName: "Apple", reason: "Consumer ecosystem strength" },
    ];

    installFetchMock({ MSFT: 10, AAPL: 20, NVDA: 5 });
    const first = await screenCandidates(
      buildOpenAi(firstRawOrder),
      ["AMZN"],
      "Find high-quality large-cap additions.",
      [],
      { trackedAccountRiskTolerance: "medium", permittedAssetClasses: "Stocks, ETFs" },
      "2026-04-02",
      jest.fn()
    );

    installFetchMock({ MSFT: 10, AAPL: 20, NVDA: 5 });
    const second = await screenCandidates(
      buildOpenAi(secondRawOrder),
      ["AMZN"],
      "Find high-quality large-cap additions.",
      [],
      { trackedAccountRiskTolerance: "medium", permittedAssetClasses: "Stocks, ETFs" },
      "2026-04-02",
      jest.fn()
    );

    expect(pickStableShape(first)).toEqual(pickStableShape(second));
    expect(second.map((candidate) => candidate.ticker)).toEqual(["AAPL", "MSFT", "NVDA"]);
  });

  test("macro-lane candidates preserve provenance and still go through the normal validation path", async () => {
    const openAi = {
      chat: {
        completions: {
          create: jest
            .fn()
            .mockResolvedValueOnce({
              choices: [{ message: { content: JSON.stringify([{ ticker: "AAPL", companyName: "Apple", reason: "Structural fit" }]) } }],
            })
            .mockResolvedValueOnce({
              choices: [{ message: { content: JSON.stringify([{ ticker: "LMT", companyName: "Lockheed Martin", reason: "Fits defense lane" }]) } }],
            }),
        },
      },
    };

    installFetchMock({ AAPL: 5, LMT: 5 });
    const result = await screenCandidates(
      openAi,
      ["MSFT"],
      "Find high-quality large-cap additions.",
      [
        {
          laneId: "macro_lane:defense_fiscal_beneficiaries",
          laneKey: "defense_fiscal_beneficiaries",
          description: "Defense and fiscal beneficiaries.",
          allowedAssetClasses: ["Stocks", "ETFs"],
          searchTags: ["defense primes"],
          priority: 1,
          sortBehavior: "priority_then_ticker",
          origin: "environmental_gap",
          themeIds: ["macro_theme:defense_fiscal_upcycle"],
          environmentalGapIds: ["env_gap:defense_fiscal_upcycle"],
          bridgeRuleIds: ["bridge.defense_procurement"],
          rationaleSummary: "Defense spending upcycle",
        },
      ],
      { trackedAccountRiskTolerance: "medium", permittedAssetClasses: "Stocks, ETFs" },
      "2026-04-02",
      jest.fn()
    );

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ticker: "LMT",
          source: "macro_lane",
          candidateOrigin: "macro_lane",
          discoveryLaneId: "macro_lane:defense_fiscal_beneficiaries",
          macroThemeIds: ["macro_theme:defense_fiscal_upcycle"],
          environmentalGapIds: ["env_gap:defense_fiscal_upcycle"],
          validatedPrice: 100,
        }),
      ])
    );
  });
});
