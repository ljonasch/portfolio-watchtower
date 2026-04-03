/**
 * research/news-fetcher.ts
 * Modular, typed news fetching pipeline.
 * Replaces inline fetch logic in analyzer.ts.
 * Returns EvidenceItem[] rather than raw strings.
 */

import type {
  EvidenceItem,
  NewsAvailabilityStatus,
  NewsConfidenceLevel,
  NewsContradictionLevel,
  NewsDegradedReason,
  NewsDirectionalSupport,
  NewsFetchIssue,
  NewsResult,
  NewsSignalSet,
  Source,
  TickerNewsSignal,
} from "./types";
import { deduplicateSources, rankSources, summarizeSourceQuality } from "./source-ranker";
import {
  NEWS_SEARCH_FETCHER_VERSION,
  buildNewsSearchCacheKey,
  buildRuntimeVersionTag,
  getOrLoadRuntimeCache,
} from "@/lib/cache";

interface RawNewsResult {
  summary: string;
  sources: Source[];
}

interface SearchAttemptResult extends RawNewsResult {
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason: NewsDegradedReason | null;
  issues: NewsFetchIssue[];
  modelUsed: string | null;
}

const POSITIVE_NEWS_KEYWORDS = [
  "beats",
  "beat",
  "raises guidance",
  "strong demand",
  "upgrade",
  "approved",
  "partnership",
  "expansion",
  "launch",
  "wins contract",
  "record revenue",
];

const NEGATIVE_NEWS_KEYWORDS = [
  "misses",
  "miss",
  "cuts guidance",
  "downgrade",
  "investigation",
  "lawsuit",
  "recall",
  "delay",
  "warning",
  "fraud",
  "data breach",
];

const CATALYST_KEYWORDS = [
  "earnings",
  "guidance",
  "launch",
  "approval",
  "contract",
  "acquisition",
  "partnership",
  "outlook",
];

const RISK_EVENT_KEYWORDS = [
  "downgrade",
  "investigation",
  "probe",
  "lawsuit",
  "tariff",
  "regulation",
  "sanction",
  "recall",
  "delay",
  "default",
];

function normalizeNewsText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function countKeywordMatches(text: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => count + (text.includes(keyword) ? 1 : 0), 0);
}

function extractCauseMessage(cause: unknown): string | null {
  if (!cause) return null;
  if (typeof cause === "string") return cause;
  if (typeof cause === "object" && cause !== null && "message" in cause && typeof (cause as { message?: unknown }).message === "string") {
    return (cause as { message: string }).message;
  }
  return null;
}

function describeAvailabilityStatus(
  availabilityStatus: NewsAvailabilityStatus,
  degradedReason: NewsDegradedReason | null,
  usingFallback: boolean,
  articleCount: number
): string {
  switch (availabilityStatus) {
    case "primary_success":
      return articleCount > 0
        ? `Primary live-news search succeeded and produced ${articleCount} cited source(s) for this run.`
        : "Primary live-news search succeeded, but only thin source coverage was captured for this run.";
    case "primary_empty":
      return usingFallback
        ? "Primary live-news search returned no usable results, so Yahoo Finance fallback headlines were used."
        : "Primary live-news search returned no usable results for this run.";
    case "primary_transport_failure":
      return usingFallback
        ? "Primary live-news search failed due to a connection/provider error, so Yahoo Finance fallback headlines were used."
        : "Primary live-news search failed due to a connection/provider error and no usable fallback coverage was captured.";
    case "primary_rate_limited":
      return usingFallback
        ? "Primary live-news search was rate-limited, so Yahoo Finance fallback headlines were used."
        : "Primary live-news search was rate-limited and no usable fallback coverage was captured.";
    case "fallback_success":
      if (degradedReason === "primary_rate_limited") {
        return "Primary live-news search was rate-limited, so Yahoo Finance fallback headlines were used for this run.";
      }
      if (degradedReason === "primary_transport_failure") {
        return "Primary live-news search failed due to a connection/provider issue, so Yahoo Finance fallback headlines were used.";
      }
      if (degradedReason === "primary_empty_result") {
        return "Primary live-news search returned no usable results, so Yahoo Finance fallback headlines were used.";
      }
      return "Yahoo Finance fallback headlines were used because primary live-news coverage was unavailable for this run.";
    case "no_usable_news":
    default:
      return "No usable news could be captured from the primary provider or the Yahoo fallback for this run.";
  }
}

