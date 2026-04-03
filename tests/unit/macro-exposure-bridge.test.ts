import { applyMacroExposureBridge, MACRO_EXPOSURE_BRIDGE_RULES } from "@/lib/research/macro-exposure-bridge";
import type {
  MacroNewsArticle,
  MacroNewsEnvironmentResult,
  MacroThemeConsensus,
  MacroThemeConsensusResult,
  MacroThemeKey,
} from "@/lib/research/types";

function buildEnvironment(article: MacroNewsArticle): MacroNewsEnvironmentResult {
  return {
    availabilityStatus: "primary_success",
    degradedReason: null,
    statusSummary: "ok",
    articleCount: 3,
    trustedArticleCount: 3,
    distinctPublisherCount: 3,
    sourceDiversity: { distinctPublishers: 3, trustedPublishers: 3, trustedRatio: 1 },
    issues: [],
    articles: [article],
  };
}

function buildConsensus(themeKey: MacroThemeKey, themeLabel: string, supportingArticleId: string): MacroThemeConsensusResult {
  const theme: MacroThemeConsensus = {
    themeId: `macro_theme:${themeKey}`,
    themeKey,
    themeLabel,
    queryFamilies: [themeKey === "shipping_disruption"
      ? "geopolitics_shipping_supply_chain"
      : themeKey === "energy_supply_tightness"
        ? "energy_commodities"
        : themeKey === "growth_slowdown_risk"
          ? "recession_labor_growth"
          : themeKey === "higher_for_longer_rates"
            ? "rates_inflation_central_banks"
            : themeKey === "credit_liquidity_stress"
              ? "credit_liquidity_banking_stress"
              : themeKey === "defense_fiscal_upcycle"
                ? "defense_fiscal_industrial_policy"
                : "regulation_export_controls_ai_policy"],
    supportingArticleIds: [supportingArticleId, `${supportingArticleId}:2`, `${supportingArticleId}:3`],
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
    exposureTags: [],
    candidateSearchTags: [],
    summary: `${themeLabel} cleared the gate.`,
  };

  return {
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
    themes: [theme],
  };
}

function buildArticle(params: {
  articleId: string;
  title: string;
  queryFamily: MacroNewsArticle["queryFamily"];
  topicHints: string[];
}): MacroNewsArticle {
  return {
    articleId: params.articleId,
    canonicalUrl: `https://www.reuters.com/${params.articleId}`,
    title: params.title,
    publisher: "reuters.com",
    publishedAt: null,
    publishedAtBucket: "last_7d",
    trusted: true,
    queryFamily: params.queryFamily,
    retrievalReason: "global macro environment",
    topicHints: params.topicHints,
    dedupKey: params.articleId,
    stableSortKey: `0:${params.articleId}`,
    evidenceHash: params.articleId,
  };
}

