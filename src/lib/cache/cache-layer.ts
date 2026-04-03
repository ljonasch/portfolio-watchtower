import type { CacheDomain } from "./cache-keys";

export const CACHE_LAYER_OWNER = "cache_layer" as const;

export type CacheLayerOwner = typeof CACHE_LAYER_OWNER;

export interface CacheEntry<TValue = unknown> {
  domain: CacheDomain;
  key: string;
  value: TValue;
  versionTag: string;
  createdAt: string;
  updatedAt: string;
}

export interface CacheWriteRequest<TValue = unknown> {
  writer: CacheLayerOwner;
  domain: CacheDomain;
  key: string;
  value: TValue;
  versionTag: string;
}

export interface CacheReadRequest {
  domain: CacheDomain;
  key: string;
}

export function assertCacheLayerWriter(writer: string): asserts writer is CacheLayerOwner {
  if (writer !== CACHE_LAYER_OWNER) {
    throw new Error(`Cache writes are owned exclusively by ${CACHE_LAYER_OWNER}`);
  }
}

export function createCacheWriteRequest<TValue>(
  domain: CacheDomain,
  key: string,
  value: TValue,
  versionTag: string
): CacheWriteRequest<TValue> {
  return {
    writer: CACHE_LAYER_OWNER,
    domain,
    key,
    value,
    versionTag,
  };
}

export function createCacheReadRequest(domain: CacheDomain, key: string): CacheReadRequest {
  return {
    domain,
    key,
  };
}