function classifyDirectionalSupport(text: string): NewsDirectionalSupport {
  const normalized = normalizeNewsText(text);
  if (!normalized) return "insufficient";

  const positiveMatches = countKeywordMatches(normalized, POSITIVE_NEWS_KEYWORDS);
  const negativeMatches = countKeywordMatches(normalized, NEGATIVE_NEWS_KEYWORDS);

  if (positiveMatches === 0 && negativeMatches === 0) return "neutral";
  if (positiveMatches > 0 && negativeMatches > 0) return "mixed";
  return positiveMatches > negativeMatches ? "positive" : "negative";
}

function classifyContradictionLevel(text: string): NewsContradictionLevel {
  const normalized = normalizeNewsText(text);
  const positiveMatches = countKeywordMatches(normalized, POSITIVE_NEWS_KEYWORDS);
  const negativeMatches = countKeywordMatches(normalized, NEGATIVE_NEWS_KEYWORDS);

  if (positiveMatches > 0 && negativeMatches > 0) return "high";
  if (positiveMatches > 0 || negativeMatches > 0) return "medium";
  return "low";
}

function detectTickerText(text: string, ticker: string): string {
  return text
    .split("\n")
    .filter((line) => line.toUpperCase().includes(ticker.toUpperCase()))
    .join("\n");
}

function classifyNewsConfidence(
  availabilityStatus: NewsAvailabilityStatus,
  articleCount: number,
  sourceDiversityCount: number,
  contradictionLevel: NewsContradictionLevel
): NewsConfidenceLevel {
  if (availabilityStatus === "no_usable_news" || availabilityStatus === "primary_transport_failure" || availabilityStatus === "primary_rate_limited") {
    return "low";
  }
  if (availabilityStatus === "fallback_success" || availabilityStatus === "primary_empty") {
    return articleCount >= 3 && sourceDiversityCount >= 2 && contradictionLevel !== "high" ? "medium" : "low";
  }
  if (articleCount >= 4 && sourceDiversityCount >= 2 && contradictionLevel === "low") {
    return "high";
  }
  if (articleCount >= 2) {
    return "medium";
  }
  return "low";
}

function buildTickerSignal(params: {
  ticker: string;
  fullText: string;
  sources: Source[];
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason: NewsDegradedReason | null;
}): TickerNewsSignal {
  const tickerText = detectTickerText(params.fullText, params.ticker);
  const normalizedTickerText = normalizeNewsText(tickerText);
  const directionalSupport = classifyDirectionalSupport(normalizedTickerText);
  const contradictionLevel = classifyContradictionLevel(normalizedTickerText);
  const articleCount = tickerText ? tickerText.split("\n").filter(Boolean).length : 0;
  const sourceSubset = params.sources.filter((source) => {
    const haystack = `${source.title} ${source.url}`.toUpperCase();
    return haystack.includes(params.ticker.toUpperCase());
  });
  const rankedSubset = rankSources(sourceSubset);
  const sourceDiversityCount = new Set(rankedSubset.map((source) => source.domain ?? source.url)).size;
  const trustedSourceCount = rankedSubset.filter((source) => source.quality === "high" || source.quality === "medium").length;
  const recent24hCount = tickerText
    .split("\n")
    .filter((line) => /\[.*\]/.test(line) || line.toLowerCase().includes("breaking"))
    .length;
  const recent7dCount = articleCount;
  const catalystPresence = countKeywordMatches(normalizedTickerText, CATALYST_KEYWORDS) > 0;
  const riskEventPresence = countKeywordMatches(normalizedTickerText, RISK_EVENT_KEYWORDS) > 0;
  const newsConfidence = classifyNewsConfidence(
    params.availabilityStatus,
    articleCount,
    sourceDiversityCount,
    contradictionLevel
  );

  const explanatoryNote = articleCount === 0
    ? describeAvailabilityStatus(params.availabilityStatus, params.degradedReason, params.availabilityStatus === "fallback_success", 0)
    : `${articleCount} ticker-specific news mention(s) were captured with ${directionalSupport} directional support and ${newsConfidence} news confidence.`;

  return {
    ticker: params.ticker,
    availabilityStatus: params.availabilityStatus,
    degradedReason: params.degradedReason,
    articleCount,
    trustedSourceCount,
    sourceDiversityCount,
    recent24hCount,
    recent7dCount,
    directionalSupport,
    catalystPresence,
    riskEventPresence,
    contradictionLevel,
    newsConfidence,
    explanatoryNote,
  };
}

