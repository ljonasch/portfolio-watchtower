/**
 * Stage 0-C/D: Candidate Stock Screener
 * Structural search brief plus bounded macro lane inputs.
 */

import type { ProgressEvent } from "./progress-events";
import type { CandidateSearchLane, ScreenedCandidate, ScreenedCandidateSource } from "./types";

interface RawCandidate {
  ticker: string;
  companyName: string;
  source: ScreenedCandidateSource;
  candidateOrigin: "structural" | "macro_lane";
  reason: string;
  catalyst?: string;
  analystRating?: string;
  discoveryLaneId?: string | null;
  macroThemeIds?: string[];
  environmentalGapIds?: string[];
}

function candidateSourcePriority(source: ScreenedCandidateSource): number {
  switch (source) {
    case "gap_screener":
      return 0;
    case "macro_lane":
      return 1;
    case "momentum":
      return 2;
    default:
      return 3;
  }
}

function compareCandidatesDeterministically(a: ScreenedCandidate, b: ScreenedCandidate): number {
  const sourceDelta = candidateSourcePriority(a.source) - candidateSourcePriority(b.source);
  if (sourceDelta !== 0) return sourceDelta;

  const laneDelta = String(a.discoveryLaneId ?? "").localeCompare(String(b.discoveryLaneId ?? ""));
  if (laneDelta !== 0) return laneDelta;

  const tickerDelta = a.ticker.localeCompare(b.ticker);
  if (tickerDelta !== 0) return tickerDelta;

  const companyDelta = a.companyName.localeCompare(b.companyName);
  if (companyDelta !== 0) return companyDelta;

  return a.reason.localeCompare(b.reason);
}

const TICKER_ALIASES: Record<string, string[]> = {
  GOOGL: ["GOOG"],
  GOOG: ["GOOGL"],
  "BRK.A": ["BRK.B", "BRKB"],
  "BRK.B": ["BRK.A", "BRKA"],
  META: ["FB"],
  FB: ["META"],
  SPY: ["VOO", "IVV"],
  VOO: ["SPY", "IVV"],
  IVV: ["SPY", "VOO"],
  QQQ: ["QQQM"],
  QQQM: ["QQQ"],
};

function expandAliases(tickers: string[]): Set<string> {
  const expanded = new Set(tickers.map((ticker) => ticker.toUpperCase()));
  for (const ticker of tickers) {
    const aliases = TICKER_ALIASES[ticker.toUpperCase()] ?? [];
    aliases.forEach((alias) => expanded.add(alias.toUpperCase()));
  }
  return expanded;
}

async function validateCandidatePrice(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const json: any = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const price: number = result.meta?.regularMarketPrice ?? 0;
    if (price <= 0.01) return null;

    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((close) => typeof close === "number" && close > 0);
    if (validCloses.length >= 2) {
      const first = validCloses[0];
      const last = validCloses[validCloses.length - 1];
      const dropPct = ((last - first) / first) * 100;
      if (dropPct < -10) {
        return null;
      }
    }

    return price;
  } catch {
    return null;
  }
}

