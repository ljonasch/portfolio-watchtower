/**
 * Stage 4: Signal Aggregation
 * Fixes applied:
 *   F3  — Convergence rule is external-only (AI prompts have no prior recs)
 *   F5  — Role-aware regime multiplier per HoldingRole
 *   W25 — Action vocabulary normalization
 *   W24 — Price data unavailability flag
 */

import type { ProgressEvent } from "./progress-events";
import type { SentimentSignal } from "./sentiment-scorer";
import type { MarketRegime } from "./market-regime";

export interface ModelVerdict {
  ticker: string;
  action: "Buy" | "Hold" | "Sell" | "Trim";
  confidence: "high" | "medium" | "low";
  keyReason: string;
  evidenceQuality: "high" | "medium" | "low";
  role?: string; // from GPT-5 output
}

export interface AggregatedSignal {
  ticker: string;
  finalAction: "Buy" | "Hold" | "Sell" | "Trim";
  score: number;
  confidence: number;
  diverged: boolean;
  divergenceNote: string;
  isCandidate: boolean;
  priceDataMissing: boolean; // W24
  modelSignals: {
    gpt5?: { action: string; confidence: string };
    o3mini?: { action: string; confidence: string };
    sentiment?: { direction: string; magnitude: number };
  };
}

// W25: Action vocabulary normalization
const ACTION_ALIASES: Record<string, "Buy" | "Hold" | "Sell" | "Trim"> = {
  // Canonical actions (MUST be here — actionToScore calls normalizeAction internally)
  "Buy":  "Buy",
  "Hold": "Hold",
  "Sell": "Sell",
  "Trim": "Trim",
  // Buy-direction aliases
  "Strong Buy": "Buy",
  "Accumulate": "Buy",
  "Overweight": "Buy",
  "Add": "Buy",
  // Hold-direction aliases
  "Strong Hold": "Hold",
  "Neutral": "Hold",
  "Market Perform": "Hold",
  "Equal Weight": "Hold",
  // Trim-direction aliases
  "Reduce": "Trim",
  "Underweight": "Trim",
  "Lighten": "Trim",
  // Sell-direction aliases
  "Strong Sell": "Sell",
  "Underperform": "Sell",
};

