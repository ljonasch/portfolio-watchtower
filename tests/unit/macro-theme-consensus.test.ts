import {
  deriveMacroThemeConsensus,
  MACRO_THEME_CONSENSUS_THRESHOLDS,
  PHASE1_MACRO_THEME_REGISTRY,
} from "@/lib/research/macro-theme-consensus";
import type { MacroNewsEnvironmentResult } from "@/lib/research/types";

function buildEnvironment(articles: MacroNewsEnvironmentResult["articles"]): MacroNewsEnvironmentResult {
  return {
    availabilityStatus: "primary_success",
    degradedReason: null,
    statusSummary: "Macro-news collection succeeded.",
    articleCount: articles.length,
    trustedArticleCount: articles.filter((article) => article.trusted).length,
    distinctPublisherCount: new Set(articles.map((article) => article.publisher)).size,
    sourceDiversity: {
      distinctPublishers: new Set(articles.map((article) => article.publisher)).size,
      trustedPublishers: new Set(articles.filter((article) => article.trusted).map((article) => article.publisher)).size,
      trustedRatio: 1,
    },
    issues: [],
    articles,
  };
}

describe("macro theme consensus", () => {
  test("uses the exact fixed phase-1 macro theme registry with no dynamic themes", () => {
    expect(PHASE1_MACRO_THEME_REGISTRY.map((theme) => theme.themeKey)).toEqual([
      "higher_for_longer_rates",
      "growth_slowdown_risk",
      "energy_supply_tightness",
      "shipping_disruption",
      "ai_policy_export_controls",
      "credit_liquidity_stress",
      "defense_fiscal_upcycle",
    ]);
  });

  test("derives deterministic consensus from the same normalized evidence", () => {
    const articles = [
      {
        articleId: "a1",
        canonicalUrl: "https://www.reuters.com/a1",
        title: "Fed keeps rates high as inflation stays sticky",
        publisher: "reuters.com",
        publishedAt: null,
        publishedAtBucket: "last_7d",
        trusted: true,
        queryFamily: "rates_inflation_central_banks" as const,
        retrievalReason: "global macro environment",
        topicHints: ["rates", "inflation"],
        dedupKey: "a1",
        stableSortKey: "0:a1",
        evidenceHash: "a1",
      },
      {
        articleId: "a2",
        canonicalUrl: "https://www.bloomberg.com/a2",
        title: "Bond yields rise on hawkish central bank signals",
        publisher: "bloomberg.com",
        publishedAt: null,
        publishedAtBucket: "last_7d",
        trusted: true,
        queryFamily: "rates_inflation_central_banks" as const,
        retrievalReason: "global macro environment",
        topicHints: ["yield", "central bank"],
        dedupKey: "a2",
        stableSortKey: "0:a2",
        evidenceHash: "a2",
      },
      {
        articleId: "a3",
        canonicalUrl: "https://www.wsj.com/a3",
        title: "Sticky CPI keeps higher-for-longer rate debate alive",
        publisher: "wsj.com",
        publishedAt: null,
        publishedAtBucket: "last_7d",
        trusted: true,
        queryFamily: "rates_inflation_central_banks" as const,
        retrievalReason: "global macro environment",
        topicHints: ["sticky cpi", "rates"],
        dedupKey: "a3",
        stableSortKey: "0:a3",
        evidenceHash: "a3",
      },
    ];

    const first = deriveMacroThemeConsensus(buildEnvironment(articles));
    const second = deriveMacroThemeConsensus(buildEnvironment([...articles].reverse()));

    expect(first).toEqual(second);
    expect(first.thresholds).toEqual(MACRO_THEME_CONSENSUS_THRESHOLDS);
    expect(first.themes.find((theme) => theme.themeKey === "higher_for_longer_rates")).toEqual(
      expect.objectContaining({
        actionable: true,
        supportingArticleCount: 3,
        trustedSupportingCount: 3,
      })
    );
  });

  test("records observed themes without making them actionable when thresholds fail", () => {
    const result = deriveMacroThemeConsensus(
      buildEnvironment([
        {
          articleId: "b1",
          canonicalUrl: "https://www.reuters.com/b1",
          title: "Fed signals rates may stay high",
          publisher: "reuters.com",
          publishedAt: null,
          publishedAtBucket: "last_7d",
          trusted: true,
          queryFamily: "rates_inflation_central_banks" as const,
          retrievalReason: "global macro environment",
          topicHints: ["rates"],
          dedupKey: "b1",
          stableSortKey: "0:b1",
          evidenceHash: "b1",
        },
        {
          articleId: "b2",
          canonicalUrl: "https://www.bloomberg.com/b2",
          title: "Cooling inflation revives rate cut hopes",
          publisher: "bloomberg.com",
          publishedAt: null,
          publishedAtBucket: "last_7d",
          trusted: true,
          queryFamily: "rates_inflation_central_banks" as const,
          retrievalReason: "global macro environment",
          topicHints: ["cuts"],
          dedupKey: "b2",
          stableSortKey: "0:b2",
          evidenceHash: "b2",
        },
      ])
    );

    expect(result.themes.find((theme) => theme.themeKey === "higher_for_longer_rates")).toEqual(
      expect.objectContaining({
        actionable: false,
      })
    );
  });
});