function extractJsonArray(raw: string): any[] {
  const stripped = raw.trim();
  const s = stripped.indexOf("[");
  const e = stripped.lastIndexOf("]");
  if (s !== -1 && e !== -1 && e >= s) {
    try {
      const parsed = JSON.parse(stripped.slice(s, e + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  const match = stripped.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}

function summarizeMacroLanes(lanes: CandidateSearchLane[]): string {
  if (lanes.length === 0) {
    return "";
  }

  return lanes
    .map((lane) => `${lane.laneKey}: ${lane.description}. Search tags: ${lane.searchTags.join(", ")}.`)
    .join("\n");
}

function buildMacroLaneMap(lanes: CandidateSearchLane[]): Map<string, CandidateSearchLane> {
  return new Map(lanes.map((lane) => [lane.laneId, lane]));
}

export async function screenCandidates(
  openai: any,
  existingTickers: string[],
  structuralSearchBrief: string,
  macroCandidateSearchLanes: CandidateSearchLane[],
  profile: Record<string, any>,
  today: string,
  emit: (e: ProgressEvent) => void
): Promise<ScreenedCandidate[]> {
  emit({
    type: "stage_start",
    stage: "candidates",
    label: "Candidate Stock Screening",
    detail: "Structural gap-targeted screening plus bounded macro candidate lanes",
  });
  const t0 = Date.now();

  const excluded = existingTickers.join(", ");
  const riskTolerance = profile.trackedAccountRiskTolerance ?? "medium";
  const permittedAssets = profile.permittedAssetClasses ?? "Stocks, ETFs";
  const liquidityReq = riskTolerance === "low"
    ? "liquid, established companies with >$5B market cap"
    : "liquid with average daily volume >500K shares";

  const excludedSet = expandAliases(existingTickers);
  const laneMap = buildMacroLaneMap(macroCandidateSearchLanes);

  async function fetchWithRetry(prompt: string, attempt = 1): Promise<any> {
    try {
      return await openai.chat.completions.create({
        model: "gpt-5-search-api",
        max_completion_tokens: 350,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (err: any) {
      if (err?.status === 429 && attempt < 8) {
        emit({ type: "log", message: "Candidate screener rate limit hit, waiting 65s...", level: "warn" });
        await new Promise((resolve) => setTimeout(resolve, 65000));
        return fetchWithRetry(prompt, attempt + 1);
      }
      emit({ type: "log", message: `Candidate screen failed: ${err?.message}`, level: "warn" });
      return null;
    }
  }

  const prompts: Array<{
    source: ScreenedCandidateSource;
    candidateOrigin: "structural" | "macro_lane";
    discoveryLaneId: string | null;
    prompt: string;
    macroThemeIds?: string[];
    environmentalGapIds?: string[];
  }> = [
    {
      source: "gap_screener",
      candidateOrigin: "structural",
      discoveryLaneId: null,
      prompt: `Today is ${today}. Find 3-4 stocks that fill this portfolio structural gap: "${structuralSearchBrief}".

Requirements:
- NOT any of these: ${excluded}
- Asset types: ${permittedAssets}
- ${liquidityReq}
- Currently rated Buy or Strong Buy by at least 1 major analyst
- Must have a specific event catalyst from the last 30 days

Return ONLY a JSON array:
[{"ticker":"SYMBOL","companyName":"Name","reason":"why this fills the structural gap","catalyst":"specific event and date","analystRating":"rating or none"}]`,
    },
  ];

  for (const lane of macroCandidateSearchLanes) {
    prompts.push({
      source: "macro_lane",
      candidateOrigin: "macro_lane",
      discoveryLaneId: lane.laneId,
      macroThemeIds: lane.themeIds,
      environmentalGapIds: lane.environmentalGapIds,
      prompt: `Today is ${today}. Search only within this bounded macro candidate lane:
${summarizeMacroLanes([lane])}

Requirements:
- NOT any of these: ${excluded}
- Asset types: ${permittedAssets}
- ${liquidityReq}
- Currently rated Buy or Strong Buy by at least 1 major analyst
- Must have a specific catalyst or business support reason from the last 30 days
- The result must fit the lane; do not invent unrelated names

Return ONLY a JSON array:
[{"ticker":"SYMBOL","companyName":"Name","reason":"why this fits the lane","catalyst":"specific event and date","analystRating":"rating or none"}]`,
    });
  }

  const rawCandidates: RawCandidate[] = [];
  const seenTickers = new Set(excludedSet);

  for (const promptConfig of prompts) {
    const res = await fetchWithRetry(promptConfig.prompt);
    if (!res) continue;
    const raw = res?.choices?.[0]?.message?.content ?? "";
    const items = extractJsonArray(raw);

    for (const item of items) {
      const ticker = String(item.ticker ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
      if (!ticker || ticker.length > 6) continue;
      if (seenTickers.has(ticker)) continue;

      const aliasMatch = (TICKER_ALIASES[ticker] ?? []).some((alias) => seenTickers.has(alias.toUpperCase()));
      if (aliasMatch) {
        emit({ type: "log", message: `${ticker}: skipped - already held under alias`, level: "info" });
        continue;
      }

      seenTickers.add(ticker);
      rawCandidates.push({
        ticker,
        companyName: String(item.companyName ?? "").slice(0, 60),
        source: promptConfig.source,
        candidateOrigin: promptConfig.candidateOrigin,
        reason: String(item.reason ?? "").slice(0, 220),
        catalyst: item.catalyst ? String(item.catalyst).slice(0, 200) : undefined,
        analystRating: item.analystRating ? String(item.analystRating).slice(0, 50) : undefined,
        discoveryLaneId: promptConfig.discoveryLaneId,
        macroThemeIds: promptConfig.macroThemeIds,
        environmentalGapIds: promptConfig.environmentalGapIds,
      });
    }
  }

  emit({ type: "log", message: `Validating ${rawCandidates.length} candidates via price check...`, level: "info" });

  const validationResults: Array<ScreenedCandidate | null> = await Promise.all(
    rawCandidates.map(async (candidate) => {
      const price = await validateCandidatePrice(candidate.ticker);
      if (price === null) {
        emit({ type: "log", message: `${candidate.ticker}: REJECTED - no live price (delisted or hallucinated)`, level: "warn" });
        return null;
      }

      return {
        ...candidate,
        validatedPrice: price,
      };
    })
  );

  const validated = validationResults
    .filter((candidate): candidate is ScreenedCandidate => candidate !== null)
    .sort(compareCandidatesDeterministically);

  for (const candidate of validated) {
    const lane = candidate.discoveryLaneId ? laneMap.get(candidate.discoveryLaneId) : null;
    emit({
      type: "candidate_found",
      ticker: candidate.ticker,
      companyName: candidate.companyName,
      source: candidate.source,
      reason: lane ? `${candidate.reason} [lane: ${lane.laneKey}]` : candidate.reason,
      catalyst: candidate.catalyst,
    });
  }

  emit({
    type: "log",
    message: `Candidates: ${validated.length} validated, ${rawCandidates.length - validated.length} rejected`,
    level: "info",
  });
  emit({ type: "stage_complete", stage: "candidates", durationMs: Date.now() - t0 });
  return validated;
}