export function buildNewsSignalSet(params: {
  tickers: string[];
  combinedSummary: string;
  breaking24h: string;
  sources: Source[];
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason: NewsDegradedReason | null;
  issues: NewsFetchIssue[];
  usingFallback: boolean;
}): NewsSignalSet {
  const rankedSources = rankSources(params.sources);
  const sourceQuality = summarizeSourceQuality(rankedSources);
  const fullText = `${params.breaking24h ?? ""}\n${params.combinedSummary ?? ""}`.trim();
  const directionalSupport = classifyDirectionalSupport(fullText);
  const contradictionLevel = classifyContradictionLevel(fullText);
  const articleCount = rankedSources.length;
  const sourceDiversityCount = new Set(rankedSources.map((source) => source.domain ?? source.url)).size;
  const recent24hCount = params.breaking24h
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.toLowerCase().startsWith("no breaking news"))
    .length;
  const recent7dCount = articleCount;
  const catalystPresence = countKeywordMatches(normalizeNewsText(fullText), CATALYST_KEYWORDS) > 0;
  const riskEventPresence = countKeywordMatches(normalizeNewsText(fullText), RISK_EVENT_KEYWORDS) > 0;
  const confidence = classifyNewsConfidence(
    params.availabilityStatus,
    articleCount,
    sourceDiversityCount,
    contradictionLevel
  );

  const sortedTickers = [...new Set(params.tickers.map((ticker) => ticker.toUpperCase()))].sort();
  const tickerSignals = sortedTickers.reduce<Record<string, TickerNewsSignal>>((acc, ticker) => {
    acc[ticker] = buildTickerSignal({
      ticker,
      fullText,
      sources: rankedSources,
      availabilityStatus: params.availabilityStatus,
      degradedReason: params.degradedReason,
    });
    return acc;
  }, {});

  return {
    availabilityStatus: params.availabilityStatus,
    degradedReason: params.degradedReason,
    articleCount,
    trustedSourceCount: sourceQuality.high + sourceQuality.medium,
    sourceDiversityCount,
    recent24hCount,
    recent7dCount,
    directionalSupport,
    contradictionLevel,
    catalystPresence,
    riskEventPresence,
    confidence,
    statusSummary: describeAvailabilityStatus(
      params.availabilityStatus,
      params.degradedReason,
      params.usingFallback,
      articleCount
    ),
    tickerSignals,
    issues: params.issues,
  };
}

function logStructuredNewsIssue(issue: NewsFetchIssue): void {
  console.warn(
    `[news-fetcher] ${issue.kind}: ${issue.message} ${JSON.stringify({
      model: issue.model,
      attempt: issue.attempt,
      status: issue.status,
      code: issue.code,
      type: issue.type,
      cause: issue.cause,
      retryPath: issue.retryPath,
    })}`
  );
}

function buildNewsFetchIssue(params: {
  kind: NewsFetchIssue["kind"];
  model: string | null;
  attempt: number | null;
  message: string;
  retryPath?: string | null;
  error?: any;
}): NewsFetchIssue {
  return {
    kind: params.kind,
    model: params.model,
    attempt: params.attempt,
    message: params.message,
    name: params.error?.name ?? null,
    status: typeof params.error?.status === "number" ? params.error.status : null,
    code: typeof params.error?.code === "string" ? params.error.code : null,
    type: typeof params.error?.type === "string" ? params.error.type : null,
    cause: extractCauseMessage(params.error?.cause),
    retryPath: params.retryPath ?? null,
  };
}