describe("macro exposure bridge", () => {
  test("uses a fixed explicit bridge registry", () => {
    expect(MACRO_EXPOSURE_BRIDGE_RULES.map((rule) => rule.ruleId)).toEqual([
      "bridge.shipping_corridors",
      "bridge.export_controls_compute",
      "bridge.defense_procurement",
      "bridge.energy_supply",
      "bridge.credit_liquidity",
      "bridge.rate_durability",
      "bridge.policy_regulation",
      "bridge.technology_platform_shift",
      "bridge.environment_disaster",
      "bridge.labor_workforce",
      "bridge.election_transition",
    ]);
  });

  test("fires deterministic indirect bridge hits for shipping disruption without downstream exposure words", () => {
    const result = applyMacroExposureBridge({
      consensus: buildConsensus("shipping_disruption", "Shipping / Supply Chain Disruption", "ship1"),
      environment: buildEnvironment(
        buildArticle({
          articleId: "ship1",
          title: "Red Sea attacks force carriers onto longer routes",
          queryFamily: "geopolitics_shipping_supply_chain",
          topicHints: ["war", "shipping"],
        })
      ),
    });

    expect(result.hits).toEqual([
      expect.objectContaining({
        ruleId: "bridge.shipping_corridors",
        matchedToken: "red sea",
        laneHints: ["shipping_resilience"],
        environmentalGapHints: ["supply_chain_concentration_review", "logistics_resilience_review"],
        exposureTags: ["supply_chain_resilience", "logistics_exposure"],
      }),
    ]);
  });

  test("fires deterministic policy bridge hits without explicit regulatory burden wording", () => {
    const result = applyMacroExposureBridge({
      consensus: buildConsensus("ai_policy_export_controls", "AI Policy / Export Controls", "policy1"),
      environment: buildEnvironment(
        buildArticle({
          articleId: "policy1",
          title: "Antitrust probe expands across major platform providers",
          queryFamily: "regulation_export_controls_ai_policy",
          topicHints: ["antitrust", "privacy"],
        })
      ),
    });

    expect(result.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "bridge.policy_regulation",
          matchedToken: "antitrust",
          environmentalGapHints: ["policy_burden_review", "regulatory_beneficiary_review"],
          exposureTags: ["regulatory_burden", "policy_beneficiary", "compliance_cost_sensitivity"],
        }),
      ])
    );
  });

  test("fires deterministic technology platform bridge hits without explicit compute wording", () => {
    const result = applyMacroExposureBridge({
      consensus: buildConsensus("ai_policy_export_controls", "AI Policy / Export Controls", "tech1"),
      environment: buildEnvironment(
        buildArticle({
          articleId: "tech1",
          title: "Developer conference signals a deeper ecosystem lock-in push",
          queryFamily: "regulation_export_controls_ai_policy",
          topicHints: ["developer conference", "platform launch"],
        })
      ),
    });

    expect(result.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "bridge.technology_platform_shift",
          matchedToken: "developer conference",
          laneHints: ["ai_infrastructure_policy"],
          exposureTags: ["compute_infrastructure_dependency", "network_infrastructure_sensitivity", "platform_ecosystem_lock_in"],
        }),
      ])
    );
  });

  test("fires deterministic environment bridge hits without explicit insurance or grid wording", () => {
    const result = applyMacroExposureBridge({
      consensus: buildConsensus("energy_supply_tightness", "Energy / Commodity Supply Tightness", "env1"),
      environment: buildEnvironment(
        buildArticle({
          articleId: "env1",
          title: "Hurricane forces Gulf Coast export terminals to shut down",
          queryFamily: "energy_commodities",
          topicHints: ["hurricane", "terminals"],
        })
      ),
    });

    expect(result.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "bridge.environment_disaster",
          matchedToken: "hurricane",
          laneHints: ["energy_supply_chain", "shipping_resilience"],
          exposureTags: ["grid_infrastructure_resilience", "insurance_loss_sensitivity", "water_stress", "disaster_recovery_exposure"],
        }),
      ])
    );
  });

  test("fires deterministic labor bridge hits without explicit automation wording", () => {
    const result = applyMacroExposureBridge({
      consensus: buildConsensus("growth_slowdown_risk", "Growth Slowdown / Recession Risk", "labor1"),
      environment: buildEnvironment(
        buildArticle({
          articleId: "labor1",
          title: "Dockworkers strike stretches into a second week",
          queryFamily: "recession_labor_growth",
          topicHints: ["strike", "union action"],
        })
      ),
    });

    expect(result.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "bridge.labor_workforce",
          matchedToken: "strike",
          laneHints: ["rate_resilience"],
          exposureTags: ["labor_cost_sensitivity", "automation_beneficiary", "workforce_capacity_risk"],
        }),
      ])
    );
  });

  test("fires deterministic election bridge hits without explicit policy uncertainty wording", () => {
    const result = applyMacroExposureBridge({
      consensus: buildConsensus("defense_fiscal_upcycle", "Defense / Fiscal / Industrial Policy", "election1"),
      environment: buildEnvironment(
        buildArticle({
          articleId: "election1",
          title: "New coalition forms after snap election",
          queryFamily: "defense_fiscal_industrial_policy",
          topicHints: ["coalition", "snap poll"],
        })
      ),
    });

    expect(result.hits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "bridge.election_transition",
          matchedToken: "election",
          laneHints: ["defense_fiscal_beneficiaries", "liquidity_defense"],
          exposureTags: ["policy_transition_risk", "fiscal_sensitivity", "regulatory_timing_risk"],
        }),
      ])
    );
  });
});
