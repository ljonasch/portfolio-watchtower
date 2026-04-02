/**
 * signal-aggregator.ts
 *
 * F1 Fix: Dual-LLM co-equal voting removed (anti-patterns S2, S3).
 *
 * Previous: aggregateSignals() merged gpt-5 + o3-mini + sentiment into a
 *   weighted composite score and produced a finalAction from that composite.
 *
 * Now: buildSentimentOverlay() attaches per-ticker sentiment signals and a
 *   regime-aware role multiplier for *display purposes only*.
 *   finalAction is NEVER produced here — it comes exclusively from the
 *   primary gpt-5.4 call in analyzer.ts.
 */

import type { ProgressEvent } from "./progress-events";
import type { SentimentSignal } from "./sentiment-scorer";
import type { MarketRegime } from "./market-regime";

// ── Output type ───────────────────────────────────────────────────────────────

/**
 * Informational overlay per ticker — no finalAction, no score, no voting.
 */
export interface SentimentOverlay {
  ticker: string;
  sentimentDirection: "buy" | "hold" | "sell" | null;
  sentimentMagnitude: number;
  sentimentConfidence: number;
  isCandidate: boolean;
  /** Regime-aware multiplier — informational display only, no recommendation impact. */
  roleMultiplier: number;
  priceDataMissing: boolean;
}

// ── W25: Action vocabulary normalisation (retained for downstream callers) ────

const ACTION_ALIASES: Record<string, string> = {
  "Buy": "Buy",  "Hold": "Hold",  "Sell": "Sell",  "Trim": "Trim",
  "Strong Buy": "Buy",   "Accumulate": "Buy",  "Overweight": "Buy",  "Add": "Buy",
  "Strong Hold": "Hold", "Neutral": "Hold",    "Market Perform": "Hold", "Equal Weight": "Hold",
  "Reduce": "Trim",      "Underweight": "Trim", "Lighten": "Trim",
  "Strong Sell": "Sell", "Underperform": "Sell",
};

export function normalizeAction(raw: string): string {
  if (!raw) return "Hold";
  const trimmed = raw.trim();
  if (ACTION_ALIASES[trimmed]) return ACTION_ALIASES[trimmed];
  for (const [key, val] of Object.entries(ACTION_ALIASES)) {
    if (trimmed.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return "Hold";
}

// ── Role-aware regime multiplier (informational only) ─────────────────────────

export function getRoleMultiplier(role: string | undefined, regime: MarketRegime): number {
  if (regime.riskMode === "neutral") return 1.0;
  const r = (role ?? "").toLowerCase();

  if (regime.riskMode === "risk-off") {
    if (r.includes("hedge"))       return 1.30;
    if (r.includes("defense"))     return 1.20;
    if (r.includes("income"))      return 1.10;
    if (r.includes("core"))        return 0.85;
    if (r.includes("growth"))      return 0.50;
    if (r.includes("tactical"))    return 0.40;
    if (r.includes("speculative")) return 0.25;
    return 0.75;
  }
  if (regime.riskMode === "risk-on") {
    if (r.includes("hedge"))       return 0.80;
    if (r.includes("speculative")) return 1.30;
    if (r.includes("growth"))      return 1.20;
    if (r.includes("tactical"))    return 1.15;
    if (r.includes("core"))        return 1.05;
    return 1.15;
  }
  return 1.0;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build a per-ticker sentiment overlay for display enrichment only.
 *
 * This function does NOT vote on or modify recommendations.
 * It exists so the UI can display sentiment direction and magnitude alongside
 * the authoritative recommendation that comes from the primary LLM call.
 *
 * @param tickers             Full ticker list (held + candidates)
 * @param gpt5Roles           Map of ticker → role string from primary LLM output
 * @param sentimentSignals    Per-ticker SentimentSignal from sentiment scorer
 * @param candidateTickers    Set of candidate (non-held) tickers
 * @param regime              Current market regime
 * @param emit                SSE progress emitter
 * @param priceDataMissing    Whether price data was broadly unavailable this run
 */
export function buildSentimentOverlay(
  tickers: string[],
  gpt5Roles: Map<string, string | undefined>,
  sentimentSignals: Map<string, SentimentSignal>,
  candidateTickers: Set<string>,
  regime: MarketRegime,
  emit: (e: ProgressEvent) => void,
  priceDataMissing?: boolean
): SentimentOverlay[] {
  const results: SentimentOverlay[] = [];
  const missing = priceDataMissing ?? false;

  for (const ticker of tickers) {
    const sentiment = sentimentSignals.get(ticker);
    const role      = gpt5Roles.get(ticker);
    const overlay: SentimentOverlay = {
      ticker,
      sentimentDirection:  sentiment?.direction ?? null,
      sentimentMagnitude:  sentiment?.magnitude  ?? 0,
      sentimentConfidence: sentiment?.confidence ?? 0,
      isCandidate:  candidateTickers.has(ticker.toUpperCase()),
      roleMultiplier: getRoleMultiplier(role, regime),
      priceDataMissing: missing,
    };
    results.push(overlay);
  }

  emit({
    type: "log",
    message: `Sentiment overlay built for ${results.length} tickers`,
    level: "info",
  });

  return results;
}
