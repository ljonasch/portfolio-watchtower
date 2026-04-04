import crypto from "crypto";
import {
  NEWS_SEARCH_FETCHER_VERSION,
  buildNewsSearchCacheKey,
  buildRuntimeVersionTag,
  getOrLoadRuntimeCache,
} from "@/lib/cache";
import type { ProgressEvent } from "./progress-events";
import {
  createStageProviderPressureDiagnostics,
  finalizeStageProviderPressureDiagnostics,
  recordStageProviderBackoff,
  recordStageProviderCall,
} from "./provider-pressure-diagnostics";
import { rankSources } from "./source-ranker";
import type {
  MacroEnvironmentCollectionResult,
  MacroEnvironmentDiagnostics,
  MacroNewsArticle,
  MacroNewsEnvironmentResult,
  MacroQueryFamilyKey,
  NewsAvailabilityStatus,
  NewsDegradedReason,
  NewsFetchIssue,
  Source,
} from "./types";

interface MacroQueryFamily {
  key: MacroQueryFamilyKey;
  label: string;
  retrievalReason: string;
  topicHints: string[];
  query: string;
}

interface MacroSearchAttemptResult {
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason: NewsDegradedReason | null;
  issues: NewsFetchIssue[];
  articles: MacroNewsArticle[];
}

const MACRO_LOOKBACK_DAYS = 7;
const MACRO_ACTIVE_EMPHASIS_HOURS = 72;

export const MACRO_QUERY_FAMILIES: MacroQueryFamily[] = [
  {
    key: "rates_inflation_central_banks",
    label: "Rates / Inflation / Central Banks",
    retrievalReason: "global macro environment",
    topicHints: ["rates", "inflation", "central banks"],
    query: "Search the last 7 days for the biggest market-moving stories about interest rates, inflation, central banks, and policy expectations. Emphasize developments from the last 72 hours when relevant. Cite reputable financial or official sources.",
  },
  {
    key: "recession_labor_growth",
    label: "Recession / Labor / Growth Slowdown",
    retrievalReason: "global macro environment",
    topicHints: ["growth slowdown", "labor", "recession"],
    query: "Search the last 7 days for the biggest market-moving stories about recession risk, labor market changes, growth slowdowns, and macro demand conditions. Emphasize developments from the last 72 hours when relevant. Cite reputable financial or official sources.",
  },
  {
    key: "energy_commodities",
    label: "Energy / Commodities",
    retrievalReason: "global macro environment",
    topicHints: ["energy", "commodities"],
    query: "Search the last 7 days for the biggest market-moving stories about energy markets, commodities, oil, natural gas, and commodity supply/demand shocks. Emphasize developments from the last 72 hours when relevant. Cite reputable financial or official sources.",
  },
  {
    key: "geopolitics_shipping_supply_chain",
    label: "Geopolitics / War / Shipping / Supply Chain",
    retrievalReason: "global macro environment",
    topicHints: ["geopolitics", "shipping", "supply chain"],
    query: "Search the last 7 days for the biggest market-moving stories about geopolitics, war, shipping disruption, supply chain stress, trade routes, and logistics shocks. Emphasize developments from the last 72 hours when relevant. Cite reputable financial or official sources.",
  },
  {
    key: "regulation_export_controls_ai_policy",
    label: "Regulation / Export Controls / AI Policy",
    retrievalReason: "global macro environment",
    topicHints: ["regulation", "export controls", "AI policy"],
    query: "Search the last 7 days for the biggest market-moving stories about regulation, export controls, semiconductor restrictions, AI policy, and government technology oversight. Emphasize developments from the last 72 hours when relevant. Cite reputable financial or official sources.",
  },
  {
    key: "credit_liquidity_banking_stress",
    label: "Credit / Liquidity / Banking Stress",
    retrievalReason: "global macro environment",
    topicHints: ["credit", "liquidity", "banking stress"],
    query: "Search the last 7 days for the biggest market-moving stories about credit stress, liquidity conditions, funding markets, bank stress, and financial-system stability. Emphasize developments from the last 72 hours when relevant. Cite reputable financial or official sources.",
  },
  {
    key: "defense_fiscal_industrial_policy",
    label: "Defense / Fiscal / Industrial Policy",
    retrievalReason: "global macro environment",
    topicHints: ["defense", "fiscal", "industrial policy"],
    query: "Search the last 7 days for the biggest market-moving stories about defense spending, fiscal shifts, industrial policy, reshoring, and manufacturing incentives. Emphasize developments from the last 72 hours when relevant. Cite reputable financial or official sources.",
  },
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTitle(value: string): string {
  return normalizeWhitespace(value.toLowerCase().replace(/[^a-z0-9\s]/g, " "));
}

function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const removableKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "guccounter", "guce_referrer", "guce_referrer_sig"];
    for (const key of removableKeys) {
      parsed.searchParams.delete(key);
    }
    parsed.hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

