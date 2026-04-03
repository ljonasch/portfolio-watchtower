import type {
  MacroNewsArticle,
  MacroNewsEnvironmentResult,
  MacroQueryFamilyKey,
  MacroThemeConsensus,
  MacroThemeConsensusResult,
  MacroThemeKey,
} from "./types";

interface MacroThemeDefinition {
  themeKey: MacroThemeKey;
  themeLabel: string;
  queryFamilies: MacroQueryFamilyKey[];
  supportKeywords: string[];
  contradictionKeywords: string[];
  exposureTags: string[];
  candidateSearchTags: string[];
}

type ArticleStance = "support" | "counter";

export const MACRO_THEME_CONSENSUS_THRESHOLDS = {
  minSupportingArticles: 3,
  minTrustedSupportingArticles: 2,
  minDistinctPublishers: 2,
  minSupportRatio: 0.7,
  minRecentSupportingArticles7d: 2,
} as const;

export const PHASE1_MACRO_THEME_REGISTRY: MacroThemeDefinition[] = [
  {
    themeKey: "higher_for_longer_rates",
    themeLabel: "Higher-for-Longer Rates",
    queryFamilies: ["rates_inflation_central_banks"],
    supportKeywords: ["inflation", "fed", "rates", "yield", "hawkish", "sticky", "hot cpi", "central bank"],
    contradictionKeywords: ["cuts", "cooling inflation", "soft cpi", "dovish", "disinflation"],
    exposureTags: ["rate_resilience", "cash_flow_quality"],
    candidateSearchTags: ["rate resilience", "quality balance sheets", "cash flow durability"],
  },
  {
    themeKey: "growth_slowdown_risk",
    themeLabel: "Growth Slowdown / Recession Risk",
    queryFamilies: ["recession_labor_growth"],
    supportKeywords: ["slowdown", "recession", "weak labor", "jobless", "soft demand", "growth scare"],
    contradictionKeywords: ["reacceleration", "strong jobs", "resilient demand", "growth surprise"],
    exposureTags: ["defensive_quality", "non_cyclical_cash_flows"],
    candidateSearchTags: ["defensive quality", "recession resilience", "non cyclical demand"],
  },
  {
    themeKey: "energy_supply_tightness",
    themeLabel: "Energy / Commodity Supply Tightness",
    queryFamilies: ["energy_commodities"],
    supportKeywords: ["oil", "gas", "energy", "commodity", "supply tightness", "production cut", "inventory draw"],
    contradictionKeywords: ["glut", "oversupply", "demand collapse"],
    exposureTags: ["energy_supply", "commodity_resilience"],
    candidateSearchTags: ["energy infrastructure", "commodity leverage", "supply discipline"],
  },
  {
    themeKey: "shipping_disruption",
    themeLabel: "Shipping / Supply Chain Disruption",
    queryFamilies: ["geopolitics_shipping_supply_chain"],
    supportKeywords: ["shipping", "supply chain", "red sea", "freight", "war", "tariff", "route disruption"],
    contradictionKeywords: ["normalizing freight", "resolved disruption", "route reopened"],
    exposureTags: ["supply_chain_resilience", "logistics_exposure"],
    candidateSearchTags: ["shipping resilience", "logistics infrastructure", "domestic supply chain"],
  },
  {
    themeKey: "ai_policy_export_controls",
    themeLabel: "AI Policy / Export Controls",
    queryFamilies: ["regulation_export_controls_ai_policy"],
    supportKeywords: ["export controls", "ai policy", "chip restrictions", "regulation", "semiconductor", "compute"],
    contradictionKeywords: ["rules eased", "controls relaxed", "regulatory relief"],
    exposureTags: ["ai_infrastructure", "policy_exposed_semis"],
    candidateSearchTags: ["ai infrastructure", "policy resilient semis", "compute infrastructure"],
  },
  {
    themeKey: "credit_liquidity_stress",
    themeLabel: "Credit / Liquidity Stress",
    queryFamilies: ["credit_liquidity_banking_stress"],
    supportKeywords: ["credit stress", "liquidity", "bank stress", "funding pressure", "credit spreads", "deposit flight"],
    contradictionKeywords: ["stress eased", "funding normal", "credit improving"],
    exposureTags: ["liquidity_defense", "balance_sheet_strength"],
    candidateSearchTags: ["liquidity defense", "balance sheet strength", "capital resilience"],
  },
  {
    themeKey: "defense_fiscal_upcycle",
    themeLabel: "Defense / Fiscal / Industrial Policy",
    queryFamilies: ["defense_fiscal_industrial_policy"],
    supportKeywords: ["defense", "military", "industrial policy", "fiscal", "reshoring", "manufacturing incentive"],
    contradictionKeywords: ["budget cuts", "program cancellation", "fiscal retrenchment"],
    exposureTags: ["defense_spending", "industrial_policy"],
    candidateSearchTags: ["defense primes", "industrial policy beneficiaries", "reshoring beneficiaries"],
  },
];

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function classifyArticleForTheme(article: MacroNewsArticle, theme: MacroThemeDefinition): ArticleStance | null {
  if (!theme.queryFamilies.includes(article.queryFamily)) {
    return null;
  }

  const haystack = normalizeText(`${article.title} ${article.topicHints.join(" ")}`);
  if (theme.contradictionKeywords.some((keyword) => haystack.includes(keyword))) {
    return "counter";
  }

  if (theme.supportKeywords.some((keyword) => haystack.includes(keyword))) {
    return "support";
  }

  return "support";
}

