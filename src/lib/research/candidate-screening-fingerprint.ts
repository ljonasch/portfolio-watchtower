import { createHash } from "crypto";

import type {
  CandidateScreeningArtifact,
  CandidateScreeningMode,
  CandidateSearchLane,
} from "./types";

export const CANDIDATE_SCREENING_MODE_RULES = {
  lite: {
    maxMacroLanes: 2,
    targetValidatedCandidateCount: 3,
  },
  full: {
    maxMacroLanes: null,
    targetValidatedCandidateCount: 5,
  },
} as const satisfies Record<CandidateScreeningMode, {
  maxMacroLanes: number | null;
  targetValidatedCandidateCount: number;
}>;

const SCREENING_TICKER_ALIASES: Record<string, string[]> = {
  GOOGL: ["GOOG"],
  GOOG: ["GOOGL"],
  "BRK.A": ["BRK.B", "BRKB"],
  "BRK.B": ["BRK.A", "BRKA"],
  META: ["FB"],
  FB: ["META"],
  SPY: ["VOO", "IVV"],
  VOO: ["SPY", "IVV"],
  IVV: ["SPY", "VOO"],
  QQQ: ["QQQM"],
  QQQM: ["QQQ"],
};

function normalizeWhitespace(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function expandCandidateScreeningAliases(tickers: string[]): Set<string> {
  const expanded = new Set(tickers.map((ticker) => ticker.toUpperCase()));
  for (const ticker of tickers) {
    const aliases = SCREENING_TICKER_ALIASES[ticker.toUpperCase()] ?? [];
    aliases.forEach((alias) => expanded.add(alias.toUpperCase()));
  }
  return expanded;
}

export function resolveCandidateScreeningMode(
  triggerType: "manual" | "scheduled" | "debug"
): CandidateScreeningMode {
  return triggerType === "scheduled" ? "lite" : "full";
}

export function sortMacroLanesForScreening(lanes: CandidateSearchLane[]): CandidateSearchLane[] {
  return [...lanes].sort((a, b) => {
    const priorityDelta = a.priority - b.priority;
    if (priorityDelta !== 0) return priorityDelta;

    const laneKeyDelta = a.laneKey.localeCompare(b.laneKey);
    if (laneKeyDelta !== 0) return laneKeyDelta;

    return a.laneId.localeCompare(b.laneId);
  });
}

export function selectMacroLanesForScreening(
  lanes: CandidateSearchLane[],
  mode: CandidateScreeningMode
): {
  selected: CandidateSearchLane[];
  skippedByMode: CandidateSearchLane[];
} {
  const sorted = sortMacroLanesForScreening(lanes);
  const maxMacroLanes = CANDIDATE_SCREENING_MODE_RULES[mode].maxMacroLanes;

  if (maxMacroLanes == null) {
    return {
      selected: sorted,
      skippedByMode: [],
    };
  }

  return {
    selected: sorted.slice(0, maxMacroLanes),
    skippedByMode: sorted.slice(maxMacroLanes),
  };
}

export function buildCandidateScreeningFingerprint(input: {
  mode: CandidateScreeningMode;
  structuralSearchBrief: string;
  macroCandidateSearchLanes: CandidateSearchLane[];
  existingTickers: string[];
  permittedAssetClasses?: string | null;
  riskTolerance?: string | null;
}): string {
  const excludedTickerSet = Array.from(expandCandidateScreeningAliases(input.existingTickers)).sort();
  const selectedLanes = selectMacroLanesForScreening(input.macroCandidateSearchLanes, input.mode).selected;

  const normalizedPayload = {
    mode: input.mode,
    structuralSearchBrief: normalizeWhitespace(input.structuralSearchBrief).toLowerCase(),
    excludedTickers: excludedTickerSet,
    permittedAssetClasses: normalizeWhitespace(input.permittedAssetClasses).toLowerCase(),
    riskTolerance: normalizeWhitespace(input.riskTolerance).toLowerCase(),
    macroCandidateSearchLanes: selectedLanes.map((lane) => ({
      laneId: lane.laneId,
      laneKey: lane.laneKey,
      description: normalizeWhitespace(lane.description).toLowerCase(),
      searchTags: [...lane.searchTags].map((tag) => normalizeWhitespace(tag).toLowerCase()).sort(),
      themeIds: [...lane.themeIds].sort(),
      environmentalGapIds: [...lane.environmentalGapIds].sort(),
      bridgeRuleIds: [...lane.bridgeRuleIds].sort(),
      priority: lane.priority,
      allowedAssetClasses: [...lane.allowedAssetClasses].map((asset) => normalizeWhitespace(asset).toLowerCase()).sort(),
    })),
  };

  return createHash("sha256")
    .update(JSON.stringify(normalizedPayload))
    .digest("hex")
    .slice(0, 16);
}

export function extractCandidateScreeningArtifactFromEvidencePacket(
  evidencePacket: unknown
): CandidateScreeningArtifact | null {
  if (!evidencePacket || typeof evidencePacket !== "object" || Array.isArray(evidencePacket)) {
    return null;
  }

  const candidateScreening = (evidencePacket as Record<string, unknown>).candidateScreening;
  if (!candidateScreening || typeof candidateScreening !== "object" || Array.isArray(candidateScreening)) {
    return null;
  }

  const artifact = candidateScreening as Partial<CandidateScreeningArtifact>;
  if (
    typeof artifact.fingerprint !== "string"
    || (artifact.mode !== "lite" && artifact.mode !== "full")
    || !Array.isArray(artifact.candidates)
    || !artifact.diagnostics
    || typeof artifact.diagnostics !== "object"
  ) {
    return null;
  }

  return artifact as CandidateScreeningArtifact;
}
