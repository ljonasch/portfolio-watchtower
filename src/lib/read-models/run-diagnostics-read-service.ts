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

function ensureSection(
  data: Record<string, unknown>,
  note: string
): Record<string, unknown> {
  return Object.keys(data).length > 0
    ? data
    : { note };
}

const GENERIC_NOTE_PATTERNS = [
  "No explicit input telemetry was captured",
  "No explicit output summary was captured",
  "Inputs were not explicitly persisted",
  "Outputs were not explicitly persisted",
  "Unavailable in fallback diagnostics",
  "No persisted output summary was available in fallback diagnostics",
];

const PROVENANCE_ONLY_KEYS = new Set([
  "artifactId",
  "bundleId",
  "bundleOutcome",
  "bundleSource",
  "evidenceHash",
  "evidencePacketId",
  "generatedAt",
  "promptHash",
  "responseHash",
  "runId",
]);

function isGenericNote(value: unknown): boolean {
  return typeof value === "string" && GENERIC_NOTE_PATTERNS.some((pattern) => value.includes(pattern));
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0 && !isGenericNote(value);
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

function hasHumanReadableSectionValue(data: Record<string, unknown>): boolean {
  return Object.entries(data).some(([key, value]) => !PROVENANCE_ONLY_KEYS.has(key) && hasMeaningfulValue(value));
}

function humanReadableFallbackNote(stepKey: DiagnosticsStepContract["stepKey"], section: "inputs" | "outputs"): string {
  const notes: Record<DiagnosticsStepContract["stepKey"], { inputs: string; outputs: string }> = {
    market_regime: {
      inputs: "This step reviewed the current macro regime using volatility, rates, and dollar context available for the run.",
      outputs: "This step did not persist a detailed market-regime conclusion beyond the stored status summary.",
    },
    gap_scan: {
      inputs: "This step scanned the existing portfolio for concentration risks, redundancies, and missing themes.",
      outputs: "This step did not persist a detailed gap-scan result beyond the stored summary.",
    },
    candidate_screening: {
      inputs: "This step reviewed existing holdings plus externally screened names against the identified portfolio gaps.",
      outputs: "This step did not persist detailed candidate-screening results beyond the stored summary.",
    },
    news_sources: {
      inputs: "This step searched recent company, sector, and macro news relevant to the analyzed tickers.",
      outputs: "This step did not persist a detailed news-source summary beyond the stored citation list.",
    },
    sentiment: {
      inputs: "This step evaluated sentiment signals across the analyzed tickers for this run.",
      outputs: "This step did not persist a detailed sentiment summary beyond the stored overlay results.",
    },
    gpt5_reasoning: {
      inputs: "This step assembled the compiled research context that was sent into the final reasoning model.",
      outputs: "This step did not persist a detailed reasoning summary beyond the stored status output.",
    },
    validation_finalization: {
      inputs: "This step validated the bundle payload and finalized the run outcome for persistence.",
      outputs: "This step did not persist additional finalization details beyond the stored outcome summary.",
    },
  };

  return notes[stepKey][section];
}

function buildLegacyGapOutcome(status: string, rationale: string | null | undefined): string {
  if (status === "0 gaps") {
    return "The portfolio gap scan ran and found no material gaps worth surfacing in this run.";
  }
  if (status === "Not run") {
    return "The portfolio gap scan did not persist enough information to confirm whether it ran meaningfully.";
  }
  return rationale || `The portfolio gap scan surfaced ${status.toLowerCase()} for this run.`;
}

function buildLegacyCandidateOutcome(status: string, rationale: string | null | undefined): string {
  if (status === "0 added") {
    return "Candidate screening ran and no external candidates passed the screen for this run.";
  }
  if (status === "Not run") {
    return "Candidate screening did not persist enough information to confirm whether it ran meaningfully.";
  }
  return rationale || `Candidate screening produced ${status.toLowerCase()} in this run.`;
}

function ensureStepSections(
  step: DiagnosticsStepContract,
  notes: {
    inputs: string;
    outputs: string;
  }
): DiagnosticsStepContract {
  return {
    ...step,
    inputs: ensureSection(step.inputs, notes.inputs),
    outputs: ensureSection(step.outputs, notes.outputs),
  };
}

function normalizeArtifactSections(
  artifact: RunDiagnosticsArtifact,
  notes: {
    inputs: string;
    outputs: string;
  }
): RunDiagnosticsArtifact {
  return {
    ...artifact,
    steps: artifact.steps.map((step) => {
      const ensured = ensureStepSections(step, notes);
      return {
        ...ensured,
        inputs: hasHumanReadableSectionValue(ensured.inputs)
          ? ensured.inputs
          : { ...ensured.inputs, note: humanReadableFallbackNote(step.stepKey, "inputs") },
        outputs: hasHumanReadableSectionValue(ensured.outputs)
          ? ensured.outputs
          : { ...ensured.outputs, note: humanReadableFallbackNote(step.stepKey, "outputs") },
      };
    }),
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
        asOfDate: bundle.finalizedAt.toISOString().split("T")[0],
        indicatorsReviewed: [
          "Market volatility",
          "Interest-rate trend",
          "US dollar backdrop",
        ],
      },
      outputs: {
        regimeAssessment: normalizeLegacySummary(systemVerification.marketRegime?.status ?? "Not run"),
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
      inputs: {
        portfolioReview: "Existing holdings were reviewed for concentration, redundancy, and missing themes.",
        searchBasis: systemVerification.gapAnalysis?.rationale ?? "No explicit gap-search brief was persisted for this older bundle.",
        inputAvailability: "Legacy fallback confirms the gap scan had at least holdings-level portfolio context, but not the richer canonical telemetry captured by newer bundles.",
      },
      outputs: {
        gapAssessment: normalizeLegacySummary(systemVerification.gapAnalysis?.status ?? "Not run"),
        outcomeExplanation: buildLegacyGapOutcome(
          normalizeLegacySummary(systemVerification.gapAnalysis?.status ?? "Not run"),
          systemVerification.gapAnalysis?.rationale ?? null
        ),
        rationale: systemVerification.gapAnalysis?.rationale ?? null,
        emptyResultReason: normalizeLegacySummary(systemVerification.gapAnalysis?.status ?? "Not run") === "0 gaps"
          ? "The older bundle indicates the gap scan ran but found no material gaps worth surfacing."
          : null,
      },
      metrics: [],
      sources: [],
      warnings: normalizeLegacySummary(systemVerification.gapAnalysis?.status ?? "Not run") === "Not run"
        ? buildWarnings([["gap_scan_legacy_missing", "Legacy fallback could not confirm whether the gap scan completed meaningfully.", "warning"]])
        : [],
      model: null,
      hashes: { evidenceHash, promptHash },
      versions,
    },
    {
      stepKey: "candidate_screening",
      stepName: "Candidate Screening",
      status: toStepStatusFromLegacyStatus(systemVerification.candidateScreening?.status),
      summary: normalizeLegacySummary(systemVerification.candidateScreening?.status ?? "Not run"),
      inputs: {
        screeningContext: "Held names and externally screened candidates were evaluated against the gap-scan output.",
        rankingBasis: "Legacy fallback confirms screening occurred, but only limited candidate-ranking telemetry was persisted for this older bundle.",
        screeningGoal: systemVerification.gapAnalysis?.rationale ?? "No explicit candidate-screening brief was persisted for this older bundle.",
      },
      outputs: {
        screeningResult: normalizeLegacySummary(systemVerification.candidateScreening?.status ?? "Not run"),
        outcomeExplanation: buildLegacyCandidateOutcome(
          normalizeLegacySummary(systemVerification.candidateScreening?.status ?? "Not run"),
          systemVerification.candidateScreening?.rationale ?? null
        ),
        rationale: systemVerification.candidateScreening?.rationale ?? null,
        emptyResultReason: normalizeLegacySummary(systemVerification.candidateScreening?.status ?? "Not run") === "0 added"
          ? "Legacy fallback indicates the screening step ran but no candidates passed."
          : null,
      },
      metrics: [],
      sources: [],
      warnings: normalizeLegacySummary(systemVerification.candidateScreening?.status ?? "Not run") === "Not run"
        ? buildWarnings([["candidate_screening_legacy_missing", "Legacy fallback could not confirm whether candidate screening completed meaningfully.", "warning"]])
        : [],
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
        searchWindow: qualityMeta.usingFallbackNews ?? evidencePacket.usingFallbackNews
          ? "Yahoo Finance fallback headlines"
          : "Breaking 24h plus broader company, sector, and macro search",
        fallbackUsed: qualityMeta.usingFallbackNews ?? evidencePacket.usingFallbackNews ?? false,
        newsAvailabilityStatus: qualityMeta.newsAvailabilityStatus ?? null,
        searchScope: "Legacy fallback confirms the news step searched the analyzed ticker set, but only limited request-scope telemetry was persisted.",
      },
      outputs: {
        sourceCoverage: normalizeLegacySummary(systemVerification.fastSearchResearch?.status ?? "Not run"),
        statusSummary: qualityMeta.newsStatusSummary ?? (qualityMeta.usingFallbackNews
          ? "Yahoo Finance fallback headlines were used because primary live-news coverage was unavailable for this run."
          : null),
        outcomeExplanation: sourceList.length > 0
          ? `${sourceList.length} source(s) were persisted for this run.`
          : "The news step did not persist any source-backed items for this older bundle.",
        rationale: systemVerification.fastSearchResearch?.rationale || (sourceList.length > 0 ? "Citations were persisted for this run." : null),
        topSourceTitles: sourceList.slice(0, 5).map((source) => source?.title ?? source?.source ?? "Untitled source"),
        emptyResultReason: sourceList.length === 0
          ? (qualityMeta.usingFallbackNews
            ? "Legacy fallback indicates the run had degraded primary news coverage and no fallback sources were persisted."
            : "Legacy fallback has no persisted sources for this run.")
          : null,
      },
      metrics: buildMetrics([
        ["source_count", "Source Count", sourceList.length],
      ]),
      sources: sourceList.map(toSourceRef),
      warnings: qualityMeta.usingFallbackNews
        ? buildWarnings([["fallback_news", qualityMeta.newsStatusSummary ?? "Fallback news path was used for this run.", "warning"]])
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
      inputs: {
        scoringScope: "Holdings and screened candidates were evaluated for sentiment signals.",
        inputAvailability: "Legacy fallback retains the sentiment step outcome but not the richer per-ticker coverage telemetry captured in newer bundles.",
      },
      outputs: {
        sentimentSummary: normalizeLegacySummary(systemVerification.finbertSentiment?.status ?? "Not run"),
        outcomeExplanation: normalizeLegacySummary(systemVerification.finbertSentiment?.status ?? "Not run") === "0 scored"
          ? "Sentiment scoring ran and found no non-zero signals worth surfacing."
          : `Sentiment scoring produced ${normalizeLegacySummary(systemVerification.finbertSentiment?.status ?? "Not run").toLowerCase()} in this run.`,
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
        contextSections: Object.keys(qualityMeta.perSectionChars ?? {}).map((key) => `${key}: ${(qualityMeta.perSectionChars ?? {})[key]} chars`),
        adjudicatorSupport: Array.isArray(qualityMeta.adjudicatorTickers) && qualityMeta.adjudicatorTickers.length > 0
          ? `${qualityMeta.adjudicatorTickers.length} low-confidence ticker(s) received adjudicator notes.`
          : "No low-confidence adjudicator pass was needed for this run.",
        inputScope: "Legacy fallback retains the overall reasoning-context size, but not the richer per-step reasoning telemetry captured in newer bundles.",
      },
      outputs: {
        reasoningSummary: normalizeLegacySummary(systemVerification.gpt5Strategic?.status ?? "Not run"),
        outcomeExplanation: normalizeLegacySummary(systemVerification.gpt5Strategic?.status ?? "Not run") === "Not run"
          ? "Legacy fallback could not confirm a meaningful final reasoning result for this bundle."
          : `The reasoning stage produced ${normalizeLegacySummary(systemVerification.gpt5Strategic?.status ?? "Not run").toLowerCase()} in this run.`,
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
        finalOutcome: bundle.bundleOutcome,
        evidencePacketReady: Boolean(qualityMeta.evidencePacketId ?? evidencePacket.evidencePacketId ?? null),
      },
      outputs: {
        validationSummary: validationSummary.hardErrorCount > 0
          ? `Validation recorded ${validationSummary.hardErrorCount} hard error(s).`
          : validationSummary.warningCount > 0
            ? `Validation completed with ${validationSummary.warningCount} warning(s).`
            : "Validation and finalization completed without hard errors or warnings.",
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

  const normalizedSteps = legacySteps.map((step) =>
    ensureStepSections(step, {
      inputs: "Unavailable in fallback diagnostics for this older bundle.",
      outputs: "No persisted output summary was available in fallback diagnostics for this older bundle.",
    })
  );

  return {
    bundleId: bundle.id,
    runId: bundle.sourceRunId,
    outcome: bundle.bundleOutcome,
    generatedAt: bundle.finalizedAt.toISOString(),
    evidencePacketId: qualityMeta.evidencePacketId ?? evidencePacket.evidencePacketId ?? null,
    steps: normalizedSteps,
  };
}

export async function getRunDiagnostics(bundleId: string) {
  const bundle = await prisma.analysisBundle.findUnique({
    where: { id: bundleId },
  });

  if (!bundle) {
    return null;
  }
  let artifact: RunDiagnosticsArtifact;
  let artifactSource: "persisted" | "fallback" | "invalid";
  let hasPersistedArtifact = false;
  let note: string | null = null;

  try {
    const evidencePacket = parseJsonField<Record<string, unknown>>(bundle.evidencePacketJson, "evidencePacketJson");
    const persistedDiagnostics = (evidencePacket as { diagnosticsArtifact?: unknown }).diagnosticsArtifact;
    hasPersistedArtifact = persistedDiagnostics !== undefined;

    if (isRunDiagnosticsArtifact(persistedDiagnostics)) {
      artifact = normalizeArtifactSections(persistedDiagnostics, {
        inputs: "Inputs were not explicitly persisted for this diagnostics step.",
        outputs: "Outputs were not explicitly persisted for this diagnostics step.",
      });
      artifactSource = "persisted";
    } else {
      artifact = buildFallbackDiagnosticsArtifact(
        bundle,
        bundle.sourceRunId
          ? await prisma.analysisRun.findUnique({
              where: { id: bundle.sourceRunId },
              select: { qualityMeta: true },
            })
          : null
      );
      artifactSource = hasPersistedArtifact ? "invalid" : "fallback";
      note = hasPersistedArtifact
        ? "Persisted diagnostics artifact was present but invalid; using synthesized fallback diagnostics."
        : "Persisted diagnostics artifact was absent; using synthesized fallback diagnostics.";
    }
  } catch (error) {
    artifact = {
      bundleId: bundle.id,
      runId: bundle.sourceRunId,
      outcome: bundle.bundleOutcome as RunDiagnosticsArtifact["outcome"],
      generatedAt: bundle.finalizedAt.toISOString(),
      evidencePacketId: null,
      steps: [],
    };
    artifactSource = "invalid";
    note = error instanceof Error ? error.message : "Diagnostics artifact could not be loaded.";
  }

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
    diagnosticsState: {
      bundleExists: true,
      hasPersistedArtifact,
      artifactSource,
      stepCount: artifact.steps.length,
      note,
    },
  };
}
