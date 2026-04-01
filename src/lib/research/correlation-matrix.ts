/**
 * Correlation Matrix
 * Fix W18: Compute pairwise correlations of holdings using 90-day price history.
 * Flags highly correlated clusters so the AI doesn't add to already-correlated risk.
 *
 * Uses Yahoo Finance daily price history (no API key needed).
 */

import type { ProgressEvent } from "./progress-events";

export interface CorrelationResult {
  ticker1: string;
  ticker2: string;
  correlation: number;  // -1 to +1
  label: "highly_correlated" | "moderately_correlated" | "uncorrelated" | "inversely_correlated";
}

export interface CorrelationMatrix {
  pairs: CorrelationResult[];
  clusters: string[][];  // groups of tickers that are highly correlated
  summary: string;
}

async function fetchDailyReturns(ticker: string, days: number = 90): Promise<number[]> {
  try {
    // Use BTCe for crypto (BTC -> BTC-USD on Yahoo)
    const yahoTicker = ticker === "BTC" ? "BTC-USD" : ticker === "ETH" ? "ETH-USD" : ticker;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoTicker)}?interval=1d&range=${days}d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const closes: number[] = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter(c => c != null && c > 0);
    if (valid.length < 10) return [];

    // Convert to daily returns
    const returns: number[] = [];
    for (let i = 1; i < valid.length; i++) {
      returns.push((valid[i] - valid[i - 1]) / valid[i - 1]);
    }
    return returns;
  } catch {
    return [];
  }
}

function pearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null; // insufficient data

  const aSlice = a.slice(-n);
  const bSlice = b.slice(-n);
  const meanA = aSlice.reduce((s, x) => s + x, 0) / n;
  const meanB = bSlice.reduce((s, x) => s + x, 0) / n;

  let cov = 0, stdA = 0, stdB = 0;
  for (let i = 0; i < n; i++) {
    const da = aSlice[i] - meanA;
    const db = bSlice[i] - meanB;
    cov  += da * db;
    stdA += da * da;
    stdB += db * db;
  }

  const denom = Math.sqrt(stdA * stdB);
  if (denom === 0) return null;
  return Math.max(-1, Math.min(1, cov / denom));
}

function correlationLabel(r: number): CorrelationResult["label"] {
  if (r >= 0.75)       return "highly_correlated";
  if (r >= 0.40)       return "moderately_correlated";
  if (r <= -0.40)      return "inversely_correlated";
  return "uncorrelated";
}

export async function buildCorrelationMatrix(
  tickers: string[],
  emit: (e: ProgressEvent) => void
): Promise<CorrelationMatrix> {
  const nonCash = tickers.filter(t => t !== "CASH");
  if (nonCash.length < 2) {
    return { pairs: [], clusters: [], summary: "Insufficient holdings for correlation analysis." };
  }

  emit({ type: "log", message: `Building 90-day correlation matrix for ${nonCash.length} tickers...`, level: "info" });

  // Fetch all return series in parallel
  const returnsMap = new Map<string, number[]>();
  await Promise.all(
    nonCash.map(async ticker => {
      const returns = await fetchDailyReturns(ticker);
      if (returns.length >= 10) returnsMap.set(ticker.toUpperCase(), returns);
    })
  );

  const available = Array.from(returnsMap.keys());
  const pairs: CorrelationResult[] = [];

  // Compute all pairs
  for (let i = 0; i < available.length; i++) {
    for (let j = i + 1; j < available.length; j++) {
      const t1 = available[i];
      const t2 = available[j];
      const r = pearsonCorrelation(returnsMap.get(t1)!, returnsMap.get(t2)!);
      if (r === null) continue;

      pairs.push({
        ticker1: t1,
        ticker2: t2,
        correlation: Math.round(r * 100) / 100,
        label: correlationLabel(r),
      });
    }
  }

  // Find clusters (groups with ≥75% average pairwise correlation)
  const clusters: string[][] = [];
  const clustered = new Set<string>();

  const highlyCorrelated = pairs.filter(p => p.correlation >= 0.75);
  for (const ticker of available) {
    if (clustered.has(ticker)) continue;
    const group = [ticker];
    for (const other of available) {
      if (other === ticker || clustered.has(other)) continue;
      const pairCorr = highlyCorrelated.find(
        p => (p.ticker1 === ticker && p.ticker2 === other) ||
             (p.ticker1 === other && p.ticker2 === ticker)
      );
      if (pairCorr) { group.push(other); clustered.add(other); }
    }
    if (group.length > 1) {
      group.forEach(t => clustered.add(t));
      clusters.push(group);
    }
  }

  // Build summary
  const highCount = pairs.filter(p => p.label === "highly_correlated").length;
  const warnings = clusters.map(c => `[${c.join(", ")}]`).join(", ");
  const summary = highCount > 0
    ? `${highCount} highly correlated pairs detected. Clusters: ${warnings || "none"}. Avoid adding to any cluster without offsetting a position within it.`
    : `No highly correlated pairs (r≥0.75) detected. Portfolio has reasonable diversification.`;

  emit({ type: "log", message: `Correlation matrix: ${pairs.length} pairs computed, ${highCount} high-correlation warnings`, level: highCount > 3 ? "warn" : "info" });

  return { pairs, clusters, summary };
}

export function formatCorrelationSection(matrix: CorrelationMatrix): string {
  if (matrix.pairs.length === 0) return "";

  const lines = ["=== CORRELATION MATRIX (90-day) ==="];
  lines.push(matrix.summary);

  if (matrix.clusters.length > 0) {
    lines.push("\nHighly correlated clusters (r≥0.75) — treat each cluster as one risk unit:");
    matrix.clusters.forEach((c, i) => lines.push(`  Cluster ${i + 1}: ${c.join(", ")}`));
  }

  const high = matrix.pairs
    .filter(p => p.label === "highly_correlated")
    .sort((a, b) => b.correlation - a.correlation)
    .slice(0, 8);

  if (high.length > 0) {
    lines.push("\nTop correlated pairs (r≥0.75):");
    high.forEach(p => lines.push(`  ${p.ticker1}↔${p.ticker2}: r=${p.correlation}`));
  }

  lines.push("=== END CORRELATION MATRIX ===");
  return lines.join("\n");
}
