/**
 * research/news-fetcher.ts
 * Modular, typed news fetching pipeline.
 * Replaces inline fetch logic in analyzer.ts.
 * Returns EvidenceItem[] rather than raw strings.
 */

import type { EvidenceItem, Source } from "./types";
import { deduplicateSources, rankSources } from "./source-ranker";

interface RawNewsResult {
  summary: string;
  sources: Source[];
}

// ─── Yahoo Finance fallback ───────────────────────────────────────────────────

export async function fetchYahooFinanceFallback(
  tickers: string[]
): Promise<RawNewsResult> {
  try {
    const nonCash = tickers.filter((t) => t !== "CASH").slice(0, 10);
    if (nonCash.length === 0) return { summary: "", sources: [] };

    const allTitles: string[] = [];
    const sources: Source[] = [];

    await Promise.all(
      nonCash.map(async (ticker) => {
        try {
          const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${ticker}&newsCount=3`;
          const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!res.ok) return;
          const json: any = await res.json();
          const news = json?.news ?? [];
          for (const item of news) {
            if (item?.title && item?.link) {
              allTitles.push(`- [${ticker}] ${item.title}`);
              sources.push({ title: item.title, url: item.link, quality: "medium" });
            }
          }
        } catch {
          /* ignore individual ticker failures */
        }
      })
    );

    if (allTitles.length === 0) return { summary: "", sources: [] };
    return {
      summary: `Recent headlines (Yahoo Finance fallback):\n${allTitles.join("\n")}`,
      sources,
    };
  } catch {
    return { summary: "", sources: [] };
  }
}

// ─── F9: Sentence-level content deduplication ────────────────────────────────

/**
 * F9: Hash key sentences (>60 chars) from news text.
 * Returns set of sentence fingerprints for cross-search dedup.
 */
function hashSentences(text: string): Set<string> {
  const sentences = text
    .split(/[.!?]\s+/)
    .map(s => s.trim().toLowerCase().replace(/\s+/g, " "))
    .filter(s => s.length > 60);
  return new Set(sentences);
}

/**
 * F9: Mark duplicate content across multiple search results.
 * Injects [Corroborated across N searches — treat as 1 source, not N.] annotation.
 */
export function deduplicateNewsContent(results: { label: string; content: string }[]): {
  deduplicatedContent: string[];
  corroborationCount: number;
} {
  const allHashes = new Map<string, number>(); // hash → count of occurrences

  // First pass: count how many documents each sentence appears in
  for (const { content } of results) {
    const seen = new Set<string>();
    for (const hash of hashSentences(content)) {
      if (!seen.has(hash)) {
        allHashes.set(hash, (allHashes.get(hash) ?? 0) + 1);
        seen.add(hash);
      }
    }
  }

  let corroborationCount = 0;
  const deduplicatedContent: string[] = [];

  for (const { label, content } of results) {
    // Find sentences in this document that appear in ≥2 other searches
    const sharedHashes = new Set(
      [...hashSentences(content)].filter(h => (allHashes.get(h) ?? 0) >= 2)
    );

    if (sharedHashes.size > 0) {
      corroborationCount += sharedHashes.size;
      // Prepend corroboration note so LLM knows to count as 1 source
      deduplicatedContent.push(
        `=== ${label} [CORROBORATED: ${sharedHashes.size} facts appear across multiple searches — weight once, not ${allHashes.get([...sharedHashes][0]) ?? 2}×] ===\n${content}`
      );
    } else {
      deduplicatedContent.push(`=== ${label} ===\n${content}`);
    }
  }

  return { deduplicatedContent, corroborationCount };
}

// ─── OpenAI web search helper ─────────────────────────────────────────────────

// N8: Primary model with gpt-5-search-api; fallback to gpt-4o-search-preview on deprecation
const SEARCH_MODELS = ["gpt-5-search-api", "gpt-4o-search-preview"];

async function openaiSearchCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openai: any,
  prompt: string
): Promise<RawNewsResult> {
  for (const model of SEARCH_MODELS) {
    try {
      const resp = await (openai.chat.completions.create as Function)({
        model,
        web_search_options: {},
        messages: [{ role: "user", content: prompt }],
      });

      const message = resp.choices[0]?.message;
      const textContent: string = message?.content ?? "";
      const annotations: any[] = message?.annotations ?? [];

      const rawSources: Source[] = annotations
        .filter((a: any) => a.type === "url_citation" && a.url_citation?.url)
        .map((a: any) => ({
          title: a.url_citation.title ?? new URL(a.url_citation.url).hostname,
          url: a.url_citation.url,
        }));

      const rankedSources = rankSources(rawSources);
      return { summary: textContent, sources: rankedSources };
    } catch (err: any) {
      const isDeprecated = err?.status === 404 || err?.message?.includes("deprecated") || err?.message?.includes("not found");
      if (isDeprecated && model !== SEARCH_MODELS[SEARCH_MODELS.length - 1]) {
        console.warn(`[news-fetcher] Model ${model} unavailable, trying fallback...`);
        continue; // try next model
      }
      console.warn("[news-fetcher] Search call failed:", err?.message);
      return { summary: "", sources: [] };
    }
  }
  return { summary: "", sources: [] };
}

// ─── Three targeted searches ──────────────────────────────────────────────────

export async function fetchMacroNews(
  openai: any,
  tickers: string[],
  today: string,
  onProgress?: () => void
): Promise<EvidenceItem> {
  const tickerList = tickers.filter((t) => t !== "CASH").join(", ");
  const result = await openaiSearchCall(
    openai,
    `Today is ${today}. Search exclusively for MACROECONOMIC and GEOPOLITICAL news from the last 30 days that affects equity markets broadly and specifically these holdings: ${tickerList}.

Find and cite at least 5–8 distinct real news articles from high-quality sources (Reuters, Bloomberg, FT, WSJ, AP, Federal Reserve, BLS, BEA). Search specifically for:
- Federal Reserve rate decisions, FOMC minutes, Fed speaker comments
- CPI, PCE, jobs report (NFP), GDP data releases
- Geopolitical flashpoints: wars, sanctions, tariffs, trade disputes
- Treasury yield movements and dollar strength
- Energy/commodity shocks (oil, natural gas, metals)

For each item, state which ticker(s) it impacts and how. Cite every source with a real URL from a reputable outlet.`
  );
  onProgress?.();

  return {
    content: result.summary,
    sources: result.sources,
    evidenceType: "secondary",
    category: "macro",
  };
}

export async function fetchCompanyNews(
  openai: any,
  tickers: string[],
  today: string,
  onProgress?: () => void
): Promise<EvidenceItem> {
  const tickerList = tickers.filter((t) => t !== "CASH").join(", ");
  const result = await openaiSearchCall(
    openai,
    `Today is ${today}. Search for COMPANY-SPECIFIC news from the last 30 days for EACH of these individual stocks: ${tickerList}.

For EACH ticker, find and cite separate, dedicated articles about:
- Latest earnings reports, revenue beats/misses, EPS surprises (prefer company IR pages or SEC filings)
- Forward guidance changes, analyst upgrades/downgrades, price target revisions
- Insider buying/selling, share buybacks
- Product launches, partnerships, acquisitions, or legal issues
- CEO/executive changes

Treat each ticker independently. Cite a unique, real article URL for each company from Reuters, Bloomberg, WSJ, BusinessWire, PRNewswire, or the company's own investor relations site. Do not reuse the same sources across different tickers.`
  );
  onProgress?.();

  return {
    content: result.summary,
    sources: result.sources,
    evidenceType: "primary",
    category: "company",
  };
}

export async function fetchSectorNews(
  openai: any,
  tickers: string[],
  today: string,
  onProgress?: () => void
): Promise<EvidenceItem> {
  const tickerList = tickers.filter((t) => t !== "CASH").join(", ");
  const result = await openaiSearchCall(
    openai,
    `Today is ${today}. Search for SECTOR, REGULATORY, and THEMATIC news from the last 30 days relevant to the industry sectors of these holdings: ${tickerList}.

Focus on high-quality regulatory and policy sources:
- AI / semiconductor / cloud computing regulatory news (cite EU AI Act, US export controls, FTC/DOJ antitrust filings)
- Energy transition policy, EPA rules, oil/gas sector trends
- Financial regulatory changes (SEC filings, Fed banking rules, interest rate policy)
- Healthcare/biotech FDA approvals, drug pricing legislation (cite FDA.gov, HHS sources)
- Defense spending bills, government contracts (cite DoD, GAO)
- Tech antitrust investigations or rulings (cite DOJ, FTC)

Prefer primary/official sources. For each theme, cite multiple distinct sources. Link specifically to how each news item affects one or more of the listed holdings.`
  );
  onProgress?.();

  return {
    content: result.summary,
    sources: result.sources,
    evidenceType: "secondary",
    category: "sector",
  };
}

// ─── 24-hour breaking news search ────────────────────────────────────────────

export async function fetch24hNews(
  openai: any,
  tickers: string[],
  today: string,
  onProgress?: () => void
): Promise<EvidenceItem & { hoursOld?: number }> {
  const tickerList = tickers.filter((t) => t !== "CASH").join(", ");
  // yesterday ISO date for bounding the search
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const result = await openaiSearchCall(
    openai,
    `Today is ${today}. Search ONLY for news published in the last 24 hours (since ${yesterday}) for these holdings: ${tickerList}.

This is a BREAKING NEWS search. Only include items that are:
- Earnings reports or earnings surprises released today or after market close yesterday
- Federal Reserve or Treasury announcements in the last 24 hours
- Analyst upgrades or downgrades issued today
- Breaking geopolitical events (tariffs announced, sanctions, military action) in last 24h
- Premarket or after-hours price moves >3% with a known catalyst
- FDA approvals or rejections, product recalls, or regulatory actions issued today
- Major CEO statements, acquisitions, or contract wins announced in last 24h

For EACH item, specify:
1. TICKER: which holding is affected
2. EVENT: what happened (1 sentence)
3. PUBLISHED: the exact date and time if available
4. IMPACT: Buy/Sell/Hold signal strength — classify as STRONG (override 30-day thesis), MODERATE (adjust weight), or NOISE (log but don't change position)
5. SOURCE: real URL from Reuters, Bloomberg, AP, MarketWatch, or the company IR page

If there is genuinely no breaking news for a ticker in the last 24 hours, say "No breaking news" for that ticker. Do not fabricate events.`
  );
  onProgress?.();

  return {
    content: result.summary,
    sources: result.sources,
    evidenceType: "primary",
    category: "macro",
    hoursOld: 24,
  };
}

// ─── Combined news fetch with fallback ───────────────────────────────────────

export async function fetchAllNewsWithFallback(
  openai: any,
  tickers: string[],
  today: string,
  onProgress?: (step: number) => void
): Promise<{
  evidence: EvidenceItem[];
  combinedSummary: string;
  allSources: Source[];
  usingFallback: boolean;
  breaking24h: string;      // separate field so prompt can label it BREAKING
}> {
  const nonCash = tickers.filter((t) => t !== "CASH");
  if (nonCash.length === 0) {
    return { evidence: [], combinedSummary: "", allSources: [], usingFallback: false, breaking24h: "" };
  }

  // Fire all 4 searches in parallel — 24h search runs alongside the 30-day searches
  const [macro, company, sector, breaking] = await Promise.all([
    fetchMacroNews(openai, tickers, today, () => onProgress?.(0)).catch(() => ({
      content: "",
      sources: [],
      evidenceType: "secondary" as const,
      category: "macro" as const,
    })),
    fetchCompanyNews(openai, tickers, today, () => onProgress?.(1)).catch(() => ({
      content: "",
      sources: [],
      evidenceType: "primary" as const,
      category: "company" as const,
    })),
    fetchSectorNews(openai, tickers, today, () => onProgress?.(2)).catch(() => ({
      content: "",
      sources: [],
      evidenceType: "secondary" as const,
      category: "sector" as const,
    })),
    fetch24hNews(openai, tickers, today, () => onProgress?.(3)).catch(() => ({
      content: "",
      sources: [],
      evidenceType: "primary" as const,
      category: "macro" as const,
    })),
  ]);

  const evidence = [macro, company, sector, breaking];

  // Breaking is surfaced separately so the prompt can label and weight it distinctly
  const breaking24hText = breaking.content?.trim() ?? "";

  // F9: Sentence-level deduplication across all 3 background searches
  const { deduplicatedContent, corroborationCount } = deduplicateNewsContent([
    { label: "MACRO & GEOPOLITICS (last 30 days)", content: macro.content ?? "" },
    { label: "COMPANY-SPECIFIC NEWS (last 30 days)", content: company.content ?? "" },
    { label: "SECTOR & REGULATORY (last 30 days)", content: sector.content ?? "" },
  ]);

  if (corroborationCount > 0) {
    console.log(`[news-fetcher] F9: ${corroborationCount} corroborated sentences annotated across searches`);
  }

  const combinedSummary = deduplicatedContent.filter(s => !s.startsWith("=== MACRO") || macro.content)
    .join("\n\n");

  const allRawSources = [
    ...macro.sources,
    ...company.sources,
    ...sector.sources,
    ...breaking.sources,
  ];
  const allSources = deduplicateSources(allRawSources);

  // If primary fetch failed entirely, use Yahoo fallback
  if (!combinedSummary.trim() && !breaking24hText) {
    console.log("[news-fetcher] Primary fetch returned empty. Using Yahoo Finance fallback.");
    const fallback = await fetchYahooFinanceFallback(tickers);
    return {
      evidence: [
        {
          content: fallback.summary,
          sources: fallback.sources,
          evidenceType: "secondary",
          category: "macro",
        },
      ],
      combinedSummary: fallback.summary,
      allSources: fallback.sources,
      usingFallback: true,
      breaking24h: "",
    };
  }

  return { evidence, combinedSummary, allSources, usingFallback: false, breaking24h: breaking24hText };
}
