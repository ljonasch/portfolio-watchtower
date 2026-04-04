import { createHash } from "crypto";

import type { GapAnalysisArtifact } from "./types";

// Reuse recent exact-match structural gap analysis for up to 72 hours,
// then force a fresh provider pass so unchanged portfolios do not suppress
// renewed gap discovery indefinitely.
export const GAP_ANALYSIS_REUSE_MAX_AGE_HOURS = 72;

interface GapAnalysisFingerprintHoldingInput {
  ticker: string;
  currentWeight: number;
  isCash: boolean;
}

function normalizeWhitespace(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function buildGapAnalysisFingerprint(input: {
  holdings: GapAnalysisFingerprintHoldingInput[];
  profile: Record<string, any>;
}): string {
  const normalizedPayload = {
    holdings: [...input.holdings]
      .map((holding) => ({
        ticker: String(holding.ticker ?? "").toUpperCase(),
        currentWeight: Number((holding.currentWeight ?? 0).toFixed(4)),
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
  };

  return createHash("sha256")
    .update(JSON.stringify(normalizedPayload))
    .digest("hex")
    .slice(0, 16);
}

export function extractGapAnalysisArtifactFromEvidencePacket(
  evidencePacket: unknown
): GapAnalysisArtifact | null {
  if (!evidencePacket || typeof evidencePacket !== "object" || Array.isArray(evidencePacket)) {
    return null;
  }

  const gapAnalysis = (evidencePacket as Record<string, unknown>).gapAnalysis;
  if (!gapAnalysis || typeof gapAnalysis !== "object" || Array.isArray(gapAnalysis)) {
    return null;
  }

  const artifact = gapAnalysis as Partial<GapAnalysisArtifact>;
  if (
    typeof artifact.fingerprint !== "string"
    || !artifact.report
    || typeof artifact.report !== "object"
    || Array.isArray(artifact.report)
    || !artifact.diagnostics
    || typeof artifact.diagnostics !== "object"
    || Array.isArray(artifact.diagnostics)
  ) {
    return null;
  }

  return artifact as GapAnalysisArtifact;
}
