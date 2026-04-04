import type {
  StageProviderPressureDiagnostics,
  StageProviderPressureResultState,
} from "./types";

export function createStageProviderPressureDiagnostics(
  resultState: StageProviderPressureResultState = "fresh"
): StageProviderPressureDiagnostics {
  return {
    providerCallCount: 0,
    retryCount: 0,
    totalBackoffSeconds: 0,
    maxSingleBackoffSeconds: 0,
    stageLatencyMs: 0,
    resultState,
    reuseSourceBundleId: null,
    reuseMissReason: null,
  };
}

export function recordStageProviderCall(diagnostics: StageProviderPressureDiagnostics): void {
  diagnostics.providerCallCount += 1;
}

export function recordStageProviderBackoff(
  diagnostics: StageProviderPressureDiagnostics,
  backoffSeconds: number
): void {
  diagnostics.retryCount += 1;
  diagnostics.totalBackoffSeconds += backoffSeconds;
  diagnostics.maxSingleBackoffSeconds = Math.max(diagnostics.maxSingleBackoffSeconds, backoffSeconds);
}

export function finalizeStageProviderPressureDiagnostics(
  diagnostics: StageProviderPressureDiagnostics,
  stageLatencyMs: number
): StageProviderPressureDiagnostics {
  return {
    ...diagnostics,
    stageLatencyMs,
  };
}
