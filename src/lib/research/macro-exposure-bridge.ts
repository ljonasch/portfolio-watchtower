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
    emittedEnvironmentalGapHints: ["supply_chain_concentration_review", "logistics_resilience_review"],
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
    emittedEnvironmentalGapHints: ["compute_policy_review", "semiconductor_policy_risk_review"],
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
    emittedEnvironmentalGapHints: ["procurement_beneficiary_review", "industrial_policy_beneficiary_review"],
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
    emittedEnvironmentalGapHints: ["energy_supply_resilience_review", "commodity_input_cost_review"],
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
    emittedEnvironmentalGapHints: ["funding_risk_review", "balance_sheet_resilience_review"],
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
    emittedEnvironmentalGapHints: ["rate_duration_review", "cash_flow_durability_review"],
    emittedLaneHints: ["rate_resilience"],
    emittedSectorTags: ["Quality", "Defensives"],
    emittedSensitivityTags: ["duration_sensitivity", "demand_sensitivity"],
  },
  {
    ruleId: "bridge.policy_regulation",
    label: "Policy, regulation, and enforcement shifts",
    themeKeys: ["ai_policy_export_controls", "defense_fiscal_upcycle"],
    matchTokens: ["antitrust", "privacy", "rulemaking", "subsidy", "tax credit", "epa", "fda", "export licensing"],
    emittedExposureTags: ["regulatory_burden", "policy_beneficiary", "compliance_cost_sensitivity"],
    emittedEnvironmentalGapHints: ["policy_burden_review", "regulatory_beneficiary_review"],
    emittedLaneHints: ["ai_infrastructure_policy", "defense_fiscal_beneficiaries"],
    emittedSectorTags: ["Policy Exposed", "Industrials", "Technology"],
    emittedSensitivityTags: ["regulatory_burden", "policy_timing_risk"],
  },
  {
    ruleId: "bridge.technology_platform_shift",
    label: "Technology platform and ecosystem shifts",
    themeKeys: ["ai_policy_export_controls"],
    matchTokens: ["developer conference", "platform launch", "ecosystem", "model rollout", "training cluster", "cloud region", "interop standard"],
    emittedExposureTags: ["compute_infrastructure_dependency", "network_infrastructure_sensitivity", "platform_ecosystem_lock_in"],
    emittedEnvironmentalGapHints: ["platform_shift_review", "compute_capacity_review"],
    emittedLaneHints: ["ai_infrastructure_policy"],
    emittedSectorTags: ["Technology Infrastructure", "Networks"],
    emittedSensitivityTags: ["compute_infrastructure_sensitivity", "network_scaling_risk"],
  },
  {
    ruleId: "bridge.environment_disaster",
    label: "Environment, weather, and disaster disruptions",
    themeKeys: ["shipping_disruption", "energy_supply_tightness"],
    matchTokens: ["hurricane", "wildfire", "drought", "flood", "heatwave", "deep freeze", "earthquake", "storm surge"],
    emittedExposureTags: ["grid_infrastructure_resilience", "insurance_loss_sensitivity", "water_stress", "disaster_recovery_exposure"],
    emittedEnvironmentalGapHints: ["weather_disruption_review", "infrastructure_resilience_review"],
    emittedLaneHints: ["energy_supply_chain", "shipping_resilience"],
    emittedSectorTags: ["Utilities", "Industrials", "Insurance"],
    emittedSensitivityTags: ["weather_risk", "infrastructure_damage_sensitivity"],
  },
  {
    ruleId: "bridge.labor_workforce",
    label: "Labor, workforce, and demographic pressure",
    themeKeys: ["growth_slowdown_risk", "higher_for_longer_rates"],
    matchTokens: ["strike", "union action", "wage pressure", "labor shortage", "aging population", "demographic pressure", "workforce shortage", "apprenticeship shortfall"],
    emittedExposureTags: ["labor_cost_sensitivity", "automation_beneficiary", "workforce_capacity_risk"],
    emittedEnvironmentalGapHints: ["labor_cost_review", "workforce_resilience_review"],
    emittedLaneHints: ["rate_resilience"],
    emittedSectorTags: ["Industrials", "Services", "Automation"],
    emittedSensitivityTags: ["labor_cost_sensitivity", "staffing_constraint_risk"],
  },
  {
    ruleId: "bridge.election_transition",
    label: "Election, coalition, and political-transition effects",
    themeKeys: ["defense_fiscal_upcycle", "ai_policy_export_controls", "higher_for_longer_rates"],
    matchTokens: ["election", "coalition", "cabinet reshuffle", "referendum", "transition team", "new administration", "parliament", "snap poll"],
    emittedExposureTags: ["policy_transition_risk", "fiscal_sensitivity", "regulatory_timing_risk"],
    emittedEnvironmentalGapHints: ["political_transition_review", "policy_uncertainty_review"],
    emittedLaneHints: ["defense_fiscal_beneficiaries", "liquidity_defense"],
    emittedSectorTags: ["Policy Exposed", "Defense", "Defensives"],
    emittedSensitivityTags: ["policy_uncertainty", "fiscal_sensitivity"],
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
        environmentalGapHints: [...rule.emittedEnvironmentalGapHints],
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
