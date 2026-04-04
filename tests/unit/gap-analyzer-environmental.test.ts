import { deriveEnvironmentalGaps, runStructuralGapAnalysisDetailed } from "@/lib/research/gap-analyzer";
import type { GapReport, HoldingInput, MacroExposureBridgeResult, MacroThemeConsensusResult } from "@/lib/research/types";

describe("environmental gap derivation", () => {
  test("derives deterministic environmental gaps from actionable themes and bridge hits", () => {
    const holdings: HoldingInput[] = [
      {
        ticker: "AAPL",
        companyName: "Apple",
        shares: 10,
        currentPrice: 100,
        currentValue: 1000,
        computedValue: 1000,
        computedWeight: 50,
        isCash: false,
      },
    ];
    const structuralGapReport: GapReport = {
      gaps: [],
      structuralGaps: [],
      environmentalGaps: [],
      candidateSearchLanes: [],
      searchBrief: "Diversified growth opportunities",
      profilePreferences: "AI, defense",
    };
    const macroConsensus: MacroThemeConsensusResult = {
      availabilityStatus: "primary_success",
      degradedReason: null,
      thresholds: {
        minSupportingArticles: 3,
        minTrustedSupportingArticles: 2,
        minDistinctPublishers: 2,
        minSupportRatio: 0.7,
        minRecentSupportingArticles7d: 2,
      },
      statusSummary: "1 actionable theme",
      themes: [
        {
          themeId: "macro_theme:defense_fiscal_upcycle",
          themeKey: "defense_fiscal_upcycle",
          themeLabel: "Defense / Fiscal / Industrial Policy",
          queryFamilies: ["defense_fiscal_industrial_policy"],
          supportingArticleIds: ["d1", "d2", "d3"],
          counterArticleIds: [],
          supportingArticleCount: 3,
          trustedSupportingCount: 3,
          distinctPublisherCount: 3,
          supportRatio: 1,
          contradictionLevel: "low",
          recentSupportingCount7d: 3,
          confidence: "high",
          severity: "high",
          actionable: true,
          exposureTags: ["defense_spending"],
          candidateSearchTags: ["defense primes"],
          summary: "Defense cleared the gate.",
        },
      ],
    };
    const macroBridge: MacroExposureBridgeResult = {
      statusSummary: "1 bridge hit",
      hits: [
        {
          bridgeHitId: "hit1",
          ruleId: "bridge.defense_procurement",
          themeId: "macro_theme:defense_fiscal_upcycle",
          matchedToken: "nato",
          exposureTags: ["defense_spending", "industrial_policy"],
          environmentalGapHints: ["procurement_beneficiary_review", "industrial_policy_beneficiary_review"],
          laneHints: ["defense_fiscal_beneficiaries"],
          sectorTags: ["Defense"],
          sensitivityTags: ["policy_beneficiary"],
          rationaleSummary: "Defense procurement rule fired.",
        },
      ],
    };

    const first = deriveEnvironmentalGaps({
      holdings,
      structuralGapReport,
      profile: { sectorsToEmphasize: "AI" },
      marketRegime: { riskMode: "risk-on", rateTrend: "flat" },
      macroConsensus,
      macroBridge,
    });
    const second = deriveEnvironmentalGaps({
      holdings,
      structuralGapReport,
      profile: { sectorsToEmphasize: "AI" },
      marketRegime: { riskMode: "risk-on", rateTrend: "flat" },
      macroConsensus,
      macroBridge,
    });

    expect(first).toEqual(second);
    expect(first[0]).toEqual(
      expect.objectContaining({
        gapId: "env_gap:defense_fiscal_upcycle",
        openCandidateDiscovery: true,
        bridgeRuleIds: ["bridge.defense_procurement"],
        candidateSearchTags: ["defense_fiscal_beneficiaries"],
      })
    );
  });

  test("structural gap prompts omit date framing and stay keyed to stable portfolio inputs", async () => {
    const create = jest
      .fn()
      .mockResolvedValue({
        choices: [{ message: { content: "" } }],
      });
    const openai = {
      chat: {
        completions: {
          create,
        },
      },
    };

    await runStructuralGapAnalysisDetailed(
      openai,
      [{ ticker: "MSFT", currentWeight: 100, isCash: false }],
      { trackedAccountObjective: "Growth", sectorsToEmphasize: "AI" },
      "2026-04-03",
      jest.fn()
    );

    expect(create).toHaveBeenCalledTimes(2);
    const promptContents = create.mock.calls.map((call) => call[0].messages[0].content);
    expect(promptContents).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Analyze this portfolio: MSFT (100.0%)"),
      ])
    );
    for (const prompt of promptContents) {
      expect(prompt).not.toContain("Today is");
      expect(prompt).not.toContain("2026-04-03");
    }
  });
});
