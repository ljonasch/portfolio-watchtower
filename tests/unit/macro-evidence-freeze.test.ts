import { buildMacroAnalyzerSummary } from "@/lib/research/analysis-orchestrator";
import { buildFrozenMacroEvidence, replayMacroOutputsFromFrozenEvidence } from "@/lib/research/macro-evidence-freeze";
import { deriveEnvironmentalGaps } from "@/lib/research/gap-analyzer";
import { deriveMacroCandidateSearchLanes } from "@/lib/research/macro-candidate-lanes";
import { applyMacroExposureBridge } from "@/lib/research/macro-exposure-bridge";
import { deriveMacroThemeConsensus } from "@/lib/research/macro-theme-consensus";
import type { GapReport, HoldingInput, MacroNewsEnvironmentResult } from "@/lib/research/types";

function buildShippingMacroEnvironment(): MacroNewsEnvironmentResult {
  return {
    availabilityStatus: "primary_success",
    degradedReason: null,
    statusSummary: "Macro collection succeeded.",
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
        stableSortKey: "0:0000:https://www.reuters.com/ship1",
        evidenceHash: "ship1",
      },
      {
        articleId: "ship2",
        canonicalUrl: "https://www.bloomberg.com/ship2",
        title: "Suez route disruption lifts freight costs",
        publisher: "bloomberg.com",
        publishedAt: null,
        publishedAtBucket: "last_7d",
        trusted: true,
        queryFamily: "geopolitics_shipping_supply_chain",
        retrievalReason: "global macro environment",
        topicHints: ["suez", "freight"],
        dedupKey: "ship2",
        stableSortKey: "0:0001:https://www.bloomberg.com/ship2",
        evidenceHash: "ship2",
      },
      {
        articleId: "ship3",
        canonicalUrl: "https://www.wsj.com/ship3",
        title: "Container rerouting intensifies after corridor attacks",
        publisher: "wsj.com",
        publishedAt: null,
        publishedAtBucket: "last_7d",
        trusted: true,
        queryFamily: "geopolitics_shipping_supply_chain",
        retrievalReason: "global macro environment",
        topicHints: ["container", "corridor"],
        dedupKey: "ship3",
        stableSortKey: "0:0002:https://www.wsj.com/ship3",
        evidenceHash: "ship3",
      },
    ],
  };
}

describe("macro evidence freeze", () => {
  test("replaying from frozen evidence reproduces the same macro outputs", () => {
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
      profilePreferences: "AI",
    };
    const macroEnvironment = buildShippingMacroEnvironment();
    const macroConsensus = deriveMacroThemeConsensus(macroEnvironment);
    const macroBridge = applyMacroExposureBridge({
      consensus: macroConsensus,
      environment: macroEnvironment,
    });
    const environmentalGaps = deriveEnvironmentalGaps({
      holdings,
      structuralGapReport,
      profile: { sectorsToEmphasize: "AI" },
      marketRegime: { riskMode: "risk-on", rateTrend: "flat" },
      macroConsensus,
      macroBridge,
    });
    const candidateSearchLanes = deriveMacroCandidateSearchLanes(environmentalGaps);

    const frozenMacroEvidence = buildFrozenMacroEvidence({
      macroEnvironment,
      macroConsensus,
      macroBridge,
      environmentalGaps,
      candidateSearchLanes,
    });

    const replayed = replayMacroOutputsFromFrozenEvidence({
      frozenMacroEvidence,
      holdings,
      structuralGapReport,
      profile: { sectorsToEmphasize: "AI" },
      marketRegime: { riskMode: "risk-on", rateTrend: "flat" },
    });

    expect(replayed.macroConsensus.themes.filter((theme) => theme.actionable).map((theme) => theme.themeId).sort()).toEqual(
      frozenMacroEvidence.actionableThemeIds
    );
    expect(replayed.macroBridge.hits.map((hit) => hit.bridgeHitId).sort()).toEqual(
      frozenMacroEvidence.bridgeHitIds
    );
    expect(replayed.environmentalGaps.map((gap) => gap.gapId).sort()).toEqual(
      frozenMacroEvidence.environmentalGapIds
    );
    expect(replayed.candidateSearchLanes.map((lane) => lane.laneId).sort()).toEqual(
      frozenMacroEvidence.candidateLaneIds
    );
  });

  test("analyzer macro summary stays unchanged when frozen evidence is reused", () => {
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
      profilePreferences: "AI",
    };
    const macroEnvironment = buildShippingMacroEnvironment();
    const macroConsensus = deriveMacroThemeConsensus(macroEnvironment);
    const macroBridge = applyMacroExposureBridge({
      consensus: macroConsensus,
      environment: macroEnvironment,
    });
    const environmentalGaps = deriveEnvironmentalGaps({
      holdings,
      structuralGapReport,
      profile: { sectorsToEmphasize: "AI" },
      marketRegime: { riskMode: "risk-on", rateTrend: "flat" },
      macroConsensus,
      macroBridge,
    });
    const candidateSearchLanes = deriveMacroCandidateSearchLanes(environmentalGaps);
    const frozenMacroEvidence = buildFrozenMacroEvidence({
      macroEnvironment,
      macroConsensus,
      macroBridge,
      environmentalGaps,
      candidateSearchLanes,
    });
    const replayed = replayMacroOutputsFromFrozenEvidence({
      frozenMacroEvidence,
      holdings,
      structuralGapReport,
      profile: { sectorsToEmphasize: "AI" },
      marketRegime: { riskMode: "risk-on", rateTrend: "flat" },
    });

    const originalSummary = buildMacroAnalyzerSummary({
      macroEnvironment,
      macroConsensus,
      macroBridge,
      environmentalGaps,
      candidateSearchLanes,
    });
    const replayedSummary = buildMacroAnalyzerSummary(replayed);

    expect(replayedSummary).toEqual(originalSummary);
  });
});