function deriveContradictionLevel(counterCount: number, totalCount: number): "low" | "medium" | "high" {
  if (totalCount === 0) return "low";
  const ratio = counterCount / totalCount;
  if (counterCount >= 2 || ratio >= 0.3) return "high";
  if (counterCount === 1 || ratio >= 0.15) return "medium";
  return "low";
}

function deriveConfidence(supportCount: number, trustedSupport: number, distinctPublishers: number, contradictionLevel: "low" | "medium" | "high"): "high" | "medium" | "low" {
  if (
    contradictionLevel === "low" &&
    supportCount >= MACRO_THEME_CONSENSUS_THRESHOLDS.minSupportingArticles + 1 &&
    trustedSupport >= MACRO_THEME_CONSENSUS_THRESHOLDS.minTrustedSupportingArticles + 1 &&
    distinctPublishers >= MACRO_THEME_CONSENSUS_THRESHOLDS.minDistinctPublishers + 1
  ) {
    return "high";
  }
  if (supportCount >= 2 && trustedSupport >= 1) {
    return "medium";
  }
  return "low";
}

function deriveSeverity(supportCount: number, contradictionLevel: "low" | "medium" | "high"): "high" | "medium" | "low" {
  if (contradictionLevel === "low" && supportCount >= 4) return "high";
  if (supportCount >= 2) return "medium";
  return "low";
}

function compareThemes(a: MacroThemeConsensus, b: MacroThemeConsensus): number {
  if (a.actionable !== b.actionable) return a.actionable ? -1 : 1;
  if (a.supportingArticleCount !== b.supportingArticleCount) {
    return b.supportingArticleCount - a.supportingArticleCount;
  }
  return a.themeKey.localeCompare(b.themeKey);
}

export function deriveMacroThemeConsensus(
  macroEnvironment: MacroNewsEnvironmentResult
): MacroThemeConsensusResult {
  const themes = PHASE1_MACRO_THEME_REGISTRY.map<MacroThemeConsensus>((definition) => {
    const supportingArticles: MacroNewsArticle[] = [];
    const counterArticles: MacroNewsArticle[] = [];

    for (const article of macroEnvironment.articles) {
      const stance = classifyArticleForTheme(article, definition);
      if (stance === "support") supportingArticles.push(article);
      if (stance === "counter") counterArticles.push(article);
    }

    const classifiedCount = supportingArticles.length + counterArticles.length;
    const trustedSupportingCount = supportingArticles.filter((article) => article.trusted).length;
    const distinctPublishers = new Set(supportingArticles.map((article) => article.publisher)).size;
    const supportRatio = classifiedCount > 0 ? Number((supportingArticles.length / classifiedCount).toFixed(2)) : 0;
    const contradictionLevel = deriveContradictionLevel(counterArticles.length, classifiedCount);
    const recentSupportingCount7d = supportingArticles.length;
    const actionable =
      supportingArticles.length >= MACRO_THEME_CONSENSUS_THRESHOLDS.minSupportingArticles &&
      trustedSupportingCount >= MACRO_THEME_CONSENSUS_THRESHOLDS.minTrustedSupportingArticles &&
      distinctPublishers >= MACRO_THEME_CONSENSUS_THRESHOLDS.minDistinctPublishers &&
      supportRatio >= MACRO_THEME_CONSENSUS_THRESHOLDS.minSupportRatio &&
      recentSupportingCount7d >= MACRO_THEME_CONSENSUS_THRESHOLDS.minRecentSupportingArticles7d &&
      contradictionLevel !== "high";

    return {
      themeId: `macro_theme:${definition.themeKey}`,
      themeKey: definition.themeKey,
      themeLabel: definition.themeLabel,
      queryFamilies: [...definition.queryFamilies],
      supportingArticleIds: supportingArticles.map((article) => article.articleId).sort(),
      counterArticleIds: counterArticles.map((article) => article.articleId).sort(),
      supportingArticleCount: supportingArticles.length,
      trustedSupportingCount,
      distinctPublisherCount: distinctPublishers,
      supportRatio,
      contradictionLevel,
      recentSupportingCount7d,
      confidence: deriveConfidence(supportingArticles.length, trustedSupportingCount, distinctPublishers, contradictionLevel),
      severity: deriveSeverity(supportingArticles.length, contradictionLevel),
      actionable,
      exposureTags: [...definition.exposureTags],
      candidateSearchTags: [...definition.candidateSearchTags],
      summary: actionable
        ? `${definition.themeLabel} reached the phase-1 consensus gate with ${supportingArticles.length} supporting article(s) across ${distinctPublishers} publisher(s).`
        : `${definition.themeLabel} was observed but did not clear the phase-1 consensus gate.`,
    };
  }).sort(compareThemes);

  const actionableCount = themes.filter((theme) => theme.actionable).length;
  const observedCount = themes.filter((theme) => theme.supportingArticleCount > 0 || theme.counterArticleIds.length > 0).length;

  return {
    availabilityStatus: macroEnvironment.availabilityStatus,
    degradedReason: macroEnvironment.degradedReason,
    thresholds: { ...MACRO_THEME_CONSENSUS_THRESHOLDS },
    statusSummary: actionableCount > 0
      ? `${actionableCount} macro theme(s) cleared the deterministic consensus gate out of ${observedCount} observed theme(s).`
      : observedCount > 0
        ? "Macro themes were observed, but none cleared the deterministic consensus gate."
        : "No classified macro themes were observed from the collected macro-news environment.",
    themes,
  };
}
