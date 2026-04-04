import { screenCandidates, screenCandidatesDetailed } from "@/lib/research/candidate-screener";

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

  test("macro-lane candidates use the same live-price validation gate as structural candidates", async () => {
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

    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: jest.fn(async (url: string) => {
        const ticker = decodeURIComponent(String(url).match(/chart\/([^?]+)/)?.[1] ?? "");
        if (ticker === "LMT") {
          return { ok: false, json: async () => ({}) };
        }
        return {
          ok: true,
          json: async () => ({
            chart: {
              result: [
                {
                  meta: { regularMarketPrice: 100 },
                  indicators: { quote: [{ close: [100, 101, 102] }] },
                },
              ],
            },
          }),
        };
      }),
    });

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

    expect(result.map((candidate) => candidate.ticker)).toEqual(["AAPL"]);
    expect(result.find((candidate) => candidate.source === "macro_lane")).toBeUndefined();
  });

  test("lite mode runs structural screening first and skips macro lanes when structural survivors are already sufficient", async () => {
    const openAi = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{
              message: {
                content: JSON.stringify([
                  { ticker: "AAPL", companyName: "Apple", reason: "Structural fit" },
                  { ticker: "AVGO", companyName: "Broadcom", reason: "Structural fit" },
                  { ticker: "LLY", companyName: "Eli Lilly", reason: "Structural fit" },
                ]),
              },
            }],
          }),
        },
      },
    };

    installFetchMock({ AAPL: 5, AVGO: 5, LLY: 5 });
    const result = await screenCandidatesDetailed(
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
      jest.fn(),
      { mode: "lite" }
    );

    expect(openAi.chat.completions.create).toHaveBeenCalledTimes(1);
    expect(result.candidates.map((candidate) => candidate.ticker)).toEqual(["AAPL", "AVGO", "LLY"]);
    expect(result.diagnostics.mode).toBe("lite");
    expect(result.diagnostics.stoppedEarly).toBe(true);
    expect(result.diagnostics.laneCountQueried).toBe(0);
    expect(result.diagnostics.skippedLaneIds).toEqual(["macro_lane:defense_fiscal_beneficiaries"]);
  });

  test("full mode stops early at lane boundaries once enough validated candidates survive", async () => {
    const openAi = {
      chat: {
        completions: {
          create: jest
            .fn()
            .mockResolvedValueOnce({
              choices: [{
                message: {
                  content: JSON.stringify([
                    { ticker: "AAPL", companyName: "Apple", reason: "Structural fit" },
                    { ticker: "AVGO", companyName: "Broadcom", reason: "Structural fit" },
                  ]),
                },
              }],
            })
            .mockResolvedValueOnce({
              choices: [{
                message: {
                  content: JSON.stringify([
                    { ticker: "LMT", companyName: "Lockheed Martin", reason: "Fits defense lane" },
                    { ticker: "RTX", companyName: "RTX", reason: "Fits defense lane" },
                    { ticker: "NOC", companyName: "Northrop Grumman", reason: "Fits defense lane" },
                  ]),
                },
              }],
            }),
        },
      },
    };

    installFetchMock({ AAPL: 5, AVGO: 5, LMT: 5, RTX: 5, NOC: 5 });
    const result = await screenCandidatesDetailed(
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
        {
          laneId: "macro_lane:shipping_resilience",
          laneKey: "shipping_resilience",
          description: "Shipping and logistics resilience.",
          allowedAssetClasses: ["Stocks", "ETFs"],
          searchTags: ["shipping resilience"],
          priority: 4,
          sortBehavior: "priority_then_ticker",
          origin: "environmental_gap",
          themeIds: ["macro_theme:shipping_disruption"],
          environmentalGapIds: ["env_gap:shipping_disruption"],
          bridgeRuleIds: ["bridge.shipping_corridors"],
          rationaleSummary: "Shipping disruption",
        },
      ],
      { trackedAccountRiskTolerance: "medium", permittedAssetClasses: "Stocks, ETFs" },
      "2026-04-02",
      jest.fn(),
      { mode: "full" }
    );

    expect(openAi.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(result.candidates.map((candidate) => candidate.ticker)).toEqual(["AAPL", "AVGO", "LMT", "NOC", "RTX"]);
    expect(result.diagnostics.mode).toBe("full");
    expect(result.diagnostics.stoppedEarly).toBe(true);
    expect(result.diagnostics.queriedLaneIds).toEqual(["macro_lane:defense_fiscal_beneficiaries"]);
    expect(result.diagnostics.skippedLaneIds).toEqual(["macro_lane:shipping_resilience"]);
    expect(result.diagnostics.skippedLanesDueToEnoughSurvivors).toBe(1);
  });
});
