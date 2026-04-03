import type {
  CandidateSearchLane,
  EnvironmentalGap,
  MacroCandidateLaneKey,
} from "./types";

interface LaneDefinition {
  laneKey: MacroCandidateLaneKey;
  description: string;
  allowedAssetClasses: string[];
  searchTags: string[];
  priority: number;
}

export const PHASE1_MACRO_LANE_REGISTRY: Record<MacroCandidateLaneKey, LaneDefinition> = {
  rate_resilience: {
    laneKey: "rate_resilience",
    description: "Quality, cash-flow-durable names that can better absorb higher-for-longer rates or slower growth.",
    allowedAssetClasses: ["Stocks", "ETFs"],
    searchTags: ["rate resilience", "quality balance sheets", "cash flow durability"],
    priority: 1,
  },
  defense_fiscal_beneficiaries: {
    laneKey: "defense_fiscal_beneficiaries",
    description: "Defense and industrial-policy beneficiaries supported by fiscal and procurement tailwinds.",
    allowedAssetClasses: ["Stocks", "ETFs"],
    searchTags: ["defense primes", "industrial policy beneficiaries", "reshoring beneficiaries"],
    priority: 2,
  },
  energy_supply_chain: {
    laneKey: "energy_supply_chain",
    description: "Energy and commodity supply-chain beneficiaries tied to tighter supply conditions.",
    allowedAssetClasses: ["Stocks", "ETFs"],
    searchTags: ["energy infrastructure", "commodity leverage", "supply discipline"],
    priority: 3,
  },
  shipping_resilience: {
    laneKey: "shipping_resilience",
    description: "Logistics and supply-chain resilience names relevant to shipping disruptions.",
    allowedAssetClasses: ["Stocks", "ETFs"],
    searchTags: ["shipping resilience", "logistics infrastructure", "domestic supply chain"],
    priority: 4,
  },
  ai_infrastructure_policy: {
    laneKey: "ai_infrastructure_policy",
    description: "AI infrastructure and policy-resilient compute beneficiaries.",
    allowedAssetClasses: ["Stocks", "ETFs"],
    searchTags: ["ai infrastructure", "policy resilient semis", "compute infrastructure"],
    priority: 5,
  },
  liquidity_defense: {
    laneKey: "liquidity_defense",
    description: "Balance-sheet-strong and funding-resilient names for liquidity stress environments.",
    allowedAssetClasses: ["Stocks", "ETFs"],
    searchTags: ["liquidity defense", "balance sheet strength", "capital resilience"],
    priority: 6,
  },
};

function compareLanes(a: CandidateSearchLane, b: CandidateSearchLane): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  return a.laneKey.localeCompare(b.laneKey);
}

export function deriveMacroCandidateSearchLanes(
  environmentalGaps: EnvironmentalGap[]
): CandidateSearchLane[] {
  const lanes = new Map<string, CandidateSearchLane>();

  for (const gap of environmentalGaps) {
    if (!gap.openCandidateDiscovery) {
      continue;
    }

    for (const laneKey of gap.candidateSearchTags) {
      const definition = PHASE1_MACRO_LANE_REGISTRY[laneKey as MacroCandidateLaneKey];
      if (!definition) continue;

      const laneId = `macro_lane:${definition.laneKey}`;
      const existing = lanes.get(laneId);

      if (!existing) {
        lanes.set(laneId, {
          laneId,
          laneKey: definition.laneKey,
          description: definition.description,
          allowedAssetClasses: [...definition.allowedAssetClasses],
          searchTags: [...definition.searchTags],
          priority: definition.priority,
          sortBehavior: "priority_then_ticker",
          origin: "environmental_gap",
          themeIds: [gap.themeId],
          environmentalGapIds: [gap.gapId],
          bridgeRuleIds: [...gap.bridgeRuleIds],
          rationaleSummary: gap.rationaleSummary,
        });
        continue;
      }

      lanes.set(laneId, {
        ...existing,
        themeIds: [...new Set([...existing.themeIds, gap.themeId])].sort(),
        environmentalGapIds: [...new Set([...existing.environmentalGapIds, gap.gapId])].sort(),
        bridgeRuleIds: [...new Set([...existing.bridgeRuleIds, ...gap.bridgeRuleIds])].sort(),
        rationaleSummary: existing.rationaleSummary,
      });
    }
  }

  return [...lanes.values()].sort(compareLanes);
}
