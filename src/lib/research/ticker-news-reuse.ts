import { createHash } from "crypto";

import type {
  NewsResult,
  Source,
  TickerNewsArtifact,
} from "./types";
import { rankSources } from "./source-ranker";

export const TICKER_NEWS_REUSE_MAX_AGE_HOURS = 6;
export const TICKER_NEWS_QUERY_MODE = "chunked_unified_primary_search_with_yahoo_fallback_v1";
export const TICKER_NEWS_SELECTION_CONTRACT = "stable_quality_rank_then_url_dedup_v1";

export interface TickerNewsReuseDescriptor {
  materialTickerSet: string[];
  queryMode: string;
  selectionContract: string;
  requestFingerprint: string;
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeSourceLike(source: unknown): Source {
  const value = source && typeof source === "object" ? source as Record<string, unknown> : {};
  return {
    title: String(value.title ?? value.source ?? "Untitled source"),
    url: String(value.url ?? ""),
    quality: typeof value.quality === "string" ? value.quality as Source["quality"] : undefined,
    domain: typeof value.domain === "string" ? value.domain : undefined,
  };
}

function compareNormalizedSources(a: Source, b: Source): number {
  const qualityOrder = new Map([
    ["high", 0],
    ["medium", 1],
    ["low", 2],
    ["unknown", 3],
  ]);
  const aRank = qualityOrder.get(a.quality ?? "unknown") ?? 3;
  const bRank = qualityOrder.get(b.quality ?? "unknown") ?? 3;
  if (aRank !== bRank) return aRank - bRank;

  return [
    a.domain ?? "",
    a.url ?? "",
    a.title ?? "",
  ].join("\u0000").localeCompare([
    b.domain ?? "",
    b.url ?? "",
    b.title ?? "",
  ].join("\u0000"));
}

export function normalizeMaterialTickerSet(tickers: string[]): string[] {
  return [...new Set(
    tickers
      .map((ticker) => String(ticker ?? "").trim().toUpperCase())
      .filter((ticker) => ticker.length > 0 && ticker !== "CASH")
  )].sort();
}

export function buildTickerNewsReuseDescriptor(input: {
  tickers: string[];
  queryMode?: string;
  selectionContract?: string;
}): TickerNewsReuseDescriptor {
  const materialTickerSet = normalizeMaterialTickerSet(input.tickers);
  const queryMode = input.queryMode ?? TICKER_NEWS_QUERY_MODE;
  const selectionContract = input.selectionContract ?? TICKER_NEWS_SELECTION_CONTRACT;
  const requestFingerprint = stableHash(JSON.stringify({
    materialTickerSet,
    queryMode,
    selectionContract,
  }));

  return {
    materialTickerSet,
    queryMode,
    selectionContract,
    requestFingerprint,
  };
}

export function normalizeTickerNewsSources(input: unknown[]): Source[] {
  const ranked = rankSources(input.map(normalizeSourceLike).filter((source) => source.url.length > 0));
  const stableSorted = [...ranked].sort(compareNormalizedSources);
  const deduped: Source[] = [];
  const seenUrls = new Set<string>();

  for (const source of stableSorted) {
    if (seenUrls.has(source.url)) continue;
    seenUrls.add(source.url);
    deduped.push(source);
  }

  return deduped;
}

export function buildTickerNewsArticleSetFingerprint(newsResult: NewsResult): string | null {
  const normalizedSources = normalizeTickerNewsSources(Array.isArray(newsResult.allSources) ? newsResult.allSources : []);
  if (normalizedSources.length === 0) return null;

  return stableHash(JSON.stringify(
    normalizedSources.map((source) => ({
      title: source.title,
      url: source.url,
      quality: source.quality ?? "unknown",
      domain: source.domain ?? "",
    }))
  ));
}

export function buildFrozenTickerNewsArtifact(input: {
  descriptor: TickerNewsReuseDescriptor;
  newsResult: NewsResult;
}): TickerNewsArtifact {
  return {
    schemaVersion: "ticker_news_v1",
    requestFingerprint: input.descriptor.requestFingerprint,
    materialTickerSet: input.descriptor.materialTickerSet,
    queryMode: input.descriptor.queryMode,
    selectionContract: input.descriptor.selectionContract,
    articleSetFingerprint: buildTickerNewsArticleSetFingerprint(input.newsResult),
    newsResult: input.newsResult,
  };
}

export function extractTickerNewsArtifactFromEvidencePacket(
  evidencePacket: unknown
): TickerNewsArtifact | null {
  if (!evidencePacket || typeof evidencePacket !== "object" || Array.isArray(evidencePacket)) {
    return null;
  }

  const tickerNews = (evidencePacket as Record<string, unknown>).tickerNews;
  if (!tickerNews || typeof tickerNews !== "object" || Array.isArray(tickerNews)) {
    return null;
  }

  const artifact = tickerNews as Partial<TickerNewsArtifact>;
  if (
    artifact.schemaVersion !== "ticker_news_v1"
    || typeof artifact.requestFingerprint !== "string"
    || !Array.isArray(artifact.materialTickerSet)
    || typeof artifact.queryMode !== "string"
    || typeof artifact.selectionContract !== "string"
    || !artifact.newsResult
    || typeof artifact.newsResult !== "object"
    || Array.isArray(artifact.newsResult)
  ) {
    return null;
  }

  return artifact as TickerNewsArtifact;
}

export function isTickerNewsArtifactFresh(
  finalizedAt: Date | string,
  nowMs = Date.now(),
  maxAgeHours = TICKER_NEWS_REUSE_MAX_AGE_HOURS
): boolean {
  const finalizedDate = finalizedAt instanceof Date ? finalizedAt : new Date(finalizedAt);
  const ageHours = (nowMs - finalizedDate.getTime()) / (1000 * 60 * 60);
  return Number.isFinite(ageHours) && ageHours <= maxAgeHours;
}
