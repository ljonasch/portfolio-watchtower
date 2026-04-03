import { deriveEnvironmentalGaps } from "./gap-analyzer";
import { deriveMacroCandidateSearchLanes } from "./macro-candidate-lanes";
import { applyMacroExposureBridge } from "./macro-exposure-bridge";
import { deriveMacroThemeConsensus } from "./macro-theme-consensus";
import type {
  CandidateSearchLane,
  EnvironmentalGap,
  FrozenMacroEvidencePacket,
  GapReport,
  HoldingInput,
  MacroExposureBridgeResult,
  MacroNewsEnvironmentResult,
  MacroThemeConsensusResult,
} from "./types";

function compareArticles(a: MacroNewsEnvironmentResult["articles"][number], b: MacroNewsEnvironmentResult["articles"][number]): number {
  return a.stableSortKey.localeCompare(b.stableSortKey);
}

function sortUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function buildFrozenMacroEvidence(input: {
  macroEnvironment: MacroNewsEnvironmentResult;
  macroConsensus: MacroThemeConsensusResult;
  macroBridge: MacroExposureBridgeResult;
  environmentalGaps: EnvironmentalGap[];
  candidateSearchLanes: CandidateSearchLane[];
}): FrozenMacroEvidencePacket {
  const macroEnvironment: MacroNewsEnvironmentResult = {
    ...input.macroEnvironment,
    articles: [...input.macroEnvironment.articles].sort(compareArticles),
  };

  return {
    schemaVersion: "macro_evidence_v1",
    macroEnvironment,
    actionableThemeIds: sortUnique(
      input.macroConsensus.themes.filter((theme) => theme.actionable).map((theme) => theme.themeId)
    ),
    bridgeHitIds: sortUnique(input.macroBridge.hits.map((hit) => hit.bridgeHitId)),
    macroBridge: {
      ...input.macroBridge,
      hits: [...input.macroBridge.hits].sort((a, b) => a.bridgeHitId.localeCompare(b.bridgeHitId)),
    },
    environmentalGapIds: sortUnique(input.environmentalGaps.map((gap) => gap.gapId)),
    candidateLaneIds: sortUnique(input.candidateSearchLanes.map((lane) => lane.laneId)),
  };
}

export function replayMacroOutputsFromFrozenEvidence(input: {
  frozenMacroEvidence: FrozenMacroEvidencePacket;
  holdings: HoldingInput[];
  structuralGapReport: GapReport;
  profile: Record<string, any>;
  marketRegime?: { riskMode?: string; rateTrend?: string };
}): {
  macroEnvironment: MacroNewsEnvironmentResult;
  macroConsensus: MacroThemeConsensusResult;
  macroBridge: MacroExposureBridgeResult;
  environmentalGaps: EnvironmentalGap[];
  candidateSearchLanes: CandidateSearchLane[];
} {
  const macroEnvironment: MacroNewsEnvironmentResult = {
    ...input.frozenMacroEvidence.macroEnvironment,
    articles: [...input.frozenMacroEvidence.macroEnvironment.articles].sort(compareArticles),
  };
  const macroConsensus = deriveMacroThemeConsensus(macroEnvironment);
  const macroBridge = applyMacroExposureBridge({
    consensus: macroConsensus,
    environment: macroEnvironment,
  });
  const environmentalGaps = deriveEnvironmentalGaps({
    holdings: input.holdings,
    structuralGapReport: input.structuralGapReport,
    profile: input.profile,
    marketRegime: input.marketRegime,
    macroConsensus,
    macroBridge,
  });
  const candidateSearchLanes = deriveMacroCandidateSearchLanes(environmentalGaps);

  return {
    macroEnvironment,
    macroConsensus,
    macroBridge,
    environmentalGaps,
    candidateSearchLanes,
  };
}
