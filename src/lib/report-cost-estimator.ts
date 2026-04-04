import type { DiagnosticsStepContract } from "@/lib/contracts";

const PRIMARY_MODEL_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  "gpt-5.4": { inputPer1M: 2.5, outputPer1M: 15 },
};

const ESTIMATED_WEB_SEARCH_CALL_COST_USD = 0.01;

export interface AnalysisCostEstimate {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  primaryModelCostUsd: number;
  estimatedResearchCalls: number;
  estimatedResearchCostUsd: number;
  estimatedTotalCostUsd: number;
  basisNote: string;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

type DiagnosticsStepsCarrier = {
  steps: DiagnosticsStepContract[];
} | null | undefined;

function getStep(artifact: DiagnosticsStepsCarrier, stepKey: DiagnosticsStepContract["stepKey"]) {
  return artifact?.steps.find((step) => step.stepKey === stepKey) ?? null;
}

function estimateResearchCalls(artifact: DiagnosticsStepsCarrier): number {
  if (!artifact) return 0;

  let calls = 0;

  const marketRegime = getStep(artifact, "market_regime");
  if (marketRegime && marketRegime.status !== "not_run") calls += 1;

  const gapScan = getStep(artifact, "gap_scan");
  if (gapScan && gapScan.status !== "not_run") calls += 3;

  const macroCollection = getStep(artifact, "macro_news_collection");
  if (macroCollection && macroCollection.status !== "not_run") calls += 7;

  const candidateScreening = getStep(artifact, "candidate_screening");
  if (candidateScreening && candidateScreening.status !== "not_run") {
    const macroLaneCount = toNumber(candidateScreening.inputs?.macroLaneCount);
    calls += 1 + Math.max(0, macroLaneCount ?? 0);
  }

  const newsSources = getStep(artifact, "news_sources");
  if (newsSources && newsSources.status !== "not_run") calls += 1;

  return calls;
}

export function estimateAnalysisCost(input: {
  primaryModel: string | null;
  llmUsage: Record<string, unknown> | null | undefined;
  diagnostics: DiagnosticsStepsCarrier;
}): AnalysisCostEstimate {
  const model = input.primaryModel;
  const pricing = model ? PRIMARY_MODEL_PRICING[model] ?? null : null;
  const inputTokens = toNumber(input.llmUsage?.inputTokens);
  const outputTokens = toNumber(input.llmUsage?.outputTokens);

  const primaryModelCostUsd = pricing
    ? (((inputTokens ?? 0) / 1_000_000) * pricing.inputPer1M) + (((outputTokens ?? 0) / 1_000_000) * pricing.outputPer1M)
    : 0;

  const estimatedResearchCalls = estimateResearchCalls(input.diagnostics);
  const estimatedResearchCostUsd = estimatedResearchCalls * ESTIMATED_WEB_SEARCH_CALL_COST_USD;

  return {
    model,
    inputTokens,
    outputTokens,
    primaryModelCostUsd,
    estimatedResearchCalls,
    estimatedResearchCostUsd,
    estimatedTotalCostUsd: primaryModelCostUsd + estimatedResearchCostUsd,
    basisNote: "Estimate includes stored primary-model token usage plus a deterministic web-search call heuristic for research stages.",
  };
}