function normalizeAction(raw: string): "Buy" | "Hold" | "Sell" | "Trim" {
  if (!raw) return "Hold";
  const trimmed = raw.trim();
  // Exact match first
  if (ACTION_ALIASES[trimmed]) return ACTION_ALIASES[trimmed];
  // Fuzzy: check if any alias key is contained
  for (const [key, val] of Object.entries(ACTION_ALIASES)) {
    if (trimmed.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return "Hold";
}

function actionToScore(action: string): number {
  switch (normalizeAction(action)) {
    case "Buy":  return +1.0;
    case "Trim": return -0.5;
    case "Sell": return -1.0;
    default:     return  0.0;
  }
}

function confidenceToWeight(confidence: string): number {
  switch (confidence) {
    case "high":   return 1.0;
    case "medium": return 0.65;
    default:       return 0.3;
  }
}

function scoreToAction(score: number): "Buy" | "Hold" | "Sell" | "Trim" {
  if (score > 0.35)  return "Buy";
  if (score < -0.55) return "Sell";
  if (score < -0.2)  return "Trim";
  return "Hold";
}

/**
 * F5: Role-aware regime multiplier.
 * Risk-off dampens Growth/Speculative/Tactical, amplifies Hedge/Defense/Income.
 */
function getRoleMultiplier(role: string | undefined, regime: MarketRegime): number {
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
    return 0.75; // default risk-off
  }

  if (regime.riskMode === "risk-on") {
    if (r.includes("hedge"))       return 0.80;
    if (r.includes("speculative")) return 1.30;
    if (r.includes("growth"))      return 1.20;
    if (r.includes("tactical"))    return 1.15;
    if (r.includes("core"))        return 1.05;
    return 1.15; // default risk-on
  }

  return 1.0;
}

/**
 * F3: Convergence rule applied externally here (not inside AI prompts).
 * If aggregated score delta vs. prior is below threshold → force Hold.
 */
function applyConvergenceAnchor(
  finalScore: number,
  priorAction: string | undefined,
  diverged: boolean
): number {
  if (!priorAction) return finalScore;
  const priorScore = actionToScore(priorAction);
  const delta = Math.abs(finalScore - priorScore);
  // If neither diverged nor the signal is materially different → anchor to prior
  if (!diverged && delta < 0.25) {
    // Blend toward prior
    return finalScore * 0.4 + priorScore * 0.6;
  }
  return finalScore;
}

export function aggregateSignals(
  tickers: string[],
  gpt5Verdicts: Map<string, ModelVerdict>,
  o3Verdicts: Map<string, ModelVerdict>,
  sentimentSignals: Map<string, SentimentSignal>,
  candidateTickers: Set<string>,
  regime: MarketRegime,
  emit: (e: ProgressEvent) => void,
  priorActions?: Map<string, string>, // F3: prior actions for convergence
  priceDataMissingGlobal?: boolean    // W24
): AggregatedSignal[] {
  const results: AggregatedSignal[] = [];

  for (const ticker of tickers) {
    const gpt5 = gpt5Verdicts.get(ticker);
    const o3   = o3Verdicts.get(ticker);
    const sentiment = sentimentSignals.get(ticker);

    // W25: normalize actions from o3-mini (GPT-5 uses json_schema so it's clean)
    const gpt5Action = gpt5 ? normalizeAction(gpt5.action) : null;
    const o3Action   = o3   ? normalizeAction(o3.action)   : null;

    const gpt5Score = gpt5Action ? actionToScore(gpt5Action) * confidenceToWeight(gpt5?.confidence ?? "medium") : 0;
    const o3Score   = o3Action   ? actionToScore(o3Action)   * confidenceToWeight(o3?.confidence   ?? "medium") : 0;
    const sentScore = sentiment ? sentiment.finalScore : 0;
    const sentConf  = sentiment ? sentiment.confidence : 0;

    const hasGpt5 = !!gpt5;
    const hasO3   = !!o3;
    const hasSent = !!sentiment && sentiment.magnitude > 0;

    const totalWeight = (hasGpt5 ? 0.40 : 0) + (hasO3 ? 0.25 : 0) + (hasSent ? 0.35 : 0);
    const rawScore = totalWeight === 0 ? 0 :
      ((hasGpt5 ? gpt5Score * 0.40 : 0) +
       (hasO3   ? o3Score   * 0.25 : 0) +
       (hasSent ? sentScore * 0.35 : 0)) / totalWeight;

    // F5: role-aware multiplier (per ticker's assigned role from GPT-5)
    const role = gpt5?.role;
    const roleMultiplier = getRoleMultiplier(role, regime);
    const regimeScore = rawScore * roleMultiplier;

    // ── Divergence Detection ──────────────────────────────
    let diverged = false;
    let divergenceNote = "";

    const gpt5Dir = gpt5Action ? actionToScore(gpt5Action) : null;
    const o3Dir   = o3Action   ? actionToScore(o3Action)   : null;
    const sentDir = sentiment?.direction === "buy" ? 1 : sentiment?.direction === "sell" ? -1 : 0;

    if (gpt5Dir !== null && o3Dir !== null && Math.sign(gpt5Dir) !== Math.sign(o3Dir) && (Math.abs(gpt5Dir) > 0.3 || Math.abs(o3Dir) > 0.3)) {
      diverged = true;
      divergenceNote += `GPT-5 says ${gpt5Action}, o3-mini says ${o3Action}. `;
    }

    if (hasSent && sentiment!.magnitude > 0.3 && gpt5Dir !== null) {
      if (Math.sign(sentDir) !== Math.sign(gpt5Dir)) {
        diverged = true;
        divergenceNote += `Sentiment ${sentiment!.direction} conflicts with GPT-5 ${gpt5Action}. Driven by: "${sentiment!.drivingArticle?.slice(0, 50)}".`;
      }
    }

    const cappedScore = diverged ? regimeScore * 0.5 : regimeScore;

    // F3: convergence anchor applied externally
    const priorAction = priorActions?.get(ticker.toUpperCase());
    const anchoredScore = applyConvergenceAnchor(cappedScore, priorAction, diverged);
    const finalAction = scoreToAction(anchoredScore);

    const confidence = Math.min(
      1.0,
      (hasGpt5 ? confidenceToWeight(gpt5!.confidence) * 0.4 : 0) +
      (hasO3   ? confidenceToWeight(o3!.confidence)   * 0.25 : 0) +
      (hasSent ? sentConf * 0.35 : 0)
    ) * (diverged ? 0.6 : 1.0);

    // W24: flag if price data missing globally
    const priceDataMissing = priceDataMissingGlobal ?? false;

    const signal: AggregatedSignal = {
      ticker,
      finalAction,
      score: Math.round(anchoredScore * 100) / 100,
      confidence: Math.round((priceDataMissing ? confidence * 0.8 : confidence) * 100) / 100,
      diverged,
      divergenceNote: divergenceNote.trim(),
      isCandidate: candidateTickers.has(ticker.toUpperCase()),
      priceDataMissing,
      modelSignals: {
        gpt5:      gpt5 ? { action: gpt5Action!, confidence: gpt5.confidence } : undefined,
        o3mini:    o3   ? { action: o3Action!,   confidence: o3.confidence }   : undefined,
        sentiment: sentiment ? { direction: sentiment.direction, magnitude: sentiment.magnitude } : undefined,
      },
    };

    results.push(signal);

    emit({ type: "aggregated_signal", ticker, finalAction, score: anchoredScore, confidence: signal.confidence, diverged, isCandidate: signal.isCandidate });

    if (diverged) {
      emit({ type: "model_divergence", ticker, gpt5Action: gpt5Action ?? "—", o3Action: o3Action ?? "—", sentimentDirection: sentiment?.direction ?? "—", note: divergenceNote.trim() });
    }

    if (gpt5) emit({ type: "model_verdict", model: "gpt5",   ticker, action: gpt5Action!, confidence: gpt5.confidence, keyReason: gpt5.keyReason });
    if (o3)   emit({ type: "model_verdict", model: "o3mini", ticker, action: o3Action!,   confidence: o3.confidence,   keyReason: o3.keyReason   });
  }

  return results;
}
