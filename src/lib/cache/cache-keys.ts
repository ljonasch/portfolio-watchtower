import type { BundleScope } from "@/lib/contracts";

export type CacheDomain =
  | "price_snapshot_cache"
  | "valuation_snapshot_cache"
  | "news_search_cache"
  | "article_body_cache"
  | "sentiment_extraction_cache"
  | "market_context_cache"
  | "conviction_normalization_cache"
  | "holdings_normalization_cache"
  | "evidence_packet_cache_metadata"
  | "legacy_backfill_readiness_state";

export interface UserDerivedCacheScope {
  userId: string;
  bundleScope: BundleScope;
  profileHash: string;
  convictionHash: string;
}

export interface SnapshotCacheScope {
  userId: string;
  portfolioSnapshotId: string;
  portfolioSnapshotHash: string;
  bundleScope: BundleScope;
}

export interface FrozenRunCacheScope {
  runId: string;
  userId: string;
  bundleScope: BundleScope;
  portfolioSnapshotId: string;
  portfolioSnapshotHash: string;
  profileHash: string;
  convictionHash: string;
  evidenceHash: string;
}

export interface PriceSnapshotCacheKeyInput {
  ticker: string;
  marketDate: string;
  providerVersion: string;
}

export interface NewsSearchCacheKeyInput {
  ticker: string;
  lookbackWindow: string;
  fetcherVersion: string;
}

export interface ValuationSnapshotCacheKeyInput {
  ticker: string;
  marketDate: string;
  providerVersion: string;
}

export interface ArticleBodyCacheKeyInput {
  articleUrlHash: string;
  articleChecksum: string;
  fetcherVersion: string;
}

export interface SentimentExtractionCacheKeyInput {
  articleChecksum: string;
  extractionPromptVersion: string;
  model: string;
}

export interface MarketContextCacheKeyInput {
  marketDate: string;
  sourceVersion: string;
}

export interface LegacyBackfillReadinessCacheKeyInput {
  legacyArtifactId: string;
  userId: string;
  bundleScope: BundleScope;
  readinessVersion: string;
}

function joinKey(parts: Array<string>): string {
  return parts.map((part) => part.trim()).join("::");
}

export function buildPriceSnapshotCacheKey(input: PriceSnapshotCacheKeyInput): string {
  return joinKey([
    "price_snapshot_cache",
    input.ticker.toUpperCase(),
    input.marketDate,
    input.providerVersion,
  ]);
}

export function buildNewsSearchCacheKey(input: NewsSearchCacheKeyInput): string {
  return joinKey([
    "news_search_cache",
    input.ticker.toUpperCase(),
    input.lookbackWindow,
    input.fetcherVersion,
  ]);
}

export function buildValuationSnapshotCacheKey(input: ValuationSnapshotCacheKeyInput): string {
  return joinKey([
    "valuation_snapshot_cache",
    input.ticker.toUpperCase(),
    input.marketDate,
    input.providerVersion,
  ]);
}

export function buildArticleBodyCacheKey(input: ArticleBodyCacheKeyInput): string {
  return joinKey([
    "article_body_cache",
    input.articleUrlHash,
    input.articleChecksum,
    input.fetcherVersion,
  ]);
}

export function buildSentimentExtractionCacheKey(input: SentimentExtractionCacheKeyInput): string {
  return joinKey([
    "sentiment_extraction_cache",
    input.articleChecksum,
    input.extractionPromptVersion,
    input.model,
  ]);
}

export function buildMarketContextCacheKey(input: MarketContextCacheKeyInput): string {
  return joinKey([
    "market_context_cache",
    input.marketDate,
    input.sourceVersion,
  ]);
}

export function buildConvictionNormalizationCacheKey(scope: UserDerivedCacheScope, parserVersion: string): string {
  return joinKey([
    "conviction_normalization_cache",
    scope.userId,
    scope.bundleScope,
    scope.profileHash,
    scope.convictionHash,
    parserVersion,
  ]);
}

export function buildHoldingsNormalizationCacheKey(scope: SnapshotCacheScope, parserVersion: string): string {
  return joinKey([
    "holdings_normalization_cache",
    scope.userId,
    scope.bundleScope,
    scope.portfolioSnapshotId,
    scope.portfolioSnapshotHash,
    parserVersion,
  ]);
}

export function buildEvidencePacketCacheMetadataKey(scope: FrozenRunCacheScope): string {
  return joinKey([
    "evidence_packet_cache_metadata",
    scope.runId,
    scope.userId,
    scope.bundleScope,
    scope.portfolioSnapshotId,
    scope.portfolioSnapshotHash,
    scope.profileHash,
    scope.convictionHash,
    scope.evidenceHash,
  ]);
}

export function buildLegacyBackfillReadinessCacheKey(input: LegacyBackfillReadinessCacheKeyInput): string {
  return joinKey([
    "legacy_backfill_readiness_state",
    input.legacyArtifactId,
    input.userId,
    input.bundleScope,
    input.readinessVersion,
  ]);
}
