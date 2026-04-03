/**
 * src/lib/research/evidence-packet-builder.ts
 * Builds, hashes, and writes a frozen EvidencePacket before the LLM call.
 * The packet is a deterministic snapshot of all inputs fed to the LLM.
 *
 * Batch 5 — Pipeline Discipline.
 */

import * as crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { MarketRegime } from "./market-regime";
import type { SentimentSignal } from "./sentiment-scorer";
import type { FrozenMacroEvidencePacket } from "./types";

export interface EvidencePacketInput {
  snapshotId: string;
  userId: string;
  runId: string;
  regime: MarketRegime;
  newsText: string;          // guardContextLength-applied combined news
  breaking24h: string;
  // F2: structured signal array replaces prose string — enables per-run diffs
  sentimentSignals: Map<string, SentimentSignal>;
  // articleTitles per ticker used by scorer — persisted to allow diagnosing article-set variation
  articleTitles: Map<string, string[]>;
  priceReactionText: string; // formatted price reaction section
  valuationText: string;
  correlationText: string;
  candidateText: string;
  macroEvidence?: FrozenMacroEvidencePacket | null;
  customPrompt: string | undefined;
  holdingCount: number;
  candidateCount: number;
  // Token budget tracking
  totalInputChars: number;
  perSectionChars: Record<string, number>;
}

export interface EvidencePacketRecord {
  id: string;
  promptHash: string;
  outcome: "pending" | "used" | "abstained";
}

/**
 * buildPromptHash: SHA-256 of the full assembled context string.
 * Used to detect duplicate runs and optionally skip re-analysis.
 */
export function buildPromptHash(assembledContext: string): string {
  return crypto.createHash("sha256").update(assembledContext).digest("hex").slice(0, 16);
}

/**
 * buildPerSectionChars: Returns a map of section name → char count.
 * Used for token budget audit and debug tooling.
 */
export function buildPerSectionChars(sections: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(sections).map(([k, v]) => [k, v.length])
  );
}

/**
 * writeEvidencePacket: Creates the EvidencePacket DB record before the LLM call.
 * On success, returns the record id so the orchestrator can:
 *   1. Update outcome to "used" after successful LLM completion
 *   2. Update outcome to "abstained" if LLM throws a length or abstain error
 */
export async function writeEvidencePacket(
  input: EvidencePacketInput,
  promptHash: string
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const packet = await (prisma as any).evidencePacket.create({
    data: {
      runId: input.runId,
      snapshotId: input.snapshotId,
      schemaVersion: 3,  // v3 adds frozen macro evidence to candidatesJson for per-run replayability
      frozenAt: new Date(),
      outcome: "pending",
      holdingsJson: JSON.stringify({ holdingCount: input.holdingCount }),
      newsJson: JSON.stringify({ text: input.newsText.slice(0, 2000), breaking24h: input.breaking24h.slice(0, 1000) }),
      // F2: per-ticker sub-scores + article titles persisted for cross-run diagnostics
      sentimentJson: JSON.stringify(
        Array.from(input.sentimentSignals.entries()).map(([ticker, s]) => ({
          ticker,
          direction: s.direction,
          finalScore: s.finalScore,
          finbertScore: s.finbertScore,
          fingptScore: s.fingptScore,
          marketReactionScore: s.marketReactionScore,
          confidence: s.confidence,
          magnitude: s.magnitude,
          drivingArticle: s.drivingArticle ?? null,
          priceVerdicts: s.priceVerdicts,
          articleTitles: input.articleTitles.get(ticker) ?? [],
        }))
      ),
      regimeJson: JSON.stringify(input.regime),
      candidatesJson: JSON.stringify({
        text: input.candidateText,
        candidateCount: input.candidateCount,
        macroEvidence: input.macroEvidence ?? null,
      }),
      valuationJson: JSON.stringify({ text: input.valuationText }),
      correlationJson: JSON.stringify({ text: input.correlationText }),
      promptHash,
      totalInputChars: input.totalInputChars,
      perSectionCharsJson: JSON.stringify(input.perSectionChars), // schema field name
    },
  });
  return packet.id;
}

/**
 * updateEvidencePacketOutcome: Updates the packet outcome after the LLM call completes.
 * Called with "used" on success, "abstained" on length/aborted errors.
 */
export async function updateEvidencePacketOutcome(
  packetId: string,
  outcome: "used" | "abstained"
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).evidencePacket.update({
      where: { id: packetId },
      data: { outcome },
    });
  } catch {
    // Non-fatal: packet update failure must never abort the main pipeline
  }
}
