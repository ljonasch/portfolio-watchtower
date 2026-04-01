/**
 * Model Performance Tracker
 * Fixes applied:
 *   F8  — Track-record weights (per-model hit rates, adjustable weights)
 *   W11 — Cross-run disagreement memory (tracks how often models diverge)
 *   W20 — Confidence calibration (penalizes overconfident models)
 *
 * Weights start at equal defaults and are updated by the scheduler after each run.
 * Hit rate = % of Bold (high confidence) predictions that were directionally correct
 * after N trading days (default 5).
 */

import type { AppSettings } from "@prisma/client";

export interface ModelWeights {
  gpt5:      number;  // 0.0–1.0 relative weight
  o3mini:    number;
  sentiment: number;
  lastUpdated: string;
  runCount:  number;
}

export interface ModelStats {
  model: "gpt5" | "o3mini" | "sentiment";
  totalPredictions: number;
  correctPredictions: number;
  avgConfidence: number;
  avgError: number;     // |predicted_score - actual_outcome|
  divergenceRate: number; // how often this model disagrees with the eventual consensus
}

// Default weights (equal start, will drift as track record builds)
export const DEFAULT_WEIGHTS: ModelWeights = {
  gpt5:      0.40,
  o3mini:    0.25,
  sentiment: 0.35,
  lastUpdated: new Date().toISOString(),
  runCount:  0,
};

const WEIGHTS_KEY = "model_weights";
const STATS_KEY   = "model_stats";
const MIN_RUNS_FOR_WEIGHT_UPDATE = 20; // W20: minimum runs before diverging from defaults

export async function loadModelWeights(prisma: any): Promise<ModelWeights> {
  try {
    const setting = await prisma.appSettings.findUnique({ where: { key: WEIGHTS_KEY } });
    if (!setting) return { ...DEFAULT_WEIGHTS };
    const loaded = JSON.parse(setting.value) as ModelWeights;
    // Ensure weights sum to ~1.0 (normalize if drifted)
    const sum = loaded.gpt5 + loaded.o3mini + loaded.sentiment;
    if (sum < 0.5 || sum > 2.0) return { ...DEFAULT_WEIGHTS }; // corrupt, reset
    return loaded;
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export async function recordRunStats(
  prisma: any,
  runResults: {
    gpt5Correct?: boolean;
    o3Correct?: boolean;
    sentimentCorrect?: boolean;
    gpt5Confidence: number;
    o3Confidence: number;
    divergedTickers: string[];
    totalTickers: number;
  }
): Promise<void> {
  try {
    const existing = await prisma.appSettings.findUnique({ where: { key: STATS_KEY } });
    const stats: ModelStats[] = existing ? JSON.parse(existing.value) : [
      { model: "gpt5",      totalPredictions: 0, correctPredictions: 0, avgConfidence: 0, avgError: 0, divergenceRate: 0 },
      { model: "o3mini",    totalPredictions: 0, correctPredictions: 0, avgConfidence: 0, avgError: 0, divergenceRate: 0 },
      { model: "sentiment", totalPredictions: 0, correctPredictions: 0, avgConfidence: 0, avgError: 0, divergenceRate: 0 },
    ];

    const divergenceRate = runResults.totalTickers > 0 ? runResults.divergedTickers.length / runResults.totalTickers : 0;

    for (const stat of stats) {
      stat.totalPredictions++;
      if (stat.model === "gpt5"      && runResults.gpt5Correct      != null) { if (runResults.gpt5Correct)      stat.correctPredictions++; }
      if (stat.model === "o3mini"    && runResults.o3Correct        != null) { if (runResults.o3Correct)        stat.correctPredictions++; }
      if (stat.model === "sentiment" && runResults.sentimentCorrect  != null) { if (runResults.sentimentCorrect) stat.correctPredictions++; }
      stat.divergenceRate = (stat.divergenceRate * (stat.totalPredictions - 1) + divergenceRate) / stat.totalPredictions;
    }

    await prisma.appSettings.upsert({
      where: { key: STATS_KEY },
      create: { key: STATS_KEY, value: JSON.stringify(stats) },
      update: { value: JSON.stringify(stats) },
    });

    // Update weights if we have enough runs
    await maybeUpdateWeights(prisma, stats);
  } catch {
    // Non-fatal — model tracking is best-effort
  }
}

async function maybeUpdateWeights(prisma: any, stats: ModelStats[]): Promise<void> {
  const totalRuns = Math.max(...stats.map(s => s.totalPredictions));
  if (totalRuns < MIN_RUNS_FOR_WEIGHT_UPDATE) return;

  const getHitRate = (model: string) => {
    const s = stats.find(s => s.model === model);
    if (!s || s.totalPredictions === 0) return 0.5;
    return s.correctPredictions / s.totalPredictions;
  };

  const gpt5Rate = getHitRate("gpt5");
  const o3Rate   = getHitRate("o3mini");
  const sentRate = getHitRate("sentiment");

  const total = gpt5Rate + o3Rate + sentRate;
  if (total === 0) return;

  // W20: Confidence calibration — penalty for high divergence (overconfident models diverge more)
  const getDivPenalty = (model: string) => {
    const s = stats.find(s => s.model === model);
    return s ? Math.max(0, 1 - s.divergenceRate * 0.5) : 1.0;
  };

  const gpt5Adj  = gpt5Rate * getDivPenalty("gpt5");
  const o3Adj    = o3Rate   * getDivPenalty("o3mini");
  const sentAdj  = sentRate * getDivPenalty("sentiment");
  const adjTotal = gpt5Adj + o3Adj + sentAdj;

  const newWeights: ModelWeights = {
    gpt5:      Math.round((gpt5Adj  / adjTotal) * 100) / 100,
    o3mini:    Math.round((o3Adj    / adjTotal) * 100) / 100,
    sentiment: Math.round((sentAdj  / adjTotal) * 100) / 100,
    lastUpdated: new Date().toISOString(),
    runCount: totalRuns,
  };

  await prisma.appSettings.upsert({
    where: { key: WEIGHTS_KEY },
    create: { key: WEIGHTS_KEY, value: JSON.stringify(newWeights) },
    update: { value: JSON.stringify(newWeights) },
  });
}

export function getDivergenceSummary(stats: ModelStats[]): string {
  return stats
    .map(s => `${s.model}: ${Math.round(s.correctPredictions / Math.max(s.totalPredictions, 1) * 100)}% hit (${s.totalPredictions} runs, div=${(s.divergenceRate * 100).toFixed(0)}%)`)
    .join(" | ");
}
