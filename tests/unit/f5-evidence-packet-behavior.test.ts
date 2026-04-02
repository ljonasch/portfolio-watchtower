const mockOpenAiCreate = jest.fn().mockResolvedValue({
  choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
});

const mockAnalysisRunUpdate = jest.fn().mockResolvedValue(undefined);
const mockGeneratePortfolioReport = jest.fn();
const mockWriteEvidencePacket = jest.fn().mockRejectedValue(new Error("ep write failed"));

jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockOpenAiCreate,
      },
    },
  })),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    portfolioSnapshot: {
      findUnique: jest.fn().mockResolvedValue({
        id: "snap-1",
        userId: "user-1",
        createdAt: new Date("2026-04-01T12:00:00.000Z"),
        holdings: [
          {
            id: "hold-1",
            ticker: "AAPL",
            isCash: false,
            computedWeight: 1,
            shares: 10,
            currentPrice: 100,
            currentValue: 1000,
          },
        ],
      }),
    },
    analysisRun: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: "run-1" }),
      update: mockAnalysisRunUpdate,
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "user-1",
        profile: { riskTolerance: "medium" },
        convictions: [],
      }),
    },
    appSettings: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    portfolioReport: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock("@/lib/analyzer", () => ({
  generatePortfolioReport: mockGeneratePortfolioReport,
}));

jest.mock("@/lib/comparator", () => ({
  compareRecommendations: jest.fn(),
}));

jest.mock("@/lib/alerts", () => ({
  evaluateAlert: jest.fn(),
}));

jest.mock("@/lib/research/market-regime", () => ({
  detectMarketRegime: jest.fn().mockResolvedValue({
    riskMode: "neutral",
    rateTrend: "flat",
    dollarTrend: "flat",
    vixLevel: "low",
    summary: "stable",
  }),
}));

jest.mock("@/lib/research/gap-analyzer", () => ({
  runGapAnalysis: jest.fn().mockResolvedValue({
    searchBrief: "focus on quality",
  }),
}));

jest.mock("@/lib/research/candidate-screener", () => ({
  screenCandidates: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/research/news-fetcher", () => ({
  fetchAllNewsWithFallback: jest.fn().mockResolvedValue({
    combinedSummary: "AAPL headline",
    breaking24h: "",
    usingFallback: false,
  }),
}));

jest.mock("@/lib/research/price-timeline", () => ({
  fetchPriceTimelines: jest.fn().mockResolvedValue(
    new Map([
      [
        "AAPL",
        {
          ticker: "AAPL",
          exchange: "NASDAQ",
          bars: [{ close: 100 }],
          reactions: [],
          dayChangePct: 0,
          marketClosed: false,
        },
      ],
    ])
  ),
}));

jest.mock("@/lib/research/sentiment-scorer", () => ({
  scoreSentimentForAll: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock("@/lib/research/signal-aggregator", () => ({
  buildSentimentOverlay: jest.fn(),
}));

jest.mock("@/lib/research/context-loader", () => ({
  buildResearchContext: jest.fn().mockImplementation(({ holdings, customPrompt }) => ({
    today: "2026-04-02",
    holdings,
    customPrompt,
  })),
}));

jest.mock("@/lib/research/valuation-fetcher", () => ({
  fetchValuationForAll: jest.fn().mockResolvedValue([]),
  formatValuationSection: jest.fn().mockReturnValue(""),
}));

jest.mock("@/lib/research/correlation-matrix", () => ({
  buildCorrelationMatrix: jest.fn().mockResolvedValue([]),
  formatCorrelationSection: jest.fn().mockReturnValue(""),
}));

jest.mock("@/lib/research/model-tracker", () => ({
  recordRunStats: jest.fn(),
}));

jest.mock("@/lib/research/evidence-packet-builder", () => ({
  buildPromptHash: jest.fn().mockReturnValue("deadbeefdeadbeef"),
  buildPerSectionChars: jest.fn().mockReturnValue({}),
  writeEvidencePacket: mockWriteEvidencePacket,
  updateEvidencePacketOutcome: jest.fn(),
}));

import { runFullAnalysis } from "@/lib/research/analysis-orchestrator";

describe("F5 behavior - EvidencePacket persist failure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    mockOpenAiCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    });
    mockWriteEvidencePacket.mockRejectedValue(new Error("ep write failed"));
  });

  test("throws typed abstain, marks the run abstained, and never reaches the primary LLM call", async () => {
    const emit = jest.fn();

    let thrown: unknown;
    try {
      await runFullAnalysis("snap-1", undefined, emit);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeTruthy();
    expect((thrown as Error).message).toContain("evidence_packet_persist_failed");

    expect(mockGeneratePortfolioReport).not.toHaveBeenCalled();
    expect(mockAnalysisRunUpdate).toHaveBeenCalledTimes(1);
    expect(mockAnalysisRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-1" },
        data: expect.objectContaining({
          status: "abstained",
        }),
      })
    );

    const updatePayload = mockAnalysisRunUpdate.mock.calls[0][0].data;
    expect(updatePayload.errorMessage).toBe("ep write failed");
    expect(JSON.parse(updatePayload.qualityMeta).abstainReason).toBe("evidence_packet_persist_failed");
  });
});