export function buildEmptyNewsResult(params: {
  tickers: string[];
  availabilityStatus?: NewsAvailabilityStatus;
  degradedReason?: NewsDegradedReason | null;
  message?: string;
  issues?: NewsFetchIssue[];
}): NewsResult {
  const availabilityStatus = params.availabilityStatus ?? "no_usable_news";
  const degradedReason = params.degradedReason ?? "no_usable_news";
  const issues = params.issues ?? [
    buildNewsFetchIssue({
      kind: "no_usable_news",
      model: null,
      attempt: null,
      message: params.message ?? "No usable news was available for this run.",
      retryPath: "none",
    }),
  ];

  return {
    evidence: [],
    combinedSummary: "",
    allSources: [],
    usingFallback: false,
    breaking24h: "",
    availabilityStatus,
    degradedReason,
    statusSummary: describeAvailabilityStatus(availabilityStatus, degradedReason, false, 0),
    issues,
    signals: buildNewsSignalSet({
      tickers: params.tickers,
      combinedSummary: "",
      breaking24h: "",
      sources: [],
      availabilityStatus,
      degradedReason,
      issues,
      usingFallback: false,
    }),
    fetchedAt: new Date().toISOString(),
  };
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
          const fallback = await getOrLoadRuntimeCache<RawNewsResult>({
            domain: "news_search_cache",
            key: buildNewsSearchCacheKey({
              ticker,
              lookbackWindow: "yahoo_fallback_3",
              fetcherVersion: NEWS_SEARCH_FETCHER_VERSION,
            }),
            versionTag: buildRuntimeVersionTag(["yahoo_fallback", NEWS_SEARCH_FETCHER_VERSION]),
            loader: async () => {
              const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${ticker}&newsCount=3`;
              const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
              if (!res.ok) return { summary: "", sources: [] };
              const json: any = await res.json();
              const news = json?.news ?? [];
              const titles: string[] = [];
              const fetchedSources: Source[] = [];
              for (const item of news) {
                if (item?.title && item?.link) {
                  titles.push(`- [${ticker}] ${item.title}`);
                  fetchedSources.push({ title: item.title, url: item.link, quality: "medium" });
                }
              }
              return {
                summary: titles.length > 0 ? `Recent headlines (Yahoo Finance fallback):\n${titles.join("\n")}` : "",
                sources: fetchedSources,
              };
            },
          });

          if (!fallback.summary) return;
          allTitles.push(...fallback.summary.split("\n").slice(1));
          sources.push(...fallback.sources);
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
  attempt = 1,
  priorIssues: NewsFetchIssue[] = []
): Promise<SearchAttemptResult> {
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
      if (!textContent.trim() && rankedSources.length === 0) {
        const emptyIssue = buildNewsFetchIssue({
          kind: "primary_empty_result",
          model,
          attempt,
          message: "Primary live-news search returned no usable content for this batch.",
          retryPath: "yahoo_fallback",
        });
        logStructuredNewsIssue(emptyIssue);
        return {
          summary: "",
          sources: [],
          availabilityStatus: "primary_empty",
          degradedReason: "primary_empty_result",
          issues: [...priorIssues, emptyIssue],
          modelUsed: model,
        };
      }

      return {
        summary: textContent,
        sources: rankedSources,
        availabilityStatus: "primary_success",
        degradedReason: null,
        issues: priorIssues,
        modelUsed: model,
      };
    } catch (err: any) {
      if (err?.status === 429 && attempt < 8) {
        const rateLimitIssue = buildNewsFetchIssue({
          kind: "primary_rate_limited",
          model,
          attempt,
          message: `Rate limit (429) hit for model ${model}. Waiting 65 seconds before retrying.`,
          retryPath: "retry_primary",
          error: err,
        });
        logStructuredNewsIssue(rateLimitIssue);
        await new Promise(r => setTimeout(r, 65000));
        return openaiSearchCall(openai, prompt, attempt + 1, [...priorIssues, rateLimitIssue]);
      }
      const isDeprecated = err?.status === 404 || err?.message?.includes("deprecated") || err?.message?.includes("not found");
      if (isDeprecated && model !== SEARCH_MODELS[SEARCH_MODELS.length - 1]) {
        const deprecationIssue = buildNewsFetchIssue({
          kind: "primary_transport_failure",
          model,
          attempt,
          message: `Primary search model ${model} was unavailable; trying fallback model.`,
          retryPath: "fallback_model",
          error: err,
        });
        logStructuredNewsIssue(deprecationIssue);
        priorIssues = [...priorIssues, deprecationIssue];
        continue; // try next model
      }
      const kind: NewsFetchIssue["kind"] = err?.status === 429 ? "primary_rate_limited" : "primary_transport_failure";
      const issue = buildNewsFetchIssue({
        kind,
        model,
        attempt,
        message: err?.message ?? "Primary live-news search failed before returning a usable response.",
        retryPath: "yahoo_fallback",
        error: err,
      });
      logStructuredNewsIssue(issue);
      return {
        summary: "",
        sources: [],
        availabilityStatus: kind === "primary_rate_limited" ? "primary_rate_limited" : "primary_transport_failure",
        degradedReason: kind === "primary_rate_limited" ? "primary_rate_limited" : "primary_transport_failure",
        issues: [...priorIssues, issue],
        modelUsed: model,
      };
    }
  }
  const finalIssue = buildNewsFetchIssue({
    kind: "primary_transport_failure",
    model: null,
    attempt,
    message: "Primary live-news search exhausted all configured models without producing a usable result.",
    retryPath: "yahoo_fallback",
  });
  logStructuredNewsIssue(finalIssue);
  return {
    summary: "",
    sources: [],
    availabilityStatus: "primary_transport_failure",
    degradedReason: "primary_transport_failure",
    issues: [...priorIssues, finalIssue],
    modelUsed: null,
  };
}

// ─── Single unified news search ───────────────────────────────────────────────

export async function fetchAllNewsWithFallback(
  openai: any,
  tickers: string[],
  today: string,
  onProgress?: (step: number, customMessage?: string) => void
): Promise<NewsResult> {
  const nonCash = tickers.filter((t) => t !== "CASH");
  if (nonCash.length === 0) {
    return buildEmptyNewsResult({
      tickers,
      availabilityStatus: "no_usable_news",
      degradedReason: "no_usable_news",
      message: "No non-cash tickers were available for news collection.",
    });
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
  let availabilityStatus: NewsAvailabilityStatus = "primary_success";
  let degradedReason: NewsDegradedReason | null = null;
  let issues: NewsFetchIssue[] = [];

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

    const result = await getOrLoadRuntimeCache<SearchAttemptResult>({
      domain: "news_search_cache",
      key: buildNewsSearchCacheKey({
        ticker: chunkTickers,
        lookbackWindow: i === 0 ? "primary_unified_30d_and_24h" : "primary_unified_followup_30d",
        fetcherVersion: NEWS_SEARCH_FETCHER_VERSION,
      }),
      versionTag: buildRuntimeVersionTag(["openai_search", NEWS_SEARCH_FETCHER_VERSION]),
      loader: () => openaiSearchCall(openai, prompt),
    });

    issues.push(...(result.issues ?? []));
    if (result.availabilityStatus !== "primary_success") {
      availabilityStatus = result.availabilityStatus;
      degradedReason = result.degradedReason ?? degradedReason;
    }
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
    const fallbackTriggerIssue = issues.find((issue) =>
      issue.kind === "primary_transport_failure" || issue.kind === "primary_rate_limited" || issue.kind === "primary_empty_result"
    );
    const fallback = await fetchYahooFinanceFallback(tickers);
    const fallbackSucceeded = Boolean(fallback.summary.trim() || fallback.sources.length > 0);

    if (fallbackSucceeded) {
      const fallbackIssue = buildNewsFetchIssue({
        kind: "fallback_used",
        model: fallbackTriggerIssue?.model ?? null,
        attempt: fallbackTriggerIssue?.attempt ?? null,
        message: "Yahoo Finance fallback headlines supplied usable coverage for this run.",
        retryPath: "yahoo_fallback",
      });
      logStructuredNewsIssue(fallbackIssue);
      const combinedIssues = [...issues, fallbackIssue];
      const fallbackAvailability: NewsAvailabilityStatus = "fallback_success";
      const fallbackReason = degradedReason ?? "fallback_used";
      const signals = buildNewsSignalSet({
        tickers,
        combinedSummary: fallback.summary,
        breaking24h: "",
        sources: fallback.sources,
        availabilityStatus: fallbackAvailability,
        degradedReason: fallbackReason,
        issues: combinedIssues,
        usingFallback: true,
      });

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
        availabilityStatus: fallbackAvailability,
        degradedReason: fallbackReason,
        statusSummary: signals.statusSummary,
        issues: combinedIssues,
        signals,
        fetchedAt: new Date().toISOString(),
      };
    }

    const noUsableNewsIssue = buildNewsFetchIssue({
      kind: "no_usable_news",
      model: fallbackTriggerIssue?.model ?? null,
      attempt: fallbackTriggerIssue?.attempt ?? null,
      message: "Neither the primary provider nor Yahoo Finance fallback produced usable news for this run.",
      retryPath: "none",
    });
    logStructuredNewsIssue(noUsableNewsIssue);
    return buildEmptyNewsResult({
      tickers,
      availabilityStatus: "no_usable_news",
      degradedReason: degradedReason ?? "no_usable_news",
      issues: [...issues, noUsableNewsIssue],
    });
  }

  const signals = buildNewsSignalSet({
    tickers,
    combinedSummary: fullCombinedText.trim(),
    breaking24h: fullBreakingText.trim(),
    sources: allSources,
    availabilityStatus,
    degradedReason,
    issues,
    usingFallback: false,
  });

  return {
    evidence: [evidenceItem],
    combinedSummary: fullCombinedText.trim(),
    allSources,
    usingFallback: false,
    breaking24h: fullBreakingText.trim(),
    availabilityStatus,
    degradedReason,
    statusSummary: signals.statusSummary,
    issues,
    signals,
    fetchedAt: new Date().toISOString(),
  };
}
