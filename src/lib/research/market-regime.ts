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
  // Aggregation modifier: dampens buy/sell signals in risk-off
  aggressionMultiplier: number; // 0.5 (risk-off) to 1.2 (risk-on)
}

export async function detectMarketRegime(
  openai: any,
  today: string,
  emit: (e: ProgressEvent) => void
): Promise<MarketRegime> {
  emit({ type: "stage_start", stage: "regime", label: "Market Regime Detection", detail: "Assessing current macro posture: risk-on/off, rates, dollar, volatility" });
  const t0 = Date.now();

  let raw = "";
  try {
    const res = await openai.chat.completions.create({
      model: "gpt-5-search-api",
      max_completion_tokens: 600,
      messages: [{
        role: "user",
        content: `Today is ${today}. Search for current market regime indicators. Answer ONLY with a JSON object (no markdown) with these exact keys:
{
  "riskMode": "risk-on" | "risk-off" | "neutral",
  "rateTrend": "rising" | "falling" | "plateau",
  "dollarTrend": "strengthening" | "weakening" | "stable",
  "vixLevel": "elevated" | "suppressed" | "normal",
  "sectorLeadership": "<one short phrase, e.g. Growth over Value>",
  "summary": "<2-3 sentences citing specific current data: VIX level, 10Y yield, DXY, sector rotation flows>"
}
Cite specific numbers (e.g. VIX at 18.3, 10Y at 4.42%). Do not guess — search for today's values.`
      }]
    });
    raw = res.choices[0]?.message?.content ?? "{}";
  } catch (err: any) {
    emit({ type: "log", message: `Regime detection failed: ${err?.message}`, level: "warn" });
    raw = "{}";
  }

  let parsed: Partial<MarketRegime> = {};
  try {
    // Strip markdown fences if present
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    parsed = JSON.parse(clean);
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
