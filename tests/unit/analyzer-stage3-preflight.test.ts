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

function buildValidModelResponse() {
  return {
    model: "gpt-5.4",
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 800,
    },
    choices: [
      {
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            summary: "Maintain concentrated quality exposure while selectively adding infrastructure capacity.",
            reasoning: "The portfolio remains aligned with the stated objective.",
            evidenceQualitySummary: "Mixed evidence with enough support for incremental changes.",
            marketContext: {
              shortTerm: [],
              mediumTerm: [],
              longTerm: [],
            },
            recommendations: [
              {
                ticker: "AAPL",
                companyName: "Apple",
                role: "Core",
                currentShares: 10,
                currentPrice: 100,
                targetShares: 10,
                shareDelta: 0,
                dollarDelta: 0,
                currentWeight: 100,
                targetWeight: 100,
                acceptableRangeLow: 95,
                acceptableRangeHigh: 100,
                valueDelta: 0,
                action: "Hold",
                confidence: "medium",
                positionStatus: "on_target",
                evidenceQuality: "medium",
                thesisSummary: "Stable franchise with no forcing function to change sizing.",
                detailedReasoning: "SHORT-TERM: Stable.\nMID-TERM: Stable.\nLONG-TERM: Stable.",
                whyChanged: "No prior recommendation.",
                reasoningSources: [],
              },
            ],
            watchlistIdeas: [],
          }),
        },
      },
    ],
  };
}

describe("analyzer stage3 full-prompt preflight", () => {
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    mockCreate.mockReset();
    mockFindUnique.mockReset();
    mockFindUnique.mockResolvedValue({ value: "false" });
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  test("aborts before model call when the final prompt exceeds the preflight budget", async () => {
    const smallAdditionalContext = [
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
    ].join("\n");
    const hugeCustomPrompt = "User override directive. ".repeat(STAGE3_FULL_PROMPT_BUDGET.maxTotalChars);

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
        hugeCustomPrompt,
        [],
        smallAdditionalContext,
        buildNewsResult()
      )
    ).rejects.toMatchObject({
      name: "Stage3PreflightBudgetExceededError",
      preflight: expect.objectContaining({
        maxTotalChars: STAGE3_FULL_PROMPT_BUDGET.maxTotalChars,
        fitsBudget: false,
        lastResortFailure: true,
        recoveryAttempts: expect.any(Array),
      }),
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  test("recovers a slightly oversized final prompt by deterministically reducing lower-priority context", async () => {
    mockCreate.mockResolvedValue(buildValidModelResponse());

    const recoverableAdditionalContext = [
      "=== MARKET REGIME ===",
      "Risk mode: risk_on | Rates: falling | Dollar: weakening | VIX: low",
      "Risk assets remain supported and macro pressure is stable.",
      "=== END REGIME ===",
      "=== MACRO ENVIRONMENT (NORMALIZED) ===",
      "Collection: stable",
      "Consensus: calm macro backdrop",
      "Bridge: none",
      "Actionable themes: none",
      "Environmental gaps: none",
      "Macro candidate lanes: none",
      "Use macro as structured secondary context only.",
      "=== ⚡ BREAKING NEWS (last 24 hours — 2026-04-03) ===",
      "Breaking detail. ".repeat(220),
      "=== END BREAKING NEWS ===",
      "=== RESEARCH (30-day) ===",
      "Long-form research. ".repeat(900),
      "=== INTRADAY PRICE REACTIONS ===",
      "Reaction detail. ".repeat(220),
      "=== SENTIMENT SIGNALS (informational only — do NOT treat as a directional vote; use as a weak prior only) ===",
      "Signal detail. ".repeat(240),
      "=== VALUATION ANCHORS ===",
      "Valuation detail. ".repeat(320),
      "=== END VALUATION ANCHORS ===",
      "=== CORRELATION MATRIX (90-day) ===",
      "Correlation detail. ".repeat(320),
      "=== END CORRELATION MATRIX ===",
      "=== CANDIDATE POSITIONS TO EVALUATE ===",
      "These are NOT currently held. To recommend adding any:",
      "1. Evidence quality HIGH only",
      "2. Identify which existing position funds it",
      "3. Explain why better than increasing an existing position",
      "AVGO (Broadcom, $100.00): via gap_screener, lane: macro_lane:ai_infrastructure, catalyst: AI networking demand, reason: fills infrastructure gap",
      "RTX (RTX, $90.00): via macro_lane, lane: macro_lane:defense_fiscal_beneficiaries, catalyst: defense budget expansion, reason: policy beneficiary",
      "ETN (Eaton, $95.00): via macro_lane, lane: macro_lane:grid_upgrade, catalyst: grid capex, reason: electrification beneficiary",
      "=== END CANDIDATES ===",
    ].join("\n");

    const report = await generatePortfolioReport(
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
      recoverableAdditionalContext,
      buildNewsResult()
    );

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect((report as any)._meta.stage3PromptPreflight).toEqual(
      expect.objectContaining({
        fitsBudget: true,
        reductionApplied: true,
        usedReducedPromptShape: true,
        initialFullPromptChars: expect.any(Number),
        recoveryAttempts: expect.arrayContaining([
          expect.objectContaining({
            stepKey: "rebudget_lower_priority_sections",
          }),
        ]),
      })
    );
    expect((report as any)._meta.stage3PromptPreflight.fullPromptChars).toBeLessThanOrEqual(
      STAGE3_FULL_PROMPT_BUDGET.maxTotalChars
    );
  });
});
