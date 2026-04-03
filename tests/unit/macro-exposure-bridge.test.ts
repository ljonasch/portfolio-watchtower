import { applyMacroExposureBridge, MACRO_EXPOSURE_BRIDGE_RULES } from "@/lib/research/macro-exposure-bridge";
import type { MacroNewsEnvironmentResult, MacroThemeConsensusResult } from "@/lib/research/types";

describe("macro exposure bridge", () => {
  test("fires deterministic indirect bridge hits even when downstream exposure words are absent", () => {
    const environment: MacroNewsEnvironmentResult = {
      availabilityStatus: "primary_success",
      degradedReason: null,
      statusSummary: "ok",
      articleCount: 3,
      trustedArticleCount: 3,
      distinctPublisherCount: 3,
      sourceDiversity: { distinctPublishers: 3, trustedPublishers: 3, trustedRatio: 1 },
      issues: [],
      articles: [
        {
          articleId: "ship1",
          canonicalUrl: "https://www.reuters.com/ship1",
          title: "Red Sea attacks force carriers onto longer routes",
          publisher: "reuters.com",
          publishedAt: null,
          publishedAtBucket: "last_7d",
          trusted: true,
          queryFamily: "geopolitics_shipping_supply_chain",
          retrievalReason: "global macro environment",
          topicHints: ["war", "shipping"],
          dedupKey: "ship1",
          stableSortKey: "0:ship1",
          evidenceHash: "ship1",
        },
      ],
    };

    const consensus: MacroThemeConsensusResult = {
      availabilityStatus: "primary_success",
      degradedReason: null,
      thresholds: {
        minSupportingArticles: 3,
        minTrustedSupportingArticles: 2,
        minDistinctPublishers: 2,
        minSupportRatio: 0.7,
        minRecentSupportingArticles7d: 2,
      },
      statusSummary: "1 actionable macro theme",
      themes: [
        {
          themeId: "macro_theme:shipping_disruption",
          themeKey: "shipping_disruption",
          themeLabel: "Shipping / Supply Chain Disruption",
          queryFamilies: ["geopolitics_shipping_supply_chain"],
          supportingArticleIds: ["ship1", "ship2", "ship3"],
          counterArticleIds: [],
          supportingArticleCount: 3,
          trustedSupportingCount: 3,
          distinctPublisherCount: 3,
          supportRatio: 1,
          contradictionLevel: "low",
          recentSupportingCount7d: 3,
          confidence: "high",
          severity: "medium",
          actionable: true,
          exposureTags: ["supply_chain_resilience", "logistics_exposure"],
          candidateSearchTags: ["shipping resilience"],
          summary: "Shipping disruption cleared the gate.",
        },
      ],
    };

    const result = applyMacroExposureBridge({ consensus, environment });

    expect(MACRO_EXPOSURE_BRIDGE_RULES.map((rule) => rule.ruleId)).toContain("bridge.shipping_corridors");
    expect(result.hits).toEqual([
      expect.objectContaining({
        ruleId: "bridge.shipping_corridors",
        themeId: "macro_theme:shipping_disruption",
        matchedToken: "red sea",
        laneHints: ["shipping_resilience"],
        exposureTags: ["supply_chain_resilience", "logistics_exposure"],
      }),
    ]);
  });
});
