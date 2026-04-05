import type { DiagnosticsStepContract } from "@/lib/contracts";

const PRIMARY_MODEL_PRICING_FAMILIES: Array<{
  prefix: string;
  inputPer1M: number;
  outputPer1M: number;
}> = [
  { prefix: "gpt-5.4", inputPer1M: 2.5, outputPer1M: 15 },
];

const ESTIMATED_WEB_SEARCH_CALL_COST_USD = 0.01;

export interface AnalysisCostModelBreakdown {
  model: string;
  label: string;
  basis: "exact" | "derived" | "heuristic" | "detected";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCalls: number | null;
  estimatedCostUsd: number | null;
  note: string;
}

export interface AnalysisCostEstimate {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  primaryModelCostUsd: number;
  estimatedResearchCalls: number;
  estimatedResearchCostUsd: number;
  estimatedTotalCostUsd: number;
  basisNote: string;
  modelBreakdown: AnalysisCostModelBreakdown[];
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getPricingForModel(model: string | null) {
  if (!model) return null;
  return PRIMARY_MODEL_PRICING_FAMILIES.find((candidate) => model.startsWith(candidate.prefix)) ?? null;
}

type DiagnosticsStepsCarrier = {
  steps: DiagnosticsStepContract[];
} | null | undefined;

function getStep(artifact: DiagnosticsStepsCarrier, stepKey: DiagnosticsStepContract["stepKey"]) {
  return artifact?.steps.find((step) => step.stepKey === stepKey) ?? null;
}

function getMetricNumber(step: DiagnosticsStepContract | null, key: string): number | null {
  if (!step) return null;
  return toNumber(step.metrics.find((metric) => metric.key === key)?.value);
}

function getOutputNumber(step: DiagnosticsStepContract | null, key: string): number | null {
  if (!step) return null;
  return toNumber(step.outputs[key]);
}

function getInputNumber(step: DiagnosticsStepContract | null, key: string): number | null {
  if (!step) return null;
  return toNumber(step.inputs[key]);
}

function getInputString(step: DiagnosticsStepContract | null, key: string): string | null {
  if (!step) return null;
  return toStringValue(step.inputs[key]);
}

function isSearchReuseState(value: string | null): boolean {
  return value === "cache_hit"
    || value === "runtime_cache_hit"
    || value === "frozen_artifact_reuse"
    || value === "reused_from_finalized_bundle";
}

function estimateSearchCallsForStep(step: DiagnosticsStepContract | null): number {
  if (!step || step.status === "not_run") {
    return 0;
  }

  switch (step.stepKey) {
    case "market_regime":
      return 1;
    case "gap_scan": {
      const exact = getOutputNumber(step, "providerCallCount") ?? getMetricNumber(step, "gap_provider_calls");
      if (exact !== null) return exact;
      return getInputString(step, "executionState") === "reused_from_finalized_bundle" ? 0 : 3;
    }
    case "macro_news_collection": {
      const exact = getOutputNumber(step, "providerCallCount") ?? getMetricNumber(step, "macro_provider_calls");
      if (exact !== null) return exact;
      return isSearchReuseState(getInputString(step, "executionState")) ? 0 : 7;
    }
    case "candidate_screening": {
      const exact = getOutputNumber(step, "providerPromptCount") ?? getMetricNumber(step, "screening_prompt_count");
      if (exact !== null) return exact;
      if (getInputString(step, "reuseState") === "reused_from_bundle") return 0;
      const macroLaneCount = Math.max(0, getInputNumber(step, "macroLaneCount") ?? 0);
      return 1 + macroLaneCount;
    }
    case "news_sources": {
      const exact = getOutputNumber(step, "providerCallCount") ?? getMetricNumber(step, "provider_call_count");
      if (exact !== null) return exact;
      return isSearchReuseState(getInputString(step, "executionState")) ? 0 : 1;
    }
    default:
      return 0;
  }
}

function estimateResearchCalls(artifact: DiagnosticsStepsCarrier): number {
  if (!artifact) return 0;

  return artifact.steps.reduce((sum, step) => sum + estimateSearchCallsForStep(step), 0);
}

function collectDetectedNonPrimaryModels(
  artifact: DiagnosticsStepsCarrier,
  primaryModel: string | null
): AnalysisCostModelBreakdown[] {
  if (!artifact) return [];

  const detected = new Set(
    artifact.steps
      .map((step) => step.model?.name)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .filter((value) => value !== primaryModel)
  );

  return Array.from(detected).map((model) => ({
    model,
    label: model,
    basis: "detected" as const,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCalls: null,
    estimatedCostUsd: null,
    note: "Model participation was persisted in diagnostics, but exact token usage was not stored in the bundle.",
  }));
}

export function estimateAnalysisCost(input: {
  primaryModel: string | null;
  llmUsage: Record<string, unknown> | null | undefined;
  diagnostics: DiagnosticsStepsCarrier;
}): AnalysisCostEstimate {
  const model = input.primaryModel;
  const pricing = getPricingForModel(model);
  const inputTokens = toNumber(input.llmUsage?.inputTokens);
  const outputTokens = toNumber(input.llmUsage?.outputTokens);
  const totalTokens = inputTokens !== null || outputTokens !== null
    ? (inputTokens ?? 0) + (outputTokens ?? 0)
    : null;

  const primaryModelCostUsd = pricing
    ? (((inputTokens ?? 0) / 1_000_000) * pricing.inputPer1M) + (((outputTokens ?? 0) / 1_000_000) * pricing.outputPer1M)
    : 0;

  const estimatedResearchCalls = estimateResearchCalls(input.diagnostics);
  const estimatedResearchCostUsd = estimatedResearchCalls * ESTIMATED_WEB_SEARCH_CALL_COST_USD;

  const modelBreakdown: AnalysisCostModelBreakdown[] = [];

  if (model || inputTokens !== null || outputTokens !== null) {
    modelBreakdown.push({
      model: model ?? "primary_model",
      label: model ?? "Primary model",
      basis: "exact",
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCalls: null,
      estimatedCostUsd: pricing ? primaryModelCostUsd : null,
      note: pricing
        ? "Exact primary-model tokens were persisted in the bundle. Cost uses the report-page heuristic pricing table."
        : "Exact primary-model tokens were persisted in the bundle, but this report does not have a pricing rule for that model family.",
    });
  }

  if (estimatedResearchCalls > 0) {
    modelBreakdown.push({
      model: "gpt-5-search-api",
      label: "gpt-5-search-api",
      basis: "heuristic",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCalls: estimatedResearchCalls,
      estimatedCostUsd: estimatedResearchCostUsd,
      note: "Derived from bundle-backed research-stage diagnostics. Exact per-call search tokens were not persisted locally.",
    });
  }

  modelBreakdown.push(...collectDetectedNonPrimaryModels(input.diagnostics, model));

  return {
    model,
    inputTokens,
    outputTokens,
    primaryModelCostUsd,
    estimatedResearchCalls,
    estimatedResearchCostUsd,
    estimatedTotalCostUsd: primaryModelCostUsd + estimatedResearchCostUsd,
    basisNote: "Model usage below mixes exact primary-model tokens with diagnostics-derived heuristic search-stage participation. This is visibility-oriented and not billing-grade.",
    modelBreakdown,
  };
}
