import {
  createStageProviderPressureDiagnostics,
  finalizeStageProviderPressureDiagnostics,
} from "./provider-pressure-diagnostics";
import type { MarketDataHelperDiagnostics, StageProviderPressureResultState } from "./types";

export function createMarketDataHelperDiagnostics(input: {
  inputTickerCount: number;
  resultState?: StageProviderPressureResultState;
  freshnessDecisionReason?: string | null;
}): MarketDataHelperDiagnostics {
  return {
    ...createStageProviderPressureDiagnostics(input.resultState ?? "fresh"),
    helperCallCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    inputTickerCount: input.inputTickerCount,
    outputTickerCount: 0,
    freshnessDecisionReason: input.freshnessDecisionReason ?? null,
  };
}

export function recordMarketDataHelperInvocation(diagnostics: MarketDataHelperDiagnostics): void {
  diagnostics.helperCallCount += 1;
}

export function recordMarketDataCacheHit(diagnostics: MarketDataHelperDiagnostics): void {
  diagnostics.cacheHitCount += 1;
}

export function recordMarketDataCacheMiss(diagnostics: MarketDataHelperDiagnostics): void {
  diagnostics.cacheMissCount += 1;
}

export function finalizeMarketDataHelperDiagnostics(
  diagnostics: MarketDataHelperDiagnostics,
  outputTickerCount: number,
  stageLatencyMs: number
): MarketDataHelperDiagnostics {
  const base = finalizeStageProviderPressureDiagnostics(diagnostics, stageLatencyMs);
  const resultState: StageProviderPressureResultState =
    diagnostics.providerCallCount === 0 && diagnostics.cacheHitCount > 0
      ? "cache_hit"
      : "fresh";

  return {
    ...diagnostics,
    ...base,
    resultState,
    outputTickerCount,
  };
}
