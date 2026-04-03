import type { BundleScope } from "@/lib/contracts";
import type {
  CacheDomain,
  FrozenRunCacheScope,
  SnapshotCacheScope,
  UserDerivedCacheScope,
} from "./cache-keys";

export type CacheInvalidationTrigger =
  | { type: "new_trading_day"; marketDate: string }
  | { type: "provider_version_changed"; domain: "price_snapshot_cache"; providerVersion: string }
  | { type: "checksum_mismatch"; domain: "price_snapshot_cache" | "article_body_cache"; checksum: string }
  | { type: "news_ttl_expired"; lookbackWindow: string }
  | { type: "fetcher_version_changed"; domain: "news_search_cache" | "article_body_cache"; fetcherVersion: string }
  | { type: "article_body_changed"; articleChecksum: string }
  | { type: "prompt_version_changed"; extractionPromptVersion: string }
  | { type: "model_changed"; model: string }
  | { type: "new_market_session"; marketDate: string }
  | { type: "conviction_edited"; scope: UserDerivedCacheScope; parserVersion: string }
  | { type: "snapshot_replaced"; scope: SnapshotCacheScope; parserVersion: string }
  | { type: "backfill_readiness_version_changed"; bundleScope: BundleScope; readinessVersion: string };

export interface CacheInvalidationTarget {
  domain: CacheDomain;
  scopeKey: string;
  reason: string;
}

export interface FrozenRunInvalidationDecision {
  runId: string;
  evidenceHash: string;
  affectsFrozenRun: false;
  affectsFutureRuns: boolean;
  reason: string;
}

export function getCacheInvalidationTargets(trigger: CacheInvalidationTrigger): CacheInvalidationTarget[] {
  switch (trigger.type) {
    case "new_trading_day":
      return [
        {
          domain: "price_snapshot_cache",
          scopeKey: trigger.marketDate,
          reason: "new trading day invalidates prior price snapshots for future runs",
        },
      ];
    case "provider_version_changed":
      return [
        {
          domain: trigger.domain,
          scopeKey: trigger.providerVersion,
          reason: "provider version changed",
        },
      ];
    case "checksum_mismatch":
      return [
        {
          domain: trigger.domain,
          scopeKey: trigger.checksum,
          reason: "checksum mismatch",
        },
      ];
    case "news_ttl_expired":
      return [
        {
          domain: "news_search_cache",
          scopeKey: trigger.lookbackWindow,
          reason: "news ttl expired",
        },
      ];
    case "fetcher_version_changed":
      return [
        {
          domain: trigger.domain,
          scopeKey: trigger.fetcherVersion,
          reason: "fetcher version changed",
        },
      ];
    case "article_body_changed":
      return [
        {
          domain: "article_body_cache",
          scopeKey: trigger.articleChecksum,
          reason: "article body changed",
        },
        {
          domain: "sentiment_extraction_cache",
          scopeKey: trigger.articleChecksum,
          reason: "article body changed invalidates downstream sentiment extraction",
        },
      ];
    case "prompt_version_changed":
      return [
        {
          domain: "sentiment_extraction_cache",
          scopeKey: trigger.extractionPromptVersion,
          reason: "prompt version changed",
        },
      ];
    case "model_changed":
      return [
        {
          domain: "sentiment_extraction_cache",
          scopeKey: trigger.model,
          reason: "model changed",
        },
      ];
    case "new_market_session":
      return [
        {
          domain: "market_context_cache",
          scopeKey: trigger.marketDate,
          reason: "new market session",
        },
      ];
    case "conviction_edited":
      return [
        {
          domain: "conviction_normalization_cache",
          scopeKey: `${trigger.scope.userId}:${trigger.scope.bundleScope}:${trigger.scope.profileHash}:${trigger.scope.convictionHash}:${trigger.parserVersion}`,
          reason: "conviction edit invalidates future normalization in the exact user/profile/context scope",
        },
      ];
    case "snapshot_replaced":
      return [
        {
          domain: "holdings_normalization_cache",
          scopeKey: `${trigger.scope.userId}:${trigger.scope.bundleScope}:${trigger.scope.portfolioSnapshotId}:${trigger.scope.portfolioSnapshotHash}:${trigger.parserVersion}`,
          reason: "snapshot replacement invalidates future holdings normalization in the exact snapshot scope",
        },
      ];
    case "backfill_readiness_version_changed":
      return [
        {
          domain: "legacy_backfill_readiness_state",
          scopeKey: `${trigger.bundleScope}:${trigger.readinessVersion}`,
          reason: "backfill readiness version changed",
        },
      ];
  }
}

export function evaluateFrozenRunInvalidation(
  frozenRun: FrozenRunCacheScope,
  trigger: CacheInvalidationTrigger
): FrozenRunInvalidationDecision {
  return {
    runId: frozenRun.runId,
    evidenceHash: frozenRun.evidenceHash,
    affectsFrozenRun: false,
    affectsFutureRuns: true,
    reason: `frozen evidence for run ${frozenRun.runId} remains immutable after ${trigger.type}; invalidation applies only to future runs`,
  };
}
