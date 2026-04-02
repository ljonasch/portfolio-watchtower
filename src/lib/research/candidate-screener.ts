/**
 * Stage 0-C/D: Candidate Stock Screener
 * Fixes applied:
 *   F2  — Candidate price sanity validation (no delisted/hallucinated tickers)
 *   W12 — No recency bias (searches over 30 days not just 7)
 *   W17 — No large-cap bias (explicit small/mid-cap option)
 *   W28 — Ticker alias deduplication (GOOGL/GOOG, BRK.A/BRK.B, etc.)
 */

import type { ProgressEvent } from "./progress-events";

export interface Candidate {
  ticker: string;
  companyName: string;
  source: "gap_screener" | "momentum";
  reason: string;
  catalyst?: string;
  analystRating?: string;
  validatedPrice?: number; // F2
}

// W28: Known ticker aliases (expand held set before exclusion check)
const TICKER_ALIASES: Record<string, string[]> = {
  GOOGL:  ["GOOG"],
  GOOG:   ["GOOGL"],
  "BRK.A": ["BRK.B", "BRKB"],
  "BRK.B": ["BRK.A", "BRKA"],
  META:   ["FB"],
  FB:     ["META"],
  "SPY":  ["VOO", "IVV"],
  "VOO":  ["SPY", "IVV"],
  "IVV":  ["SPY", "VOO"],
  "QQQ":  ["QQQM"],
  "QQQM": ["QQQ"],
};

function expandAliases(tickers: string[]): Set<string> {
  const expanded = new Set(tickers.map(t => t.toUpperCase()));
  for (const t of tickers) {
    const aliases = TICKER_ALIASES[t.toUpperCase()] ?? [];
    aliases.forEach(a => expanded.add(a.toUpperCase()));
  }
  return expanded;
}

// F2 + F4: Validate candidate ticker via Yahoo Finance price + 5d trend check
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
    if (price <= 0.01) return null; // < $0.01 likely delisted/OTC shell

    // F4: 5-day trend pre-filter. If down >10% in 5 days, drop the falling knife before Stage 1.
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter(c => typeof c === "number" && c > 0);
    if (validCloses.length >= 2) {
      const first = validCloses[0];
      const last = validCloses[validCloses.length - 1];
      const dropPct = ((last - first) / first) * 100;
      if (dropPct < -10) {
        // Falling knife, eliminate
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

export async function screenCandidates(
  openai: any,
  existingTickers: string[],
  searchBrief: string,
  profile: Record<string, any>,
  today: string,
  emit: (e: ProgressEvent) => void
): Promise<Candidate[]> {
  emit({ type: "stage_start", stage: "candidates", label: "Candidate Stock Screening", detail: "Gap-targeted screener + momentum (30-day window, size-agnostic)" });
  const t0 = Date.now();

  const excluded = existingTickers.join(", ");
  const riskTolerance = profile.trackedAccountRiskTolerance ?? "medium";
  const permittedAssets = profile.permittedAssetClasses ?? "Stocks, ETFs";
  // W17: do NOT enforce large-cap minimum — any liquid stock is fine
  const liquidityReq = riskTolerance === "low" ? "liquid, established companies with >$5B market cap" : "liquid with average daily volume >500K shares";

  // W28: expand exclusion list with aliases
  const excludedSet = expandAliases(existingTickers);

    async function fetchWithRetry(prompt: string, attempt = 1): Promise<any> {
      try {
        const res = await openai.chat.completions.create({
          model: "gpt-5-search-api",
          max_completion_tokens: 300,
          messages: [{ role: "user", content: prompt }]
        });
        return res;
      } catch (err: any) {
        if (err?.status === 429 && attempt < 8) {
          emit({ type: "log", message: `Candidate screener rate limit hit, waiting 65s...`, level: "warn" });
          await new Promise(r => setTimeout(r, 65000));
          return fetchWithRetry(prompt, attempt + 1);
        }
        emit({ type: "log", message: `Candidate screen failed: ${err?.message}`, level: "warn" });
        return null;
      }
    }

    const unifiedPrompt = `Today is ${today}. Find 3-4 stocks that fill this portfolio gap: "${searchBrief}".
Find 3-4 MORE stocks with significant positive catalysts (earnings beats, FDA approvals, major contract wins, analyst upgrades) in the last 30 days.

Requirements:
- NOT any of these: ${excluded}
- Asset types: ${permittedAssets}
- ${liquidityReq}
- Currently rated Buy or Strong Buy by at least 1 major analyst
- Must have a specific event catalyst from the last 30 days

Return ONLY a JSON array, no other text:
[{"ticker":"SYMBOL","companyName":"Name","reason":"why this fills the gap OR why it has momentum","catalyst":"specific event and date","analystRating":"rating or none"}]`;

    const unifiedRes = await fetchWithRetry(unifiedPrompt);

  const candidates: Candidate[] = [];
  const seenTickers = new Set(excludedSet);

  const parseAndAdd = (res: any) => {
    if (!res) return;
    const raw = (res as any).choices?.[0]?.message?.content ?? "";
    const items = extractJsonArray(raw);

    for (const item of items) {
      const ticker = String(item.ticker ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
      if (!ticker || ticker.length > 6) continue;
      if (seenTickers.has(ticker)) continue;

      // W28: also check aliases
      const aliasMatch = (TICKER_ALIASES[ticker] ?? []).some(a => seenTickers.has(a.toUpperCase()));
      if (aliasMatch) {
        emit({ type: "log", message: `${ticker}: skipped — already held under alias`, level: "info" });
        continue;
      }

      seenTickers.add(ticker);
      candidates.push({
        ticker,
        companyName: String(item.companyName ?? "").slice(0, 60),
        source: "gap_screener", // Unified tag
        reason: String(item.reason ?? "").slice(0, 200),
        catalyst: item.catalyst ? String(item.catalyst).slice(0, 200) : undefined,
        analystRating: item.analystRating ? String(item.analystRating).slice(0, 50) : undefined,
      });
    }
  };

  parseAndAdd(unifiedRes);

  // F2: Validate all candidates with price check (parallel, non-blocking on failure)
  emit({ type: "log", message: `Validating ${candidates.length} candidates via price check...`, level: "info" });
  const validated: Candidate[] = [];

  await Promise.all(
    candidates.map(async c => {
      const price = await validateCandidatePrice(c.ticker);
      if (price === null) {
        emit({ type: "log", message: `${c.ticker}: REJECTED — no live price (delisted or hallucinated)`, level: "warn" });
        return;
      }
      c.validatedPrice = price;
      validated.push(c);
      emit({ type: "candidate_found", ticker: c.ticker, companyName: c.companyName, source: c.source, reason: c.reason, catalyst: c.catalyst });
    })
  );

  emit({ type: "log", message: `Candidates: ${validated.length} validated, ${candidates.length - validated.length} rejected`, level: "info" });
  emit({ type: "stage_complete", stage: "candidates", durationMs: Date.now() - t0 });
  return validated;
}
