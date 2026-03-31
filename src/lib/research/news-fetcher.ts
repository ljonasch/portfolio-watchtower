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

// ─── OpenAI web search helper ─────────────────────────────────────────────────

async function openaiSearchCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openai: any,
  prompt: string
): Promise<RawNewsResult> {
  try {
    const resp = await (openai.chat.completions.create as Function)({
      model: "gpt-4o-search-preview",
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

    // Rank immediately after retrieval
    const rankedSources = rankSources(rawSources);

    return { summary: textContent, sources: rankedSources };
  } catch (err: any) {
    console.warn("[news-fetcher] Search call failed:", err?.message);
    return { summary: "", sources: [] };
  }
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
}> {
  const nonCash = tickers.filter((t) => t !== "CASH");
  if (nonCash.length === 0) {
    return { evidence: [], combinedSummary: "", allSources: [], usingFallback: false };
  }

  // Fire all 3 searches in parallel with a 45s timeout
  const [macro, company, sector] = await Promise.all([
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
  ]);

  const evidence = [macro, company, sector];
  const combinedSummary = [
    macro.content ? `=== MACRO & GEOPOLITICS ===\n${macro.content}` : "",
    company.content ? `=== COMPANY-SPECIFIC NEWS ===\n${company.content}` : "",
    sector.content ? `=== SECTOR & REGULATORY ===\n${sector.content}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const allRawSources = [...macro.sources, ...company.sources, ...sector.sources];
  const allSources = deduplicateSources(allRawSources);

  // If primary fetch failed entirely, use Yahoo fallback
  if (!combinedSummary.trim()) {
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
    };
  }

  return { evidence, combinedSummary, allSources, usingFallback: false };
}
