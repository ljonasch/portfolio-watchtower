import { createHash } from "crypto";

import type {
  FrozenMacroEvidencePacket,
  GapReport,
  HoldingInput,
} from "./types";

// Macro evidence is more freshness-sensitive than structural gap analysis,
// so reuse is limited to the last 24 hours unless a newer finalized bundle exists.
export const MACRO_ENVIRONMENT_REUSE_MAX_AGE_HOURS = 24;

function normalizeWhitespace(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function buildMacroReplayContextFingerprint(input: {
  holdings: Pick<HoldingInput, "ticker" | "computedWeight" | "isCash">[];
  profile: Record<string, any>;
  structuralGapReport: GapReport;
  marketRegime?: { riskMode?: string; rateTrend?: string };
}): string {
  const normalizedPayload = {
    holdings: [...input.holdings]
      .map((holding) => ({
        ticker: String(holding.ticker ?? "").toUpperCase(),
        currentWeight: Number((holding.computedWeight ?? 0).toFixed(4)),
        isCash: Boolean(holding.isCash),
      }))
      .sort((a, b) => {
        const tickerDelta = a.ticker.localeCompare(b.ticker);
        if (tickerDelta !== 0) return tickerDelta;
        const cashDelta = Number(a.isCash) - Number(b.isCash);
        if (cashDelta !== 0) return cashDelta;
        return a.currentWeight - b.currentWeight;
      }),
    profile: {
      trackedAccountObjective: normalizeWhitespace(input.profile?.trackedAccountObjective).toLowerCase(),
      sectorsToEmphasize: normalizeWhitespace(input.profile?.sectorsToEmphasize).toLowerCase(),
    },
    structuralGapInputs: {
      structuralGapCount: Array.isArray(input.structuralGapReport.structuralGaps)
        ? input.structuralGapReport.structuralGaps.length
        : 0,
    },
    marketRegime: {
      riskMode: normalizeWhitespace(input.marketRegime?.riskMode).toLowerCase(),
      rateTrend: normalizeWhitespace(input.marketRegime?.rateTrend).toLowerCase(),
    },
  };

  return createHash("sha256")
    .update(JSON.stringify(normalizedPayload))
    .digest("hex")
    .slice(0, 16);
}

export function extractReusableFrozenMacroEvidence(
  evidencePacket: unknown
): FrozenMacroEvidencePacket | null {
  if (!evidencePacket || typeof evidencePacket !== "object" || Array.isArray(evidencePacket)) {
    return null;
  }

  const macroEvidence = (evidencePacket as Record<string, unknown>).macroEvidence;
  if (!macroEvidence || typeof macroEvidence !== "object" || Array.isArray(macroEvidence)) {
    return null;
  }

  const artifact = macroEvidence as Partial<FrozenMacroEvidencePacket>;
  if (
    artifact.schemaVersion !== "macro_evidence_v1"
    || !artifact.macroEnvironment
    || typeof artifact.macroEnvironment !== "object"
    || Array.isArray(artifact.macroEnvironment)
    || !Array.isArray(artifact.actionableThemeIds)
    || !Array.isArray(artifact.bridgeHitIds)
    || !artifact.macroBridge
    || typeof artifact.macroBridge !== "object"
    || Array.isArray(artifact.macroBridge)
    || !Array.isArray(artifact.environmentalGapIds)
    || !Array.isArray(artifact.candidateLaneIds)
  ) {
    return null;
  }

  return artifact as FrozenMacroEvidencePacket;
}
