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
  prompt: string,
  attempt = 1
): Promise<RawNewsResult> {
  for (const model of SEARCH_MODELS) {
    try {
      const payload: any = {
        model,
        max_completion_tokens: 1000,
        web_search_options: {},
        messages: [{ role: "user", content: prompt }],
      };

      if (!model.includes("gpt-5")) {
        payload.temperature = 0;
      }

      const resp = await (openai.chat.completions.create as Function)(payload);

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
      if (err?.status === 429 && attempt < 8) {
        console.warn(`[news-fetcher] Rate limit (429) hit for model ${model}. Waiting 65s for bucket to refill...`);
        await new Promise(r => setTimeout(r, 65000));
        return openaiSearchCall(openai, prompt, attempt + 1);
      }
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

// ─── Single unified news search ───────────────────────────────────────────────

export async function fetchAllNewsWithFallback(
  openai: any,
  tickers: string[],
  today: string,
  onProgress?: (step: number, customMessage?: string) => void
): Promise<{
  evidence: EvidenceItem[];
  combinedSummary: string;
  allSources: Source[];
  usingFallback: boolean;
  breaking24h: string;
}> {
  const nonCash = tickers.filter((t) => t !== "CASH");
  if (nonCash.length === 0) {
    return { evidence: [], combinedSummary: "", allSources: [], usingFallback: false, breaking24h: "" };
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const chunkSize = 4;
  const chunks = [];
  for (let i = 0; i < nonCash.length; i += chunkSize) {
    chunks.push(nonCash.slice(i, i + chunkSize));
  }

  let fullCombinedText = "";
  let fullBreakingText = "";
  let allSourcesRef: Source[] = [];
  let isFallback = false;

  onProgress?.(0, `Fetching unified news across ${chunks.length} batches...`);

  for (let i = 0; i < chunks.length; i++) {
    const chunkTickers = chunks[i].join(", ");

    let prompt = "";
    if (i === 0) {
      prompt = `Today is ${today}. Perform a comprehensive, unified search for these holdings: ${chunkTickers}.
  
You MUST search for and group your response exactly into these four sections:
=== BREAKING 24H NEWS ===
Search ONLY for material events from the last 24h (since ${yesterday}). State the event, the ticker it impacts, and cite the source. If none, explicitly state "No breaking news".

=== MACRO & GEOPOLITICS ===
Search for recent broad economic data (CPI, Fed rates, tariffs) from the last 30 days impacting these specific holdings.

=== SECTOR & REGULATORY ===
Search for policy, AI regulations, FDA approvals, or defense spending impacting these specific holdings' industries.

=== COMPANY-SPECIFIC ===
Search for specific news (earnings, product launches, downgrades) for EACH individual ticker. Seek consensus among multiple sources for strong claims.

Cite unique, real article URLs from reputable outlets (Reuters, Bloomberg, WSJ) for every claim.`;
    } else {
      prompt = `Today is ${today}. Perform a deep, specific search for these holdings: ${chunkTickers}.
  
You MUST search for and group your response exactly into these two sections:

=== SECTOR & REGULATORY ===
Search for policy, AI regulations, FDA approvals, or defense spending impacting these specific holdings' industries.

=== COMPANY-SPECIFIC ===
Search for specific news (earnings, product launches, downgrades) for EACH individual ticker. Seek consensus among multiple sources for strong claims.

Cite unique, real article URLs from reputable outlets (Reuters, Bloomberg, WSJ) for every claim.`;
    }

    const result = await openaiSearchCall(openai, prompt);
    let breakingChunk = "";
    let combinedChunk = result.summary;

    if (i === 0) {
      const blocks = result.summary.split("=== MACRO & GEOPOLITICS ===");
      if (blocks.length > 1) {
        breakingChunk = blocks[0].replace("=== BREAKING 24H NEWS ===", "").trim();
        combinedChunk = "=== MACRO & GEOPOLITICS ===" + blocks[1];
      }
    }

    fullBreakingText += (breakingChunk ? breakingChunk + "\n" : "");
    fullCombinedText += "\n" + combinedChunk;
    allSourcesRef.push(...result.sources);
    
    // Pause briefly to respect concurrency pacing
    if (i < chunks.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const allSources = deduplicateSources(allSourcesRef);

  const evidenceItem: EvidenceItem = {
    content: fullCombinedText,
    sources: allSources,
    evidenceType: "primary",
    category: "company"
  };

  // If primary fetch failed entirely, use Yahoo fallback
  if (!fullCombinedText.trim() && !fullBreakingText) {
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

  return { evidence: [evidenceItem], combinedSummary: fullCombinedText.trim(), allSources, usingFallback: false, breaking24h: fullBreakingText.trim() };
}
