const mockCreate = jest.fn();
const mockFindUnique = jest.fn();

jest.mock("openai", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

jest.mock("@/lib/prisma", () => ({
  prisma: {
    appSettings: {
      findUnique: mockFindUnique,
    },
  },
}));

import {
  generatePortfolioReport,
  STAGE3_FULL_PROMPT_BUDGET,
} from "@/lib/analyzer";
import type { NewsResult } from "@/lib/research/types";

function buildNewsResult(): NewsResult {
  return {
    evidence: [],
    combinedSummary: "Research summary",
    breaking24h: "Breaking summary",
    allSources: [],
    usingFallback: false,
    availabilityStatus: "primary_success",
    degradedReason: null,
    statusSummary: "Primary live-news search succeeded and produced cited sources for this run.",
    issues: [],
    signals: {
      availabilityStatus: "primary_success",
      degradedReason: null,
      articleCount: 1,
      trustedSourceCount: 1,
      sourceDiversityCount: 1,
      recent24hCount: 1,
      recent7dCount: 1,
      directionalSupport: "positive",
      contradictionLevel: "low",
      catalystPresence: true,
      riskEventPresence: false,
      confidence: "medium",
      statusSummary: "Primary news available.",
      tickerSignals: {},
      issues: [],
    },
    fetchedAt: "2026-04-03T00:00:00.000Z",
  };
}

describe("analyzer stage3 full-prompt preflight", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    mockCreate.mockReset();
    mockFindUnique.mockReset();
    mockFindUnique.mockResolvedValue({ value: "false" });
  });

  test("aborts before model call when the final prompt exceeds the preflight budget", async () => {
    const hugeAdditionalContext = [
      "=== MARKET REGIME ===",
      "Risk mode: risk_on | Rates: falling",
      "Summary: calm regime",
      "=== END REGIME ===",
      "=== CANDIDATE POSITIONS TO EVALUATE ===",
      "These are NOT currently held. To recommend adding any:",
      "1. Evidence quality HIGH only",
      "2. Identify which existing position funds it",
      "3. Explain why better than increasing an existing position",
      "AVGO (Broadcom): fills AI gap",
      "=== END CANDIDATES ===",
      "X".repeat(STAGE3_FULL_PROMPT_BUDGET.maxTotalChars),
    ].join("\n");

    await expect(
      generatePortfolioReport(
        [
          {
            ticker: "AAPL",
            companyName: "Apple",
            shares: 10,
            currentPrice: 100,
            currentValue: 1000,
            isCash: false,
          },
        ],
        {
          birthYear: 1985,
          trackedAccountRiskTolerance: "medium",
          trackedAccountObjective: "growth",
        },
        {},
        undefined,
        [
          {
            ticker: "AAPL",
            targetShares: 10,
            targetWeight: 100,
            action: "Hold",
            role: "Core",
          },
        ],
        undefined,
        [],
        hugeAdditionalContext,
        buildNewsResult()
      )
    ).rejects.toMatchObject({
      name: "Stage3PreflightBudgetExceededError",
      preflight: expect.objectContaining({
        maxTotalChars: STAGE3_FULL_PROMPT_BUDGET.maxTotalChars,
        fitsBudget: false,
      }),
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });
});
