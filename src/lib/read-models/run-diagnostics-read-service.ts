import { prisma } from "@/lib/prisma";
import type {
  DiagnosticsMetricContract,
  DiagnosticsSourceRefContract,
  DiagnosticsStepContract,
  DiagnosticsStepStatus,
  DiagnosticsWarningContract,
  RunDiagnosticsArtifact,
} from "@/lib/contracts";

function parseJsonField<T>(value: string | null | undefined, label: string): T {
  if (!value || !value.trim()) {
    throw new Error(`${label} is missing`);
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

function isRunDiagnosticsArtifact(value: unknown): value is RunDiagnosticsArtifact {
  return !!value
    && typeof value === "object"
    && typeof (value as RunDiagnosticsArtifact).bundleId === "string"
    && typeof (value as RunDiagnosticsArtifact).runId === "string"
    && Array.isArray((value as RunDiagnosticsArtifact).steps);
}

function toStepStatusFromLegacyStatus(value: unknown): DiagnosticsStepStatus {
  if (typeof value !== "string") return "not_run";
  if (value.startsWith("!Failed")) return "error";
  if (value.startsWith("!")) return "warning";
  return "ok";
}

function normalizeLegacySummary(value: unknown): string {
  if (typeof value !== "string") {
    return "No diagnostics summary was persisted for this step.";
  }

  return value.startsWith("!") ? value.slice(1) : value;
}

function buildMetrics(rows: Array<[string, string, string | number | boolean | null | undefined]>): DiagnosticsMetricContract[] {
  return rows
    .filter(([, , value]) => value !== undefined)
    .map(([key, label, value]) => ({
      key,
      label,
      value: value ?? null,
    }));
}

function buildWarnings(rows: Array<[string, string, "info" | "warning" | "error"]>): DiagnosticsWarningContract[] {
  return rows.map(([code, message, severity]) => ({ code, message, severity }));
}

function toSourceRef(source: any): DiagnosticsSourceRefContract {
  return {
    title: source?.title ?? source?.source ?? "Untitled source",
    url: source?.url ?? null,
    source: source?.source ?? null,
    publishedAt: source?.publishedAt ?? null,
  };
}

function buildFallbackDiagnosticsArtifact(bundle: any, analysisRun: any): RunDiagnosticsArtifact {
  const evidencePacket = parseJsonField<Record<string, any>>(bundle.evidencePacketJson, "evidencePacketJson");
  const validationSummary = parseJsonField<Record<string, any>>(bundle.validationSummaryJson, "validationSummaryJson");
  const sourceList = parseJsonField<any[]>(bundle.sourceListJson, "sourceListJson");
  const qualityMeta = analysisRun?.qualityMeta
    ? parseJsonField<Record<string, any>>(analysisRun.qualityMeta, "analysisRun.qualityMeta")
    : {};
  const systemVerification = qualityMeta.systemVerification ?? {};
  const promptHash = qualityMeta.promptHash ?? evidencePacket.promptHash ?? null;
  const evidenceHash = bundle.evidenceHash ?? promptHash ?? null;
  const versions = {
    schemaVersion: bundle.schemaVersion ?? null,
    analysisPolicyVersion: bundle.analysisPolicyVersion ?? null,
    viewModelVersion: bundle.viewModelVersion ?? null,
  };
  const model = {
    name: bundle.primaryModel ?? null,
    promptVersion: bundle.promptVersion ?? null,
    responseHash: bundle.llmResponseHash ?? null,
  };

  const legacySteps: DiagnosticsStepContract[] = [
    {
      stepKey: "market_regime",
      stepName: "Market Regime",
      status: toStepStatusFromLegacyStatus(systemVerification.marketRegime?.status),
      summary: normalizeLegacySummary(systemVerification.marketRegime?.status ?? "Not run"),
      inputs: {
        evidencePacketId: qualityMeta.evidencePacketId ?? evidencePacket.evidencePacketId ?? null,
      },
      outputs: {
        rationale: systemVerification.marketRegime?.rationale ?? null,
      },
      metrics: [],
      sources: [],
      warnings: [],
      model: null,
      hashes: { evidenceHash, promptHash },
      versions,
    },
    {
      stepKey: "gap_scan",
      stepName: "Portfolio Gap Scan",
      status: toStepStatusFromLegacyStatus(systemVerification.gapAnalysis?.status),
      summary: normalizeLegacySummary(systemVerification.gapAnalysis?.status ?? "Not run"),
      inputs: {},
      outputs: {
        rationale: systemVerification.gapAnalysis?.rationale ?? null,
      },
      metrics: [],
      sources: [],
      warnings: [],
      model: null,
      hashes: { evidenceHash, promptHash },
      versions,
    },
    {
      stepKey: "candidate_screening",
      stepName: "Candidate Screening",
      status: toStepStatusFromLegacyStatus(systemVerification.candidateScreening?.status),
      summary: normalizeLegacySummary(systemVerification.candidateScreening?.status ?? "Not run"),
      inputs: {},
      outputs: {
        rationale: systemVerification.candidateScreening?.rationale ?? null,
      },
      metrics: [],
      sources: [],
      warnings: [],
      model: null,
      hashes: { evidenceHash, promptHash },
      versions,
    },
    {
      stepKey: "news_sources",
      stepName: "News & Event Sources",
      status: toStepStatusFromLegacyStatus(systemVerification.fastSearchResearch?.status),
      summary: normalizeLegacySummary(systemVerification.fastSearchResearch?.status ?? "Not run"),
      inputs: {
        usingFallbackNews: qualityMeta.usingFallbackNews ?? evidencePacket.usingFallbackNews ?? false,
      },
      outputs: {
        rationale: systemVerification.fastSearchResearch?.rationale ?? null,
      },
      metrics: buildMetrics([
        ["source_count", "Source Count", sourceList.length],
      ]),
      sources: sourceList.map(toSourceRef),
      warnings: qualityMeta.usingFallbackNews
        ? buildWarnings([["fallback_news", "Fallback news path was used for this run.", "warning"]])
        : [],
      model: null,
      hashes: { evidenceHash, promptHash },
      versions,
    },
    {
      stepKey: "sentiment",
      stepName: "FinBERT / Sentiment",
      status: toStepStatusFromLegacyStatus(systemVerification.finbertSentiment?.status),
      summary: normalizeLegacySummary(systemVerification.finbertSentiment?.status ?? "Not run"),
      inputs: {},
      outputs: {
        rationale: systemVerification.finbertSentiment?.rationale ?? null,
        sentimentOverlay: systemVerification.sentimentOverlay?.overlay ?? [],
      },
      metrics: buildMetrics([
        ["overlay_count", "Overlay Tickers", Array.isArray(systemVerification.sentimentOverlay?.overlay) ? systemVerification.sentimentOverlay.overlay.length : 0],
      ]),
      sources: [],
      warnings: [],
      model: null,
      hashes: { evidenceHash, promptHash },
      versions,
    },
    {
      stepKey: "gpt5_reasoning",
      stepName: "GPT-5 Reasoning",
      status: toStepStatusFromLegacyStatus(systemVerification.gpt5Strategic?.status),
      summary: normalizeLegacySummary(systemVerification.gpt5Strategic?.status ?? "Not run"),
      inputs: {
        totalInputChars: qualityMeta.totalInputChars ?? evidencePacket.additionalContextLength ?? null,
        perSectionChars: qualityMeta.perSectionChars ?? null,
      },
      outputs: {
        rationale: systemVerification.gpt5Strategic?.rationale ?? null,
        adjudicatorTickers: qualityMeta.adjudicatorTickers ?? [],
      },
      metrics: buildMetrics([
        ["adjudicator_count", "Adjudicator Tickers", Array.isArray(qualityMeta.adjudicatorTickers) ? qualityMeta.adjudicatorTickers.length : 0],
      ]),
      sources: [],
      warnings: [],
      model,
      hashes: { evidenceHash, promptHash },
      versions,
    },
    {
      stepKey: "validation_finalization",
      stepName: "Validation & Finalization",
      status: validationSummary.hardErrorCount > 0
        ? "error"
        : validationSummary.warningCount > 0
          ? "warning"
          : "ok",
      summary: validationSummary.hardErrorCount > 0
        ? "Validation recorded hard errors."
        : validationSummary.warningCount > 0
          ? "Validation completed with warnings."
          : "Validation and finalization completed cleanly.",
      inputs: {
        evidencePacketId: qualityMeta.evidencePacketId ?? evidencePacket.evidencePacketId ?? null,
      },
      outputs: {
        hardErrorCount: validationSummary.hardErrorCount ?? 0,
        warningCount: validationSummary.warningCount ?? 0,
        reasonCodes: validationSummary.reasonCodes ?? [],
      },
      metrics: buildMetrics([
        ["hard_error_count", "Hard Errors", validationSummary.hardErrorCount ?? 0],
        ["warning_count", "Warnings", validationSummary.warningCount ?? 0],
      ]),
      sources: [],
      warnings: (validationSummary.reasonCodes ?? []).map((code: string) => ({
        code,
        message: code,
        severity: validationSummary.hardErrorCount > 0 ? "error" : "warning",
      })),
      model,
      hashes: { evidenceHash, promptHash },
      versions,
    },
  ];

  return {
    bundleId: bundle.id,
    runId: bundle.sourceRunId,
    outcome: bundle.bundleOutcome,
    generatedAt: bundle.finalizedAt.toISOString(),
    evidencePacketId: qualityMeta.evidencePacketId ?? evidencePacket.evidencePacketId ?? null,
    steps: legacySteps,
  };
}

export async function getRunDiagnostics(bundleId: string) {
  const bundle = await prisma.analysisBundle.findUnique({
    where: { id: bundleId },
  });

  if (!bundle) {
    return null;
  }

  const evidencePacket = parseJsonField<Record<string, unknown>>(bundle.evidencePacketJson, "evidencePacketJson");
  const persistedDiagnostics = (evidencePacket as { diagnosticsArtifact?: unknown }).diagnosticsArtifact;

  const artifact = isRunDiagnosticsArtifact(persistedDiagnostics)
    ? persistedDiagnostics
    : buildFallbackDiagnosticsArtifact(
        bundle,
        bundle.sourceRunId
          ? await prisma.analysisRun.findUnique({
              where: { id: bundle.sourceRunId },
              select: { qualityMeta: true },
            })
          : null
      );

  return {
    artifactMeta: {
      bundleId: artifact.bundleId,
      runId: artifact.runId,
      outcome: artifact.outcome,
      generatedAt: artifact.generatedAt,
      evidencePacketId: artifact.evidencePacketId,
    },
    steps: artifact.steps,
    downloadHref: null,
  };
}
