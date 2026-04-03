import type {
  MacroExposureBridgeHit,
  MacroExposureBridgeResult,
  MacroExposureBridgeRule,
  MacroNewsEnvironmentResult,
  MacroThemeConsensusResult,
} from "./types";

export const MACRO_EXPOSURE_BRIDGE_RULES: MacroExposureBridgeRule[] = [
  {
    ruleId: "bridge.shipping_corridors",
    label: "Shipping corridors and maritime chokepoints",
    themeKeys: ["shipping_disruption"],
    matchTokens: ["red sea", "suez", "panama canal", "shipping corridor", "port", "freight", "container"],
    emittedExposureTags: ["supply_chain_resilience", "logistics_exposure"],
    emittedLaneHints: ["shipping_resilience"],
    emittedSectorTags: ["Industrials", "Transportation"],
    emittedSensitivityTags: ["supply_chain_risk", "logistics_cost_sensitivity"],
  },
  {
    ruleId: "bridge.export_controls_compute",
    label: "Export controls and AI compute policy",
    themeKeys: ["ai_policy_export_controls"],
    matchTokens: ["export control", "chip restriction", "semiconductor", "gpu", "advanced manufacturing", "ai infrastructure"],
    emittedExposureTags: ["ai_infrastructure", "policy_exposed_semis"],
    emittedLaneHints: ["ai_infrastructure_policy"],
    emittedSectorTags: ["Semiconductors", "Cloud Infrastructure"],
    emittedSensitivityTags: ["regulatory_burden", "compute_infrastructure_sensitivity"],
  },
  {
    ruleId: "bridge.defense_procurement",
    label: "Defense budgets and procurement shifts",
    themeKeys: ["defense_fiscal_upcycle"],
    matchTokens: ["defense", "military", "nato", "procurement", "fiscal package", "reshoring", "industrial policy"],
    emittedExposureTags: ["defense_spending", "industrial_policy"],
    emittedLaneHints: ["defense_fiscal_beneficiaries"],
    emittedSectorTags: ["Defense", "Industrials"],
    emittedSensitivityTags: ["policy_beneficiary", "fiscal_sensitivity"],
  },
  {
    ruleId: "bridge.energy_supply",
    label: "Commodity basins and energy supply shocks",
    themeKeys: ["energy_supply_tightness"],
    matchTokens: ["oil", "gas", "lng", "opec", "pipeline", "commodity", "refining"],
    emittedExposureTags: ["energy_supply", "commodity_resilience"],
    emittedLaneHints: ["energy_supply_chain"],
    emittedSectorTags: ["Energy", "Materials"],
    emittedSensitivityTags: ["commodity_cost_sensitivity", "energy_price_sensitivity"],
  },
  {
    ruleId: "bridge.credit_liquidity",
    label: "Banking and liquidity stress",
    themeKeys: ["credit_liquidity_stress"],
    matchTokens: ["liquidity", "credit", "bank stress", "funding", "deposit", "sovereign risk", "capital controls"],
    emittedExposureTags: ["liquidity_defense", "balance_sheet_strength"],
    emittedLaneHints: ["liquidity_defense"],
    emittedSectorTags: ["Financials", "Defensive Quality"],
    emittedSensitivityTags: ["leverage_sensitivity", "funding_risk"],
  },
  {
    ruleId: "bridge.rate_durability",
    label: "Higher-for-longer rate durability",
    themeKeys: ["higher_for_longer_rates", "growth_slowdown_risk"],
    matchTokens: ["fed", "rates", "yield", "inflation", "labor", "growth slowdown", "recession"],
    emittedExposureTags: ["rate_resilience", "cash_flow_quality", "defensive_quality"],
    emittedLaneHints: ["rate_resilience"],
    emittedSectorTags: ["Quality", "Defensives"],
    emittedSensitivityTags: ["duration_sensitivity", "demand_sensitivity"],
  },
];

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function compareHits(a: MacroExposureBridgeHit, b: MacroExposureBridgeHit): number {
  const themeDelta = a.themeId.localeCompare(b.themeId);
  if (themeDelta !== 0) return themeDelta;
  const ruleDelta = a.ruleId.localeCompare(b.ruleId);
  if (ruleDelta !== 0) return ruleDelta;
  return a.matchedToken.localeCompare(b.matchedToken);
}

export function applyMacroExposureBridge(input: {
  consensus: MacroThemeConsensusResult;
  environment: MacroNewsEnvironmentResult;
}): MacroExposureBridgeResult {
  const actionableThemes = input.consensus.themes.filter((theme) => theme.actionable);
  const themeByKey = new Map(actionableThemes.map((theme) => [theme.themeKey, theme]));
  const hits: MacroExposureBridgeHit[] = [];

  for (const rule of MACRO_EXPOSURE_BRIDGE_RULES) {
    const matchedThemes = rule.themeKeys
      .map((themeKey) => themeByKey.get(themeKey))
      .filter((theme): theme is NonNullable<typeof theme> => Boolean(theme));

    if (matchedThemes.length === 0) {
      continue;
    }

    const relevantArticles = input.environment.articles.filter((article) =>
      matchedThemes.some((theme) => theme.supportingArticleIds.includes(article.articleId))
    );

    const articleText = normalize(
      relevantArticles.map((article) => `${article.title} ${article.topicHints.join(" ")}`).join(" ")
    );

    const matchedToken = rule.matchTokens.find((token) => articleText.includes(normalize(token)));
    if (!matchedToken) {
      continue;
    }

    for (const theme of matchedThemes) {
      hits.push({
        bridgeHitId: `${theme.themeId}:${rule.ruleId}:${matchedToken.replace(/\s+/g, "_")}`,
        ruleId: rule.ruleId,
        themeId: theme.themeId,
        matchedToken,
        exposureTags: [...rule.emittedExposureTags],
        laneHints: [...rule.emittedLaneHints],
        sectorTags: [...rule.emittedSectorTags],
        sensitivityTags: [...rule.emittedSensitivityTags],
        rationaleSummary: `${theme.themeLabel} activated bridge rule ${rule.ruleId} via matched token "${matchedToken}".`,
      });
    }
  }

  const deduped = new Map<string, MacroExposureBridgeHit>();
  for (const hit of hits) {
    deduped.set(hit.bridgeHitId, hit);
  }

  const normalizedHits = [...deduped.values()].sort(compareHits);
  return {
    statusSummary: normalizedHits.length > 0
      ? `${normalizedHits.length} deterministic macro exposure bridge hit(s) were produced from actionable macro themes.`
      : "No deterministic macro exposure bridge rules fired from the actionable macro themes in this run.",
    hits: normalizedHits,
  };
}
