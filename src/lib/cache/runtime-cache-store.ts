import {
  assertCacheLayerWriter,
  createCacheReadRequest,
  createCacheWriteRequest,
  type CacheEntry,
  type CacheReadRequest,
  type CacheWriteRequest,
} from "./cache-layer";
import type { CacheDomain } from "./cache-keys";

const runtimeCacheStore = new Map<string, CacheEntry>();

function buildStoreId(domain: CacheDomain, key: string): string {
  return `${domain}::${key}`;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

export function clearRuntimeCacheStore(): void {
  runtimeCacheStore.clear();
}

export function createRuntimeCacheRead(domain: CacheDomain, key: string): CacheReadRequest {
  return createCacheReadRequest(domain, key);
}

export function createRuntimeCacheWrite<TValue>(
  domain: CacheDomain,
  key: string,
  value: TValue,
  versionTag: string
): CacheWriteRequest<TValue> {
  return createCacheWriteRequest(domain, key, value, versionTag);
}

export function readRuntimeCache<TValue>(
  request: CacheReadRequest,
  expectedVersionTag: string
): TValue | null {
  const entry = runtimeCacheStore.get(buildStoreId(request.domain, request.key));
  if (!entry || entry.versionTag !== expectedVersionTag) {
    return null;
  }

  return cloneValue(entry.value as TValue);
}

export function writeRuntimeCache<TValue>(request: CacheWriteRequest<TValue>): TValue {
  assertCacheLayerWriter(request.writer);
  const now = new Date().toISOString();

  runtimeCacheStore.set(buildStoreId(request.domain, request.key), {
    domain: request.domain,
    key: request.key,
    value: cloneValue(request.value),
    versionTag: request.versionTag,
    createdAt: now,
    updatedAt: now,
  });

  return cloneValue(request.value);
}

export async function getOrLoadRuntimeCache<TValue>(params: {
  domain: CacheDomain;
  key: string;
  versionTag: string;
  loader: () => Promise<TValue>;
}): Promise<TValue> {
  const cached = readRuntimeCache<TValue>(
    createRuntimeCacheRead(params.domain, params.key),
    params.versionTag
  );
  if (cached !== null) {
    return cached;
  }

  const loaded = await params.loader();
  return writeRuntimeCache(
    createRuntimeCacheWrite(params.domain, params.key, loaded, params.versionTag)
  );
}

export function invalidateRuntimeCacheByDomain(domain: CacheDomain): void {
  for (const key of runtimeCacheStore.keys()) {
    if (key.startsWith(`${domain}::`)) {
      runtimeCacheStore.delete(key);
    }
  }
}

export function freezeRuntimeEvidence<T>(value: T): T {
  return cloneValue(value);
}
