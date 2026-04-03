import { deriveMacroCandidateSearchLanes, PHASE1_MACRO_LANE_REGISTRY } from "@/lib/research/macro-candidate-lanes";
import type { EnvironmentalGap } from "@/lib/research/types";

describe("macro candidate lanes", () => {
  test("derives deterministic bounded lane sets from environmental gaps", () => {
    const environmentalGaps: EnvironmentalGap[] = [
      {
        gapId: "env_gap:shipping_disruption",
        themeId: "macro_theme:shipping_disruption",
        themeKey: "shipping_disruption",
        bridgeRuleIds: ["bridge.shipping_corridors"],
        description: "Shipping disruption gap",
        authority: "environmental" as const,
        urgency: "high" as const,
        exposureTags: ["supply_chain_resilience"],
        candidateSearchTags: ["shipping_resilience"],
        reviewCurrentHoldings: true,
        reviewCandidates: true,
        openCandidateDiscovery: true,
        regimeAlignment: "neutral" as const,
        profileAlignment: "aligned" as const,
        rationaleSummary: "Shipping gap",
      },
      {
        gapId: "env_gap:rate",
        themeId: "macro_theme:higher_for_longer_rates",
        themeKey: "higher_for_longer_rates",
        bridgeRuleIds: ["bridge.rate_durability"],
        description: "Rate gap",
        authority: "environmental" as const,
        urgency: "medium" as const,
        exposureTags: ["rate_resilience"],
        candidateSearchTags: ["rate_resilience"],
        reviewCurrentHoldings: true,
        reviewCandidates: true,
        openCandidateDiscovery: true,
        regimeAlignment: "aligned" as const,
        profileAlignment: "aligned" as const,
        rationaleSummary: "Rate gap",
      },
    ];

    const lanes = deriveMacroCandidateSearchLanes(environmentalGaps);

    expect(Object.keys(PHASE1_MACRO_LANE_REGISTRY)).toEqual([
      "rate_resilience",
      "defense_fiscal_beneficiaries",
      "energy_supply_chain",
      "shipping_resilience",
      "ai_infrastructure_policy",
      "liquidity_defense",
    ]);
    expect(lanes.map((lane) => lane.laneKey)).toEqual(["rate_resilience", "shipping_resilience"]);
    expect(lanes[0]).toEqual(
      expect.objectContaining({
        laneId: "macro_lane:rate_resilience",
        sortBehavior: "priority_then_ticker",
      })
    );
  });
});