function stableHash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function extractCauseMessage(cause: unknown): string | null {
  if (!cause) return null;
  if (typeof cause === "string") return cause;
  if (typeof cause === "object" && cause !== null && "message" in cause && typeof (cause as { message?: unknown }).message === "string") {
    return (cause as { message: string }).message;
  }
  return null;
}

function buildIssue(params: {
  kind: NewsFetchIssue["kind"];
  message: string;
  model: string | null;
  attempt: number | null;
  retryPath: string | null;
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
    retryPath: params.retryPath,
  };
}

function logIssue(issue: NewsFetchIssue): void {
  console.warn(
    `[macro-news-environment] ${issue.kind}: ${issue.message} ${JSON.stringify({
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

function buildMacroArticles(
  family: MacroQueryFamily,
  rawSources: Source[]
): MacroNewsArticle[] {
  const rankedSources = rankSources(rawSources);
  return rankedSources.map((source) => {
    const canonicalUrl = canonicalizeUrl(source.url);
    const publisher = source.domain ?? canonicalUrl;
    const normalizedTitle = normalizeTitle(source.title);
    const dedupKey = stableHash(`${canonicalUrl}::${normalizedTitle}::${publisher}::last_7d`);
    const evidenceHash = stableHash(`${family.key}::${canonicalUrl}::${normalizedTitle}`);
    const trusted = source.quality === "high" || source.quality === "medium";
    return {
      articleId: `macro_article:${dedupKey}`,
      canonicalUrl,
      title: source.title,
      publisher,
      publishedAt: null,
      publishedAtBucket: `last_${MACRO_LOOKBACK_DAYS}d`,
      trusted,
      queryFamily: family.key,
      retrievalReason: family.retrievalReason,
      topicHints: [...family.topicHints],
      dedupKey,
      stableSortKey: "",
      evidenceHash,
    };
  });
}

function compareMacroArticles(a: MacroNewsArticle, b: MacroNewsArticle): number {
  if (a.trusted !== b.trusted) {
    return a.trusted ? -1 : 1;
  }

  const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
  const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
  if (aTime !== bTime) {
    return bTime - aTime;
  }

  return a.canonicalUrl.localeCompare(b.canonicalUrl);
}

function assignStableSortKeys(articles: MacroNewsArticle[]): MacroNewsArticle[] {
  return articles.map((article, index) => ({
    ...article,
    stableSortKey: `${article.trusted ? "0" : "1"}:${String(index).padStart(4, "0")}:${article.canonicalUrl}`,
  }));
}

function deriveCollectionStatus(articles: MacroNewsArticle[], issues: NewsFetchIssue[]): {
  availabilityStatus: NewsAvailabilityStatus;
  degradedReason: NewsDegradedReason | null;
  statusSummary: string;
} {
  const hasRateLimit = issues.some((issue) => issue.kind === "primary_rate_limited");
  const hasTransportFailure = issues.some((issue) => issue.kind === "primary_transport_failure");
  const hasEmpty = issues.some((issue) => issue.kind === "primary_empty_result");

  if (articles.length > 0) {
    if (hasRateLimit) {
      return {
        availabilityStatus: "primary_success",
        degradedReason: "primary_rate_limited",
        statusSummary: "Macro-news collection succeeded overall, but one or more fixed global query families were rate-limited during collection.",
      };
    }
    if (hasTransportFailure) {
      return {
        availabilityStatus: "primary_success",
        degradedReason: "primary_transport_failure",
        statusSummary: "Macro-news collection succeeded overall, but one or more fixed global query families hit connection/provider failures during collection.",
      };
    }
    if (hasEmpty) {
      return {
        availabilityStatus: "primary_success",
        degradedReason: "primary_empty_result",
        statusSummary: "Macro-news collection succeeded overall, but one or more fixed global query families returned no usable results.",
      };
    }

    return {
      availabilityStatus: "primary_success",
      degradedReason: null,
      statusSummary: "Macro-news collection succeeded across the fixed global query families for this run.",
    };
  }

  if (hasRateLimit) {
    return {
      availabilityStatus: "primary_rate_limited",
      degradedReason: "primary_rate_limited",
      statusSummary: "Macro-news collection could not capture usable evidence because the fixed global query families were rate-limited.",
    };
  }
  if (hasTransportFailure) {
    return {
      availabilityStatus: "primary_transport_failure",
      degradedReason: "primary_transport_failure",
      statusSummary: "Macro-news collection could not capture usable evidence because the fixed global query families hit connection/provider failures.",
    };
  }
  if (hasEmpty) {
    return {
      availabilityStatus: "primary_empty",
      degradedReason: "primary_empty_result",
      statusSummary: "Macro-news collection ran, but the fixed global query families returned no usable articles for this run.",
    };
  }

  return {
    availabilityStatus: "no_usable_news",
    degradedReason: "no_usable_news",
    statusSummary: "Macro-news collection did not capture any usable evidence for this run.",
  };
}

async function runMacroSearchFamily(
  openai: any,
  family: MacroQueryFamily,
  today: string,
  diagnostics: MacroEnvironmentDiagnostics,
  attempt = 1,
  priorIssues: NewsFetchIssue[] = []
): Promise<MacroSearchAttemptResult> {
  const model = "gpt-5-search-api";
  const prompt = `Today is ${today}. Use only the last ${MACRO_LOOKBACK_DAYS} days of coverage, with extra attention to the last ${MACRO_ACTIVE_EMPHASIS_HOURS} hours.\n\n${family.query}\n\nReturn concise plain text with cited URLs.`;

  try {
    recordStageProviderCall(diagnostics);
    const resp = await openai.chat.completions.create({
      model,
      max_completion_tokens: 700,
      web_search_options: {},
      messages: [{ role: "user", content: prompt }],
    });

    const message = resp.choices?.[0]?.message;
    const annotations: any[] = Array.isArray(message?.annotations) ? message.annotations : [];
    const rawSources: Source[] = annotations
      .filter((annotation) => annotation?.type === "url_citation" && annotation?.url_citation?.url)
      .map((annotation) => ({
        title: annotation.url_citation.title ?? annotation.url_citation.url,
        url: annotation.url_citation.url,
      }));

    if (rawSources.length === 0) {
      const issue = buildIssue({
        kind: "primary_empty_result",
        message: `Macro query family ${family.key} returned no usable cited results.`,
        model,
        attempt,
        retryPath: "none",
      });
      logIssue(issue);
      return {
        availabilityStatus: "primary_empty",
        degradedReason: "primary_empty_result",
        issues: [...priorIssues, issue],
        articles: [],
      };
    }

    return {
      availabilityStatus: "primary_success",
      degradedReason: null,
      issues: priorIssues,
      articles: buildMacroArticles(family, rawSources),
    };
  } catch (error: any) {
    if (error?.status === 429 && attempt < 4) {
      recordStageProviderBackoff(diagnostics, 65);
      const issue = buildIssue({
        kind: "primary_rate_limited",
        message: `Macro query family ${family.key} hit rate limiting on attempt ${attempt}. Retrying after backoff.`,
        model,
        attempt,
        retryPath: "retry_primary",
        error,
      });
      logIssue(issue);
      await new Promise((resolve) => setTimeout(resolve, 65000));
      return runMacroSearchFamily(openai, family, today, diagnostics, attempt + 1, [...priorIssues, issue]);
    }

    const kind: NewsFetchIssue["kind"] = error?.status === 429 ? "primary_rate_limited" : "primary_transport_failure";
    const degradedReason: NewsDegradedReason = kind === "primary_rate_limited" ? "primary_rate_limited" : "primary_transport_failure";
    const issue = buildIssue({
      kind,
      message: `Macro query family ${family.key} failed before returning a usable response.`,
      model,
      attempt,
      retryPath: "none",
      error,
    });
    logIssue(issue);
    return {
      availabilityStatus: kind === "primary_rate_limited" ? "primary_rate_limited" : "primary_transport_failure",
      degradedReason,
      issues: [...priorIssues, issue],
      articles: [],
    };
  }
}

function normalizeMacroArticles(articles: MacroNewsArticle[]): MacroNewsArticle[] {
  const deduped = new Map<string, MacroNewsArticle>();

  for (const article of articles) {
    const existing = deduped.get(article.dedupKey);
    if (!existing) {
      deduped.set(article.dedupKey, article);
      continue;
    }

    const winner = compareMacroArticles(article, existing) < 0 ? article : existing;
    deduped.set(article.dedupKey, winner);
  }

  return assignStableSortKeys([...deduped.values()].sort(compareMacroArticles));
}

export async function collectMacroNewsEnvironment(
  openai: any,
  today: string,
  emit: (event: ProgressEvent) => void
): Promise<MacroNewsEnvironmentResult> {
  const result = await collectMacroNewsEnvironmentDetailed(openai, today, emit);
  return result.macroEnvironment;
}

export async function collectMacroNewsEnvironmentDetailed(
  openai: any,
  today: string,
  emit: (event: ProgressEvent) => void,
  options?: {
    replayContextFingerprint?: string;
    reuseMissReason?: string | null;
  }
): Promise<MacroEnvironmentCollectionResult> {
  emit({
    type: "stage_start",
    stage: "macro_news",
    label: "Macro News Environment",
    detail: "Collecting fixed global macro query families for the last 7 days of market environment evidence",
  });
  const startedAt = Date.now();
  const providerDiagnosticsBase = createStageProviderPressureDiagnostics("fresh");
  const providerDiagnostics: MacroEnvironmentDiagnostics = {
    ...providerDiagnosticsBase,
    replayContextFingerprint: options?.replayContextFingerprint ?? "",
    reuseHit: false,
    reuseMissReason: options?.reuseMissReason ?? null,
    queryFamilyCountAttempted: 0,
    queryFamilyCountWithArticles: 0,
    queryFamilyKeysAttempted: [],
    queryFamilyKeysWithArticles: [],
  };

  const collectedArticles: MacroNewsArticle[] = [];
  const issues: NewsFetchIssue[] = [];
  const queryFamilyKeysWithArticles = new Set<MacroQueryFamilyKey>();

  for (const family of MACRO_QUERY_FAMILIES) {
    emit({
      type: "log",
      message: `Macro query family: ${family.label}`,
      level: "info",
    });
    providerDiagnostics.queryFamilyKeysAttempted.push(family.key);

    const result = await getOrLoadRuntimeCache<MacroSearchAttemptResult>({
      domain: "news_search_cache",
      key: buildNewsSearchCacheKey({
        ticker: family.key,
        lookbackWindow: `macro_env_${MACRO_LOOKBACK_DAYS}d_${MACRO_ACTIVE_EMPHASIS_HOURS}h`,
        fetcherVersion: `${NEWS_SEARCH_FETCHER_VERSION}::macro_env_v1`,
      }),
      versionTag: buildRuntimeVersionTag(["macro_env", "v1"]),
      loader: () => runMacroSearchFamily(openai, family, today, providerDiagnostics),
    });

    collectedArticles.push(...result.articles);
    issues.push(...result.issues);
    if (result.articles.length > 0) {
      queryFamilyKeysWithArticles.add(family.key);
    }
  }

  const articles = normalizeMacroArticles(collectedArticles);
  const trustedArticles = articles.filter((article) => article.trusted);
  const distinctPublisherCount = new Set(articles.map((article) => article.publisher)).size;
  const trustedPublisherCount = new Set(trustedArticles.map((article) => article.publisher)).size;
  const status = deriveCollectionStatus(articles, issues);

  emit({
    type: "stage_complete",
    stage: "macro_news",
    durationMs: Date.now() - startedAt,
  });

  const finalizedProviderDiagnostics = finalizeStageProviderPressureDiagnostics(
    providerDiagnostics,
    Date.now() - startedAt
  ) as MacroEnvironmentDiagnostics;
  finalizedProviderDiagnostics.resultState = finalizedProviderDiagnostics.providerCallCount === 0
    ? "cache_hit"
    : "fresh";
  finalizedProviderDiagnostics.queryFamilyCountAttempted = providerDiagnostics.queryFamilyKeysAttempted.length;
  finalizedProviderDiagnostics.queryFamilyKeysWithArticles = [...queryFamilyKeysWithArticles].sort();
  finalizedProviderDiagnostics.queryFamilyCountWithArticles = finalizedProviderDiagnostics.queryFamilyKeysWithArticles.length;

  return {
    macroEnvironment: {
      availabilityStatus: status.availabilityStatus,
      degradedReason: status.degradedReason,
      statusSummary: status.statusSummary,
      articleCount: articles.length,
      trustedArticleCount: trustedArticles.length,
      distinctPublisherCount,
      sourceDiversity: {
        distinctPublishers: distinctPublisherCount,
        trustedPublishers: trustedPublisherCount,
        trustedRatio: articles.length > 0 ? Number((trustedArticles.length / articles.length).toFixed(2)) : 0,
      },
      issues,
      articles,
    },
    diagnostics: finalizedProviderDiagnostics,
  };
}
