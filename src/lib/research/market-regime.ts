/**
 * Stage 0-R: Market Regime Detection
 * Determines current macro posture before any portfolio analysis.
 */

import type { ProgressEvent } from "./progress-events";

export interface MarketRegime {
  riskMode: "risk-on" | "risk-off" | "neutral";
  rateTrend: "rising" | "falling" | "plateau";
  dollarTrend: "strengthening" | "weakening" | "stable";
  vixLevel: "elevated" | "suppressed" | "normal";
  sectorLeadership: string;   // e.g. "Growth over Value"
  summary: string;
  aggressionMultiplier: number; // 0.5 (risk-off) to 1.2 (risk-on)
}

// Ensure deterministic numbers to prevent LLM hallucinations
async function fetchMacroIndex(symbol: string): Promise<string> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return "unavailable";
    const json: any = await res.json();
    const price = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    return price && price > 0 ? price.toFixed(2) : "unavailable";
  } catch { return "unavailable"; }
}

export async function detectMarketRegime(
  openai: any,
  today: string,
  emit: (e: ProgressEvent) => void
): Promise<MarketRegime> {
  emit({ type: "stage_start", stage: "regime", label: "Market Regime Detection", detail: "Assessing current macro posture: risk-on/off, rates, dollar, volatility" });
  const t0 = Date.now();

  const [vix, tnx, dxy] = await Promise.all([
    fetchMacroIndex("^VIX"),
    fetchMacroIndex("^TNX"),
    fetchMacroIndex("DX-Y.NYB")
  ]);

  let raw = "";
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await openai.chat.completions.create({
        model: "gpt-5-search-api",
        max_completion_tokens: 250,
        messages: [{
          role: "user",
          content: `Today is ${today}. Asses current market regime indicators for the US stock market.

DETERMINISTIC LIVE DATA:
- VIX (Volatility): ${vix}
- 10-Year Yield: ${tnx}
- US Dollar Index: ${dxy}
If any value is "unavailable", use your web integration to search for it. Otherwise, you MUST use these EXACT numbers to draw your conclusions. Do not hallucinate or guess alternate numbers.

CRITICAL RULES FOR riskMode:
1. "risk-on": The S&P 500 must be definitively trending UP on a 30-day basis with no major panics (VIX < 20).
2. "risk-off": The market must be in a clear, sustained drawdown (e.g., down 5%+ recently) OR the VIX is > 22.
3. "neutral": Any other mixed, mostly flat, or lightly choppy market condition. Do NOT output 'risk-on' or 'risk-off' simply because the market is up or down a small amount today. Rely on the broad 30-day trend.

Answer ONLY with a JSON object (no markdown) with these exact keys:
{
  "riskMode": "risk-on" | "risk-off" | "neutral",
  "rateTrend": "rising" | "falling" | "plateau",
  "dollarTrend": "strengthening" | "weakening" | "stable",
  "vixLevel": "elevated" | "suppressed" | "normal",
  "sectorLeadership": "<one short phrase, e.g. Growth over Value>",
  "summary": "<2-3 sentences citing specific current data: VIX level, 10Y yield, DXY, sector rotation flows>"
}
Do not guess — construct your JSON using the exact live values provided above.`
        }]
      });
      raw = res.choices[0]?.message?.content ?? "{}";
      break; // Success
    } catch (err: any) {
      if (err?.status === 429 && attempt < 8) {
        emit({ type: "log", message: `Regime rate limit hit, waiting 65s for token bucket to refill...`, level: "warn" });
        await new Promise(r => setTimeout(r, 65000));
      } else {
        emit({ type: "log", message: `Regime detection failed: ${err?.message}`, level: "warn" });
        raw = "{}";
        break;
      }
    }
  }

  let parsed: Partial<MarketRegime> = {};
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end !== -1) {
      parsed = JSON.parse(raw.substring(start, end + 1));
    } else {
      parsed = JSON.parse(raw);
    }
  } catch { /* fall through to defaults */ }

  const regime: MarketRegime = {
    riskMode: (parsed as any).riskMode ?? "neutral",
    rateTrend: (parsed as any).rateTrend ?? "plateau",
    dollarTrend: (parsed as any).dollarTrend ?? "stable",
    vixLevel: (parsed as any).vixLevel ?? "normal",
    sectorLeadership: (parsed as any).sectorLeadership ?? "Unknown",
    summary: (parsed as any).summary ?? "Regime data unavailable.",
    aggressionMultiplier:
      (parsed as any).riskMode === "risk-on"  ? 1.15 :
      (parsed as any).riskMode === "risk-off" ? 0.55 : 1.0,
  };

  emit({
    type: "regime",
    riskMode: regime.riskMode,
    rateTrend: regime.rateTrend,
    dollarTrend: regime.dollarTrend,
    vix: regime.vixLevel,
    summary: regime.summary,
  });
  emit({ type: "stage_complete", stage: "regime", durationMs: Date.now() - t0 });
  return regime;
}
