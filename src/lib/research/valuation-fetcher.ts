/**
 * Valuation Anchor
 * Fix W13: Provide quantitative valuation context (P/E, forward P/E, PEG, 52w range)
 * to prevent AI from ignoring overvaluation or undervaluation signals.
 *
 * Data sourced from Yahoo Finance summary endpoint (no API key required).
 */

import type { ProgressEvent } from "./progress-events";

export interface ValuationData {
  ticker: string;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  pegRatio: number | null;
  week52High: number | null;
  week52Low: number | null;
  currentPrice: number | null;
  pctFrom52High: number | null; // negative = below 52w high
  analystTargetPrice: number | null;
  analystUpsidePct: number | null;
  sector?: string;
  sectorPE?: number | null; // for relative valuation
}

// Rough sector median P/Es for relative comparison (updated periodically)
const SECTOR_PE_MEDIANS: Record<string, number> = {
  "Technology":           28,
  "Healthcare":           22,
  "Financials":           12,
  "Consumer Discretionary": 20,
  "Communication Services": 18,
  "Industrials":          18,
  "Energy":               11,
  "Utilities":            16,
  "Materials":            14,
  "Consumer Staples":     18,
  "Real Estate":          35,
};

export async function fetchValuationData(ticker: string): Promise<ValuationData | null> {
  if (ticker === "CASH") return null;

  // Handle crypto — no P/E applicable
  const cryptoTickers = new Set(["BTC", "ETH", "SOL", "BNB", "ADA", "DOGE", "XRP"]);
  if (cryptoTickers.has(ticker.toUpperCase())) {
    return {
      ticker,
      trailingPE: null, forwardPE: null, priceToBook: null, priceToSales: null, pegRatio: null,
      week52High: null, week52Low: null, currentPrice: null, pctFrom52High: null,
      analystTargetPrice: null, analystUpsidePct: null,
    };
  }

  try {
    // v11 quoteSummary: v10 returns 403 from server-side Node contexts without crumbs
    const url = `https://query2.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail%2CdefaultKeyStatistics%2CfinancialData`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return fetchValuationFromChart(ticker);

    const json: any = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return fetchValuationFromChart(ticker);

    const sd  = result.summaryDetail ?? {};
    const ks  = result.defaultKeyStatistics ?? {};
    const fd  = result.financialData ?? {};

    const currentPrice: number | null  = fd.currentPrice?.raw ?? null;
    const week52High: number | null    = sd.fiftyTwoWeekHigh?.raw ?? null;
    const week52Low: number | null     = sd.fiftyTwoWeekLow?.raw  ?? null;
    const targetPrice: number | null   = fd.targetMeanPrice?.raw   ?? null;

    const pctFrom52High = currentPrice && week52High
      ? ((currentPrice - week52High) / week52High) * 100
      : null;

    const analystUpsidePct = currentPrice && targetPrice
      ? ((targetPrice - currentPrice) / currentPrice) * 100
      : null;

    const trailingPE = sd.trailingPE?.raw ?? ks.trailingEps?.raw ?? null;
    const sector     = ks.sector ?? undefined;

    // If quoteSummary returned no useful data, fall back to chart API
    if (!currentPrice && !week52High) return fetchValuationFromChart(ticker);

    return {
      ticker,
      trailingPE,
      forwardPE:         sd.forwardPE?.raw                          ?? null,
      priceToBook:       ks.priceToBook?.raw                        ?? null,
      priceToSales:      ks.priceToSalesTrailing12Months?.raw       ?? null,
      pegRatio:          ks.pegRatio?.raw                           ?? null,
      week52High,
      week52Low,
      currentPrice,
      pctFrom52High,
      analystTargetPrice: targetPrice,
      analystUpsidePct,
      sector,
      sectorPE: sector ? (SECTOR_PE_MEDIANS[sector] ?? null) : null,
    };
  } catch {
    return fetchValuationFromChart(ticker);
  }
}

/** Fallback: extract price + 52w range from chart API (no auth, always works) */
async function fetchValuationFromChart(ticker: string): Promise<ValuationData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const currentPrice: number | null = meta.regularMarketPrice       ?? null;
    const week52High: number | null   = meta.fiftyTwoWeekHigh         ?? null;
    const week52Low: number | null    = meta.fiftyTwoWeekLow          ?? null;
    const pctFrom52High = currentPrice && week52High
      ? ((currentPrice - week52High) / week52High) * 100 : null;

    return {
      ticker,
      trailingPE: null, forwardPE: null, priceToBook: null,
      priceToSales: null, pegRatio: null,
      week52High, week52Low, currentPrice, pctFrom52High,
      analystTargetPrice: null, analystUpsidePct: null,
    };
  } catch {
    return null;
  }
}

export async function fetchValuationForAll(
  tickers: string[],
  emit: (e: ProgressEvent) => void
): Promise<Map<string, ValuationData>> {
  const result = new Map<string, ValuationData>();
  const nonCash = tickers.filter(t => t !== "CASH");

  // Parallel with concurrency cap of 6
  const chunk = (arr: string[], size: number) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));

  for (const batch of chunk(nonCash, 6)) {
    await Promise.all(
      batch.map(async ticker => {
        const data = await fetchValuationData(ticker);
        if (data) result.set(ticker.toUpperCase(), data);
      })
    );
  }

  emit({ type: "log", message: `Valuation data: ${result.size}/${nonCash.length} tickers fetched`, level: "info" });
  return result;
}

/**
 * Format valuation data as a compact string for injection into LLM prompt.
 * W13: Provides quantitative anchor so models can't ignore valuation entirely.
 */
export function formatValuationSection(valuations: Map<string, ValuationData>): string {
  if (valuations.size === 0) return "";

  const lines: string[] = ["=== VALUATION ANCHORS ==="];
  for (const [ticker, v] of valuations) {
    const parts: string[] = [ticker];
    if (v.trailingPE)       parts.push(`P/E=${v.trailingPE.toFixed(1)}`);
    if (v.forwardPE)        parts.push(`fwdP/E=${v.forwardPE.toFixed(1)}`);
    if (v.sectorPE)         parts.push(`sectorP/E=${v.sectorPE}`);
    if (v.pegRatio)         parts.push(`PEG=${v.pegRatio.toFixed(2)}`);
    if (v.pctFrom52High !== null) parts.push(`vs52wHigh=${v.pctFrom52High >= 0 ? "+" : ""}${v.pctFrom52High.toFixed(1)}%`);
    if (v.analystUpsidePct !== null) parts.push(`analystUpside=${v.analystUpsidePct >= 0 ? "+" : ""}${v.analystUpsidePct.toFixed(1)}%`);

    lines.push(parts.join(" | "));
  }
  lines.push("NOTE: Flag any position trading >50% premium to sector P/E without a growth justification.");
  lines.push("=== END VALUATION ANCHORS ===");
  return lines.join("\n");
}
