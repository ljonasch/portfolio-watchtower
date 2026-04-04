/**
 * Main Analysis Orchestrator
 * All 28 fixes wired in:
 *   W23 — Circuit breaker (fast-fail if OpenAI is down)
 *   F4  — Stage timing coordination (valuation + correlation run in parallel with news)
 *   F9  — News source deduplication (via deduplicateSources already in news-fetcher)
 *   W14 — Price context passed to sentiment scorer
 *   W24 — Price data unavailability flag
 *   W16 — Mid-run regime re-check (after breaking news)
 *   F3  — Convergence rule external (prior actions passed to aggregator)
 *   W22 — Gap prioritization by capital impact
 *   F8/W11/W20 — Model tracker called after run
 *   W19 — JSON truncation guard (context length cap)
 *   W13 — Valuation anchor injected
 *   W18 — Correlation matrix injected
 *   F10 — Scheduler extended (handled in ecosystem.config.js)
 */

import OpenAI from "openai";
import { freezeRuntimeEvidence } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { detectMarketRegime }      from "./market-regime";
import { deriveEnvironmentalGaps, runStructuralGapAnalysis } from "./gap-analyzer";
import { screenCandidates }        from "./candidate-screener";
import { fetchAllNewsWithFallback } from "./news-fetcher";
import { fetchPriceTimelines }     from "./price-timeline";
import { scoreSentimentForAll }    from "./sentiment-scorer";
import { buildSentimentOverlay, type SentimentOverlay } from "./signal-aggregator";
import { buildResearchContext }    from "./context-loader";
import { collectMacroNewsEnvironment } from "./macro-news-environment";
import {
  deriveMacroThemeConsensus,
  MACRO_THEME_CONSENSUS_THRESHOLDS,
} from "./macro-theme-consensus";
import { applyMacroExposureBridge, MACRO_EXPOSURE_BRIDGE_RULES } from "./macro-exposure-bridge";
import { deriveMacroCandidateSearchLanes, PHASE1_MACRO_LANE_REGISTRY } from "./macro-candidate-lanes";
import {
  generatePortfolioReport,
  Stage3PreflightBudgetExceededError,
  type Stage3FullPromptPreflightSummary,
} from "@/lib/analyzer";
import { compareRecommendations }  from "@/lib/comparator";
import { evaluateAlert }           from "@/lib/alerts";
import { fetchValuationForAll, formatValuationSection } from "./valuation-fetcher";
import { buildCorrelationMatrix, formatCorrelationSection } from "./correlation-matrix";
import { recordRunStats } from "./model-tracker";
import { finalizeAnalysisRun, type FinalizeAnalysisRunInput } from "@/lib/services/analysis-lifecycle-service";
import { buildFrozenMacroEvidence, replayMacroOutputsFromFrozenEvidence } from "./macro-evidence-freeze";
import { budgetStage3Context, STAGE3_CONTEXT_BUDGET, type Stage3ContextBudgetSummary } from "./stage3-context-budget";
import {
  buildPromptHash,
  writeEvidencePacket,
  updateEvidencePacketOutcome,
} from "./evidence-packet-builder";
import type { ProgressEvent }      from "./progress-events";
import {
  AnalysisAbstainedError,
  type AbstainResult,
  type CandidateSearchLane,
  type EnvironmentalGap,
  type MacroExposureBridgeResult,
  type MacroNewsEnvironmentResult,
  type MacroThemeConsensusResult,
} from "./types";
import type {
  DiagnosticsMetricContract,
  DiagnosticsSourceRefContract,
  DiagnosticsStepContract,
  DiagnosticsWarningContract,
  RunDiagnosticsArtifact,
} from "@/lib/contracts";

// ── W23: Circuit breaker ──────────────────────────────────────────────────────

async function checkApiConnectivity(openai: any): Promise<void> {
  try {
    const r = await openai.chat.completions.create(
      {
        model: "gpt-5-search-api",
        max_completion_tokens: 5,
        messages: [{ role: "user", content: "ok" }],
      },
      { timeout: 10000 }
    );
    if (!r.choices?.[0]?.message?.content && r.choices?.[0]?.finish_reason !== "stop") {
      // gpt-5-search sometimes returns empty for trivial prompts — that's ok
    }
  } catch (err: any) {
    // Rate limit is ok — means API is up
    if (err?.status === 429) return;
    throw new Error(`OpenAI API connectivity check failed: ${err?.message ?? "unknown error"}. Aborting analysis.`);
  }
}

// ── W19: Context length guard ─────────────────────────────────────────────────

function guardContextLength(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  // Don't cut mid-sentence
  const lastPeriod = truncated.lastIndexOf(".");
  const safe = lastPeriod > maxChars * 0.8 ? truncated.slice(0, lastPeriod + 1) : truncated;
  return safe + `\n[${label} truncated at ${maxChars} chars to prevent JSON overflow]`;
}

export function freezeRunEvidenceSet<T>(value: T): T {
  return freezeRuntimeEvidence(value);
}

function buildDiagnosticsMetrics(
  rows: Array<[string, string, string | number | boolean | null | undefined]>
): DiagnosticsMetricContract[] {
  return rows
    .filter(([, , value]) => value !== undefined)
    .map(([key, label, value]) => ({
      key,
      label,
      value: value ?? null,
    }));
}

function buildDiagnosticsWarnings(
  rows: Array<[string, string, DiagnosticsWarningContract["severity"]]>
): DiagnosticsWarningContract[] {
  return rows.map(([code, message, severity]) => ({
    warningId: "",
    code,
    message,
    severity,
  }));
}

function normalizeWarningMessageFamily(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function aggregateAndAssignWarningIds(
  stepKey: DiagnosticsStepContract["stepKey"],
  warnings: DiagnosticsWarningContract[]
): DiagnosticsWarningContract[] {
  if (warnings.length === 0) return warnings;

  let normalizedWarnings = warnings;

  if (stepKey === "news_sources") {
    const aggregated: DiagnosticsWarningContract[] = [];
    const rateLimitWarnings = warnings.filter((warning) => warning.code === "primary_rate_limited");
    const nonRateLimitWarnings = warnings.filter((warning) => warning.code !== "primary_rate_limited");

    if (rateLimitWarnings.length > 0) {
      const fallbackWarning = warnings.find((warning) => warning.code === "fallback_used");
      const transportWarning = warnings.find((warning) => warning.code === "primary_transport_failure");
      const summary = `Primary live-news search was rate-limited ${rateLimitWarnings.length} time(s) during this run.${fallbackWarning ? " Yahoo Finance fallback headlines were used afterward." : transportWarning ? " The run remained degraded after the retry loop." : " Retries eventually continued without a separate fallback warning."}`;

      aggregated.push({
        warningId: "",
        code: "primary_rate_limited",
        message: summary,
        severity: rateLimitWarnings.some((warning) => warning.severity === "error") ? "error" : "warning",
      });
    }

    normalizedWarnings = [...aggregated, ...nonRateLimitWarnings];
  }

  const duplicateOrdinals = new Map<string, number>();
  return normalizedWarnings.map((warning) => {
    const family = normalizeWarningMessageFamily(warning.message);
    const ordinalKey = `${stepKey}:${warning.code}:${family}`;
    const ordinal = duplicateOrdinals.get(ordinalKey) ?? 0;
    duplicateOrdinals.set(ordinalKey, ordinal + 1);
    return {
      ...warning,
      warningId: `${stepKey}:${warning.code}:${family}:${ordinal}`,
    };
  });
}

function normalizeStepWarnings(step: DiagnosticsStepContract): DiagnosticsStepContract {
  return {
    ...step,
    warnings: aggregateAndAssignWarningIds(step.stepKey, step.warnings ?? []),
  };
}

function buildStepBase(
  step: Pick<DiagnosticsStepContract, "stepKey" | "stepName" | "status" | "summary">,
  context: {
    evidenceHash: string | null;
    promptHash: string | null;
    schemaVersion: string | null;
    analysisPolicyVersion: string | null;
    viewModelVersion: string | null;
  }
): DiagnosticsStepContract {
  return {
    ...step,
    inputs: {},
    outputs: {},
    metrics: [],
    sources: [],
    warnings: [],
    model: null,
    hashes: {
      evidenceHash: context.evidenceHash,
      promptHash: context.promptHash,
    },
    versions: {
      schemaVersion: context.schemaVersion,
      analysisPolicyVersion: context.analysisPolicyVersion,
      viewModelVersion: context.viewModelVersion,
    },
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

function ensureStepSections(
  step: DiagnosticsStepContract,
  notes: {
    inputs: string;
    outputs: string;
  }
): DiagnosticsStepContract {
  return normalizeStepWarnings({
    ...step,
    inputs: ensureSection(step.inputs, notes.inputs),
    outputs: ensureSection(step.outputs, notes.outputs),
  });
}

function truncateText(value: string | null | undefined, maxLength = 240): string | null {
  if (!value) return null;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function toLabeledTickerList(
  values: Array<string | { ticker?: string | null; companyName?: string | null; action?: string | null }>
): string[] {
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      const ticker = value?.ticker ?? "Unknown";
      const companyName = value?.companyName ? ` - ${value.companyName}` : "";
      const action = value?.action ? ` (${value.action})` : "";
      return `${ticker}${companyName}${action}`;
    })
    .filter(Boolean);
}

function summarizeCandidateSources(candidates: Array<{ source?: string | null }>): string {
  const normalized = Array.from(
    new Set(
      candidates
        .map((candidate) => candidate?.source)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  );

  if (normalized.length === 0) {
    return "No explicit external screening source tags were persisted for this run.";
  }

  return normalized
    .map((source) => source.replace(/_/g, " "))
    .join(", ");
}

function summarizeContextSections(perSectionChars: Record<string, unknown> | null | undefined): string[] {
  if (!perSectionChars) return [];

  return Object.entries(perSectionChars)
    .filter(([, value]) => typeof value === "number" && value > 0)
    .map(([key, value]) => `${key}: ${value} chars`);
}

function summarizeTopSentimentSignals(signals: any[], overlay: any[]): Array<Record<string, unknown>> {
  const overlayByTicker = new Map(
    (Array.isArray(overlay) ? overlay : []).map((entry: any) => [String(entry?.ticker ?? "").toUpperCase(), entry])
  );

  return signals
    .slice()
    .sort((a: any, b: any) => {
      const aScore = Math.max(Math.abs(a?.finbertScore ?? 0), Math.abs(a?.fingptScore ?? 0));
      const bScore = Math.max(Math.abs(b?.finbertScore ?? 0), Math.abs(b?.fingptScore ?? 0));
      return bScore - aScore;
    })
    .slice(0, 5)
    .map((signal: any) => {
      const ticker = String(signal?.ticker ?? "").toUpperCase();
      const overlayEntry = overlayByTicker.get(ticker);
      return {
        ticker,
        finbertScore: signal?.finbertScore ?? null,
        fingptScore: signal?.fingptScore ?? null,
        stance: overlayEntry?.stance ?? null,
      };
    });
}

function buildGapScanDiagnostics(input: {
  gapReport?: any;
  existingHoldingsCount?: number | null;
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics"> {
  const gapRows = Array.isArray(input.gapReport?.structuralGaps)
    ? input.gapReport.structuralGaps
    : Array.isArray(input.gapReport?.gaps)
      ? input.gapReport.gaps
      : [];
  const holdingsReviewed = input.existingHoldingsCount ?? null;
  const hasHoldingsInput = typeof holdingsReviewed === "number" && holdingsReviewed > 0;
  const hasSearchBasis = Boolean(input.gapReport?.searchBrief || input.gapReport?.profilePreferences);
  const hasMeaningfulInputs = hasHoldingsInput || hasSearchBasis;
  const ranMeaningfully = hasMeaningfulInputs;
  const foundGaps = gapRows.length > 0;

  const status: DiagnosticsStepContract["status"] = foundGaps
    ? "ok"
    : ranMeaningfully
      ? "ok"
      : "warning";

  const outcomeExplanation = foundGaps
    ? `${gapRows.length} material portfolio gap(s) were identified from the current holdings and profile context.`
    : ranMeaningfully
      ? "The gap scan ran successfully and found no material portfolio gaps worth actioning in this run."
      : "Gap scan degraded because the run did not persist enough holdings or search-basis context to explain an empty result confidently.";

  return {
    status,
    summary: outcomeExplanation,
    inputs: {
      holdingsScannedCount: holdingsReviewed,
      scanScope: hasHoldingsInput
        ? "Existing portfolio holdings were scanned for concentration, redundancy, and missing-theme exposure."
        : "Holdings-scan scope was not fully persisted for this run.",
      searchBasis: input.gapReport?.searchBrief ?? "No explicit gap-search brief was persisted for this run.",
      profilePreferenceContext: input.gapReport?.profilePreferences ?? "No additional profile-preference gap context was persisted for this run.",
      authorityRule: "Structural gaps remain more authoritative than environmental gaps in phase 1.",
      inputAvailability: hasMeaningfulInputs
        ? "Enough portfolio context was available to run the gap scan."
        : "Portfolio gap scan inputs were incomplete, so the empty result may reflect degraded telemetry rather than a clean no-gap outcome.",
    },
    outputs: {
      outcomeExplanation,
      gapCount: gapRows.length,
      topFindings: gapRows.slice(0, 5).map((gap: any) => ({
        type: gap?.type ?? null,
        description: gap?.description ?? null,
        affectedTickers: gap?.affectedTickers ?? [],
        priority: gap?.priority ?? null,
      })),
      environmentalGapCount: Array.isArray(input.gapReport?.environmentalGaps) ? input.gapReport.environmentalGaps.length : 0,
      emptyResultReason: foundGaps
        ? null
        : ranMeaningfully
          ? "No material gaps cleared the step's threshold for surfacing in this run."
          : "The scan did not persist enough context to distinguish between a true no-gap result and a degraded run.",
    },
    warnings: !hasMeaningfulInputs
      ? buildDiagnosticsWarnings([["gap_scan_inputs_incomplete", "Gap scan inputs were incomplete, so the step may have degraded before producing meaningful findings.", "warning"]])
      : [],
    metrics: buildDiagnosticsMetrics([
      ["gap_count", "Gap Count", gapRows.length],
      ["holdings_scanned", "Holdings Scanned", holdingsReviewed],
    ]),
  };
}

function buildCandidateScreeningDiagnostics(input: {
  candidates?: any[];
  existingHoldingsCount?: number | null;
  allTickers?: string[];
  gapReport?: any;
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics"> {
  const candidateRows = Array.isArray(input.candidates) ? input.candidates : [];
  const holdingsCount = input.existingHoldingsCount ?? null;
  const allTickers = Array.isArray(input.allTickers) ? input.allTickers : [];
  const candidatePoolCount = Math.max(0, allTickers.length - (holdingsCount ?? 0));
  const hasScreeningContext = typeof holdingsCount === "number" || Boolean(input.gapReport?.searchBrief);
  const foundCandidates = candidateRows.length > 0;
  const macroOriginCount = candidateRows.filter((candidate) => candidate?.candidateOrigin === "macro_lane").length;
  const structuralOriginCount = candidateRows.filter((candidate) => candidate?.candidateOrigin !== "macro_lane").length;

  const status: DiagnosticsStepContract["status"] = foundCandidates
    ? "ok"
    : hasScreeningContext
      ? "ok"
      : "warning";

  const outcomeExplanation = foundCandidates
    ? `${candidateRows.length} candidate(s) passed screening and were advanced into the analyzed ticker set.`
    : hasScreeningContext
      ? "Candidate screening ran and no external candidates passed the screen for this run."
      : "Candidate screening degraded because the run did not persist enough screening context to explain the empty result confidently.";

  return {
    status,
    summary: outcomeExplanation,
    inputs: {
      heldTickerCount: holdingsCount,
      analyzedTickerCount: allTickers.length || null,
      estimatedExternalPoolCount: candidatePoolCount || 0,
      screeningGoal: input.gapReport?.searchBrief ?? "No explicit screening brief was persisted for this run.",
      categoriesConsidered: typeof holdingsCount === "number"
        ? "Existing holdings plus externally screened candidates were considered."
        : "The run did not persist enough context to confirm the full screening scope.",
      rankingBasis: candidateRows.some((candidate) => candidate?.catalyst || candidate?.analystRating)
        ? "Gap fit, recent catalyst strength, analyst support, and live-price validation."
        : "Gap fit and externally screened candidate reasoning.",
      macroLaneCount: Array.isArray(input.gapReport?.candidateSearchLanes) ? input.gapReport.candidateSearchLanes.length : 0,
    },
    outputs: {
      outcomeExplanation,
      screenedInCount: candidateRows.length,
      screenedInByOrigin: {
        structural: structuralOriginCount,
        macroLane: macroOriginCount,
      },
      screenedOutCount: candidatePoolCount > candidateRows.length ? candidatePoolCount - candidateRows.length : null,
      topCandidates: candidateRows.slice(0, 10).map((candidate: any) => ({
        ticker: candidate?.ticker ?? null,
        companyName: candidate?.companyName ?? null,
        candidateOrigin: candidate?.candidateOrigin ?? "structural",
        discoveryLaneId: candidate?.discoveryLaneId ?? null,
        reason: candidate?.reason ?? null,
        catalyst: candidate?.catalyst ?? null,
        analystRating: candidate?.analystRating ?? null,
      })),
      emptyResultReason: foundCandidates
        ? null
        : hasScreeningContext
          ? "No screened candidates met the bar to be advanced into the final analyzed set."
          : "The screening step did not persist enough scope detail to explain why no candidates passed.",
    },
    warnings: !hasScreeningContext
      ? buildDiagnosticsWarnings([["candidate_screening_context_missing", "Candidate screening context was incomplete, so the empty result may reflect degraded telemetry.", "warning"]])
      : [],
    metrics: buildDiagnosticsMetrics([
      ["candidate_count", "Candidate Count", candidateRows.length],
      ["held_ticker_count", "Held Tickers", holdingsCount],
      ["estimated_external_pool", "Estimated External Pool", candidatePoolCount],
    ]),
  };
}

function buildMacroNewsCollectionDiagnostics(input: {
  macroEnvironment?: MacroNewsEnvironmentResult | null;
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics" | "sources"> {
  const environment = input.macroEnvironment;
  const issues = Array.isArray(environment?.issues) ? environment.issues : [];
  const articles = Array.isArray(environment?.articles) ? environment.articles : [];
  const hasArticles = articles.length > 0;
  const status: DiagnosticsStepContract["status"] =
    environment?.availabilityStatus === "primary_rate_limited" || environment?.availabilityStatus === "primary_transport_failure" || environment?.availabilityStatus === "no_usable_news"
      ? "warning"
      : hasArticles
        ? "ok"
        : "warning";

  return {
    status,
    summary: environment?.statusSummary ?? "Macro-news collection did not persist a usable summary.",
    inputs: {
      queryFamilies: [
        "rates / inflation / central banks",
        "recession / labor / growth slowdown",
        "energy / commodities",
        "geopolitics / war / shipping / supply chain",
        "regulation / export controls / AI policy",
        "credit stress / liquidity / banking stress",
        "defense / fiscal / industrial policy",
      ],
      collectionMode: "Portfolio-neutral fixed global macro query families.",
      freshnessWindow: "Last 7 days with last 72 hours emphasized.",
      sortRule: "Trusted first, newest first, canonical URL ascending.",
      degradedReason: environment?.degradedReason ?? null,
    },
    outputs: {
      outcomeExplanation: environment?.statusSummary ?? "Macro-news collection produced no persisted summary.",
      articleCount: environment?.articleCount ?? 0,
      trustedArticleCount: environment?.trustedArticleCount ?? 0,
      distinctPublisherCount: environment?.distinctPublisherCount ?? 0,
      issueSummary: issues.slice(0, 5).map((issue) => issue.message),
      topArticleIds: articles.slice(0, 5).map((article) => article.articleId),
      emptyResultReason: hasArticles ? null : "No usable macro-news environment articles were persisted for this run.",
    },
    metrics: buildDiagnosticsMetrics([
      ["macro_article_count", "Macro Articles", environment?.articleCount ?? 0],
      ["trusted_macro_articles", "Trusted Macro Articles", environment?.trustedArticleCount ?? 0],
      ["macro_distinct_publishers", "Distinct Publishers", environment?.distinctPublisherCount ?? 0],
    ]),
    sources: articles.slice(0, 10).map((article) => ({
      title: article.title,
      url: article.canonicalUrl,
      source: article.publisher,
      publishedAt: article.publishedAt,
    })),
    warnings: issues.map((issue) => ({
      warningId: "",
      code: issue.kind,
      message: issue.message,
      severity: issue.kind === "primary_rate_limited" || issue.kind === "primary_transport_failure" || issue.kind === "no_usable_news" ? "warning" : "info",
    })),
  };
}

function buildMacroThemeConsensusDiagnostics(input: {
  macroConsensus?: MacroThemeConsensusResult | null;
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics"> {
  const consensus = input.macroConsensus;
  const themes = Array.isArray(consensus?.themes) ? consensus.themes : [];
  const actionableThemes = themes.filter((theme) => theme.actionable);

  return {
    status: actionableThemes.length > 0 ? "ok" : themes.length > 0 ? "warning" : "warning",
    summary: consensus?.statusSummary ?? "Macro-theme consensus did not persist a usable summary.",
    inputs: {
      thresholds: consensus?.thresholds ?? MACRO_THEME_CONSENSUS_THRESHOLDS,
      classificationRule: "Deterministic theme-family mapping from query family, normalized title, topic hints, and fixed keyword rules.",
    },
    outputs: {
      outcomeExplanation: consensus?.statusSummary ?? "No macro-theme consensus summary was persisted.",
      actionableThemeCount: actionableThemes.length,
      observedThemeCount: themes.filter((theme) => theme.supportingArticleCount > 0 || theme.counterArticleIds.length > 0).length,
      themes: themes.map((theme) => ({
        themeId: theme.themeId,
        themeKey: theme.themeKey,
        actionable: theme.actionable,
        supportRatio: theme.supportRatio,
        contradictionLevel: theme.contradictionLevel,
        supportingArticleCount: theme.supportingArticleCount,
        trustedSupportingCount: theme.trustedSupportingCount,
      })),
    },
    metrics: buildDiagnosticsMetrics([
      ["macro_actionable_themes", "Actionable Themes", actionableThemes.length],
      ["macro_observed_themes", "Observed Themes", themes.length],
    ]),
    warnings: actionableThemes.length === 0 && themes.length > 0
      ? buildDiagnosticsWarnings([["macro_no_actionable_consensus", "Macro themes were observed, but none cleared the deterministic consensus gate.", "warning"]])
      : [],
  };
}

function buildMacroExposureBridgeDiagnostics(input: {
  macroBridge?: MacroExposureBridgeResult | null;
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics"> {
  const bridge = input.macroBridge;
  const hits = Array.isArray(bridge?.hits) ? bridge.hits : [];

  return {
    status: hits.length > 0 ? "ok" : "warning",
    summary: bridge?.statusSummary ?? "Macro exposure bridge did not persist a usable summary.",
    inputs: {
      bridgeRuleCount: MACRO_EXPOSURE_BRIDGE_RULES.length,
      bridgeRuleIds: MACRO_EXPOSURE_BRIDGE_RULES.map((rule) => rule.ruleId),
      ruleMode: "Deterministic rule registry only; no open-ended macro reasoning.",
    },
    outputs: {
      outcomeExplanation: bridge?.statusSummary ?? "No macro exposure bridge summary was persisted.",
      hitCount: hits.length,
      hits: hits.map((hit) => ({
        bridgeHitId: hit.bridgeHitId,
        themeId: hit.themeId,
        ruleId: hit.ruleId,
        matchedToken: hit.matchedToken,
        environmentalGapHints: hit.environmentalGapHints,
        laneHints: hit.laneHints,
        exposureTags: hit.exposureTags,
      })),
    },
    metrics: buildDiagnosticsMetrics([
      ["macro_bridge_hits", "Bridge Hits", hits.length],
      ["macro_bridge_rules", "Bridge Rules", MACRO_EXPOSURE_BRIDGE_RULES.length],
    ]),
    warnings: hits.length === 0
      ? buildDiagnosticsWarnings([["macro_bridge_no_hits", "No macro exposure bridge rules fired from the actionable macro themes in this run.", "info"]])
      : [],
  };
}

function buildEnvironmentalGapDiagnostics(input: {
  environmentalGaps?: EnvironmentalGap[] | null;
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics"> {
  const gaps = Array.isArray(input.environmentalGaps) ? input.environmentalGaps : [];
  return {
    status: gaps.length > 0 ? "ok" : "warning",
    summary: gaps.length > 0
      ? `${gaps.length} environmental gap(s) were derived from actionable macro themes and bridge outputs.`
      : "No actionable environmental gaps were derived from the macro environment in this run.",
    inputs: {
      authorityRule: "Structural gaps remain more authoritative than environmental gaps.",
      derivationMode: "Environmental gaps require actionable macro themes plus bounded bridge outputs.",
    },
    outputs: {
      environmentalGapCount: gaps.length,
      gaps: gaps.map((gap) => ({
        gapId: gap.gapId,
        themeId: gap.themeId,
        urgency: gap.urgency,
        exposureTags: gap.exposureTags,
        candidateSearchTags: gap.candidateSearchTags,
        bridgeRuleIds: gap.bridgeRuleIds,
        openCandidateDiscovery: gap.openCandidateDiscovery,
      })),
    },
    metrics: buildDiagnosticsMetrics([
      ["environmental_gap_count", "Environmental Gaps", gaps.length],
      ["environmental_gaps_opening_discovery", "Discovery-Opening Gaps", gaps.filter((gap) => gap.openCandidateDiscovery).length],
    ]),
    warnings: gaps.length === 0
      ? buildDiagnosticsWarnings([["environmental_gaps_none", "No environmental gaps cleared the phase-1 macro gate for this run.", "info"]])
      : [],
  };
}

function buildMacroCandidateLaneDiagnostics(input: {
  candidateSearchLanes?: CandidateSearchLane[] | null;
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics"> {
  const lanes = Array.isArray(input.candidateSearchLanes) ? input.candidateSearchLanes : [];
  return {
    status: lanes.length > 0 ? "ok" : "warning",
    summary: lanes.length > 0
      ? `${lanes.length} bounded macro candidate-search lane(s) were opened from environmental gaps.`
      : "No bounded macro candidate-search lanes were opened in this run.",
    inputs: {
      laneRegistryKeys: Object.keys(PHASE1_MACRO_LANE_REGISTRY),
      laneMode: "Fixed lane registry only; no dynamic lane creation.",
    },
    outputs: {
      laneCount: lanes.length,
      lanes: lanes.map((lane) => ({
        laneId: lane.laneId,
        laneKey: lane.laneKey,
        priority: lane.priority,
        themeIds: lane.themeIds,
        environmentalGapIds: lane.environmentalGapIds,
        bridgeRuleIds: lane.bridgeRuleIds,
      })),
    },
    metrics: buildDiagnosticsMetrics([
      ["macro_lane_count", "Macro Candidate Lanes", lanes.length],
      ["macro_lane_registry_size", "Lane Registry Size", Object.keys(PHASE1_MACRO_LANE_REGISTRY).length],
    ]),
    warnings: lanes.length === 0
      ? buildDiagnosticsWarnings([["macro_candidate_lanes_none", "No macro candidate-search lanes were authorized in this run.", "info"]])
      : [],
  };
}

export function buildMacroAnalyzerSummary(input: {
  macroEnvironment: MacroNewsEnvironmentResult;
  macroConsensus: MacroThemeConsensusResult;
  macroBridge: MacroExposureBridgeResult;
  environmentalGaps: EnvironmentalGap[];
  candidateSearchLanes: CandidateSearchLane[];
}): string {
  return [
    "=== MACRO ENVIRONMENT (NORMALIZED) ===",
    `Collection: ${input.macroEnvironment.statusSummary}`,
    `Consensus: ${input.macroConsensus.statusSummary}`,
    `Bridge: ${input.macroBridge.statusSummary}`,
    input.macroConsensus.themes.some((theme) => theme.actionable)
      ? `Actionable themes:\n${input.macroConsensus.themes
          .filter((theme) => theme.actionable)
          .map((theme) => `- ${theme.themeLabel} (${theme.confidence}, contradiction=${theme.contradictionLevel}, exposures=${theme.exposureTags.join(", ") || "none"})`)
          .join("\n")}`
      : "Actionable themes: none",
    input.environmentalGaps.length > 0
      ? `Environmental gaps:\n${input.environmentalGaps
          .map((gap) => `- ${gap.description} [theme=${gap.themeKey}; exposures=${gap.exposureTags.join(", ") || "none"}; lanes=${gap.candidateSearchTags.join(", ") || "none"}]`)
          .join("\n")}`
      : "Environmental gaps: none",
    input.candidateSearchLanes.length > 0
      ? `Macro candidate lanes:\n${input.candidateSearchLanes.map((lane) => `- ${lane.laneKey}: ${lane.rationaleSummary}`).join("\n")}`
      : "Macro candidate lanes: none",
    "Use macro as structured secondary context only. Do not reinterpret raw macro articles or use macro alone to set target weights.",
  ].join("\n");
}

function buildNewsSourceDiagnostics(input: {
  allTickers?: string[];
  usingFallbackNews?: boolean;
  newsResult?: any;
  sourceRefs: DiagnosticsSourceRefContract[];
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics" | "sources"> {
  const allTickers = Array.isArray(input.allTickers) ? input.allTickers : [];
  const breakingText = typeof input.newsResult?.breaking24h === "string" ? input.newsResult.breaking24h : "";
  const newsSignals = input.newsResult?.signals ?? null;
  const availabilityStatus = input.newsResult?.availabilityStatus ?? (input.usingFallbackNews ? "fallback_success" : "primary_success");
  const statusSummary = input.newsResult?.statusSummary
    ?? (input.usingFallbackNews
      ? "Yahoo Finance fallback headlines were used because primary live-news coverage was unavailable for this run."
      : "Primary live-news coverage was captured for this run.");
  const breakingItems = breakingText
    .split("\n")
    .map((line: string) => line.trim())
    .filter((line: string) => line.length > 0 && !line.toLowerCase().startsWith("no breaking news"))
    .length;
  const sourceCount = input.sourceRefs.length;
  const hasSearchContext = allTickers.length > 0;
  const collectedSources = sourceCount > 0;

  const status: DiagnosticsStepContract["status"] =
    availabilityStatus === "primary_transport_failure" || availabilityStatus === "primary_rate_limited" || availabilityStatus === "no_usable_news"
      ? "warning"
      : collectedSources
    ? "ok"
    : hasSearchContext
      ? "warning"
      : "warning";

  const outcomeExplanation = collectedSources
    ? statusSummary
    : availabilityStatus === "no_usable_news"
      ? "No usable primary or fallback news could be persisted for this run."
      : hasSearchContext
        ? statusSummary
        : "News source search context was incomplete, so the empty result may reflect degraded execution.";

  return {
    status,
    summary: outcomeExplanation,
    inputs: {
      tickersReviewed: allTickers.length > 0 ? allTickers : null,
      searchWindow: availabilityStatus === "fallback_success"
        ? "Yahoo Finance fallback headlines"
        : "Breaking 24h plus broader 30-day company, sector, and macro search",
      fallbackUsed: input.usingFallbackNews ?? false,
      newsAvailabilityStatus: availabilityStatus,
      degradedReason: input.newsResult?.degradedReason ?? null,
      searchScope: hasSearchContext
        ? "The step searched company, sector, and macro events relevant to the analyzed tickers."
        : "The run did not persist enough ticker scope to describe the news search inputs fully.",
    },
    outputs: {
      outcomeExplanation,
      sourceCount,
      newsSupportStrength: newsSignals
        ? `${newsSignals.directionalSupport} support, ${newsSignals.confidence} confidence, ${newsSignals.sourceDiversityCount} distinct source domain(s).`
        : null,
      breakingNewsSummary: truncateText(breakingText || null),
      combinedResearchSummary: truncateText(input.newsResult?.combinedSummary ?? null),
      topSourceTitles: input.sourceRefs.slice(0, 5).map((source) => source.title),
      issueSummary: Array.isArray(input.newsResult?.issues)
        ? input.newsResult.issues.slice(0, 3).map((issue: any) => issue.message)
        : [],
      emptyResultReason: collectedSources
        ? null
        : availabilityStatus === "no_usable_news"
          ? "No usable news could be recovered from either the primary provider or the Yahoo fallback for this run."
        : hasSearchContext
          ? "The news search completed but did not persist any source-backed items for this run."
          : "The step did not persist enough input scope to explain an empty source result confidently.",
    },
    metrics: buildDiagnosticsMetrics([
      ["source_count", "Source Count", sourceCount],
      ["breaking_items", "Breaking Items", breakingItems],
      ["tickers_reviewed", "Tickers Reviewed", allTickers.length || null],
      ["news_article_count", "News Article Count", newsSignals?.articleCount ?? null],
      ["source_diversity", "Source Diversity", newsSignals?.sourceDiversityCount ?? null],
    ]),
    sources: input.sourceRefs,
    warnings: Array.isArray(input.newsResult?.issues) && input.newsResult.issues.length > 0
      ? input.newsResult.issues.map((issue: any) => ({
          warningId: "",
          code: issue.kind ?? "news_issue",
          message: issue.message ?? "News fetch issue",
          severity: issue.kind === "primary_transport_failure" || issue.kind === "primary_rate_limited" || issue.kind === "no_usable_news"
            ? "warning"
            : "info",
        }))
      : !collectedSources
        ? buildDiagnosticsWarnings([["news_sources_empty", "News search returned no persisted sources for this run.", "warning"]])
        : [],
  };
}

function buildReasoningDiagnostics(input: {
  recommendationRows: any[];
  watchlistIdeas: any[];
  totalInputChars?: number | null;
  contextSections: string[];
  contextBudget?: Stage3ContextBudgetSummary | null;
  fullPromptPreflight?: Stage3FullPromptPreflightSummary | null;
  adjudicatorNotes?: Record<string, unknown>;
  allTickers?: string[];
  reportData?: any;
  outcome: RunDiagnosticsArtifact["outcome"];
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics" | "model"> {
  const recommendationCount = input.recommendationRows.length;
  const hasContext = (input.totalInputChars ?? 0) > 0 || input.contextSections.length > 0 || (input.allTickers?.length ?? 0) > 0;
  const blockedByPreflight = Boolean(input.fullPromptPreflight && !input.fullPromptPreflight.fitsBudget);
  const status: DiagnosticsStepContract["status"] = recommendationCount > 0
    ? "ok"
    : blockedByPreflight
      ? "not_run"
      : input.outcome === "validated"
      ? hasContext
        ? "warning"
        : "not_run"
      : "not_run";

  const outcomeExplanation = recommendationCount > 0
    ? `${recommendationCount} recommendation row(s) were produced from the final reasoning pass.`
    : blockedByPreflight
      ? "The final reasoning step was blocked by the full-prompt preflight budget before model invocation."
    : hasContext
      ? "The final reasoning step ran but did not produce actionable recommendation rows."
      : "The final reasoning step did not have enough persisted context to produce or explain recommendation output.";

  return {
    status,
    summary: outcomeExplanation,
    inputs: {
      recommendationUniverse: input.allTickers?.length ?? null,
      totalInputChars: input.totalInputChars ?? null,
      contextBudget: input.contextBudget
        ? {
            maxTotalChars: input.contextBudget.maxTotalChars,
            initialTotalChars: input.contextBudget.initialTotalChars,
            finalTotalChars: input.contextBudget.finalTotalChars,
            trimmingApplied: input.contextBudget.trimmingApplied,
            trimmedSections: input.contextBudget.trimmedSections,
            fitsBudget: input.contextBudget.fitsBudget,
          }
        : null,
      fullPromptPreflight: input.fullPromptPreflight
        ? {
            maxTotalChars: input.fullPromptPreflight.maxTotalChars,
            fullPromptChars: input.fullPromptPreflight.fullPromptChars,
            fitsBudget: input.fullPromptPreflight.fitsBudget,
            requiredSectionKeys: input.fullPromptPreflight.requiredSectionKeys,
            missingRequiredSections: input.fullPromptPreflight.missingRequiredSections,
          }
        : null,
      contextSections: input.contextSections.length > 0 ? input.contextSections : ["No per-section context telemetry was persisted for this run."],
      adjudicatorSupport: Object.keys(input.adjudicatorNotes ?? {}).length > 0
        ? `${Object.keys(input.adjudicatorNotes ?? {}).length} low-confidence ticker(s) received adjudicator notes.`
        : "No low-confidence adjudicator pass was needed for this run.",
    },
    outputs: {
      outcomeExplanation,
      recommendationCount,
      watchlistIdeasCount: input.watchlistIdeas.length,
      contextBudgetSummary: input.contextBudget
        ? input.contextBudget.trimmingApplied
          ? `Stage 3 context was trimmed deterministically from ${input.contextBudget.initialTotalChars} to ${input.contextBudget.finalTotalChars} chars before the primary reasoning call.`
          : `Stage 3 context fit within the ${input.contextBudget.maxTotalChars}-char budget without trimming.`
        : null,
      preflightOutcome: input.fullPromptPreflight
        ? input.fullPromptPreflight.fitsBudget
          ? `Final Stage 3 prompt fit within the ${input.fullPromptPreflight.maxTotalChars}-char preflight budget.`
          : `Final Stage 3 prompt preflight blocked model invocation at ${input.fullPromptPreflight.fullPromptChars} chars against the ${input.fullPromptPreflight.maxTotalChars}-char budget.`
        : null,
      recommendations: input.recommendationRows.slice(0, 10).map((recommendation: any) => ({
        ticker: recommendation?.ticker ?? null,
        companyName: recommendation?.companyName ?? null,
        action: recommendation?.action ?? null,
        thesisSummary: recommendation?.thesisSummary ?? recommendation?.detailedReasoning ?? null,
      })),
      watchlistIdeas: toLabeledTickerList(input.watchlistIdeas),
      outputSummary: input.reportData?.summary ?? null,
      emptyResultReason: recommendationCount > 0
        ? null
        : hasContext
          ? "The reasoning stage completed without surfacing actionable recommendations."
          : "The reasoning stage did not persist enough input context to explain an empty output.",
    },
    metrics: buildDiagnosticsMetrics([
      ["recommendation_count", "Recommendations", recommendationCount],
      ["watchlist_ideas", "Watchlist Ideas", input.watchlistIdeas.length],
      ["context_initial_chars", "Context Chars (Initial)", input.contextBudget?.initialTotalChars ?? null],
      ["context_final_chars", "Context Chars (Final)", input.contextBudget?.finalTotalChars ?? input.totalInputChars ?? null],
      ["context_trimmed_sections", "Trimmed Sections", input.contextBudget?.trimmedSections.length ?? 0],
      ["full_prompt_chars", "Full Prompt Chars", input.fullPromptPreflight?.fullPromptChars ?? null],
      ["missing_required_sections", "Missing Required Sections", input.fullPromptPreflight?.missingRequiredSections.length ?? 0],
    ]),
    warnings: Object.keys(input.adjudicatorNotes ?? {}).length > 0
      ? buildDiagnosticsWarnings([["adjudicator_invoked", "Low-confidence adjudicator notes were captured for this run.", "info"]])
      : recommendationCount === 0 && hasContext
        ? buildDiagnosticsWarnings([["reasoning_no_actions", "The reasoning stage completed without actionable recommendations.", "warning"]])
        : [],
    model: null,
  };
}

function buildMarketRegimeDiagnostics(input: {
  generatedAt: string;
  regime?: any;
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings"> {
  const hasRegime = Boolean(input.regime?.summary && input.regime.summary !== "Regime data unavailable.");
  const outcomeExplanation = hasRegime
    ? "Market regime detection completed with a usable macro posture summary."
    : "Market regime detection degraded because the run did not persist a usable macro summary.";

  return {
    status: hasRegime ? "ok" : "warning",
    summary: outcomeExplanation,
    inputs: {
      asOfDate: input.generatedAt.split("T")[0],
      indicatorsReviewed: [
        "CBOE VIX volatility",
        "US 10-year Treasury yield",
        "US Dollar Index",
      ],
      executionMode: hasRegime
        ? "Macro regime inputs were available and assessed."
        : "The regime step did not persist enough macro evidence to explain a clean result.",
    },
    outputs: {
      outcomeExplanation,
      riskMode: input.regime?.riskMode ?? null,
      rateTrend: input.regime?.rateTrend ?? null,
      dollarTrend: input.regime?.dollarTrend ?? null,
      volatilityBackdrop: input.regime?.vixLevel ?? null,
      sectorLeadership: input.regime?.sectorLeadership ?? null,
      regimeSummary: input.regime?.summary ?? null,
      emptyResultReason: hasRegime ? null : "The step did not persist a usable regime summary for this run.",
    },
    warnings: hasRegime
      ? []
      : buildDiagnosticsWarnings([["market_regime_unavailable", "Market regime detection did not persist a usable summary for this run.", "warning"]]),
  };
}

function buildSentimentDiagnostics(input: {
  allTickers?: string[];
  scoredSignals: any[];
  sentimentOverlay?: any[];
  topSentimentSignals: Array<Record<string, unknown>>;
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics"> {
  const allTickers = Array.isArray(input.allTickers) ? input.allTickers : [];
  const overlayCount = Array.isArray(input.sentimentOverlay) ? input.sentimentOverlay.length : 0;
  const hasCoverage = allTickers.length > 0;
  const hasSignals = input.scoredSignals.length > 0 || overlayCount > 0;
  const outcomeExplanation = hasSignals
    ? `${input.scoredSignals.length} ticker(s) produced non-zero sentiment signals and ${overlayCount} overlay adjustment(s) were recorded.`
    : hasCoverage
      ? "Sentiment scoring ran but did not find any non-zero signals worth surfacing in this run."
      : "Sentiment scoring context was incomplete, so the empty result may reflect degraded telemetry.";

  return {
    status: hasSignals ? "ok" : hasCoverage ? "ok" : "warning",
    summary: outcomeExplanation,
    inputs: {
      tickersScored: hasCoverage ? allTickers : null,
      scoringScope: hasCoverage
        ? `${allTickers.length} analyzed ticker(s) were eligible for sentiment scoring.`
        : "The run did not persist enough ticker scope to describe sentiment coverage fully.",
    },
    outputs: {
      outcomeExplanation,
      scoredTickerCount: input.scoredSignals.length,
      overlayTickerCount: overlayCount,
      strongestSignals: input.topSentimentSignals,
      overlaySummary: overlayCount > 0
        ? `${overlayCount} ticker(s) received a sentiment overlay adjustment.`
        : hasCoverage
          ? "Sentiment scoring ran but no overlay adjustments were needed."
          : "No overlay output was available because sentiment coverage details were incomplete.",
      emptyResultReason: hasSignals
        ? null
        : hasCoverage
          ? "The step ran and found no non-zero sentiment signals worth surfacing."
          : "The step did not persist enough coverage context to explain the empty sentiment result.",
    },
    metrics: buildDiagnosticsMetrics([
      ["scored_tickers", "Scored Tickers", input.scoredSignals.length],
      ["overlay_tickers", "Overlay Tickers", overlayCount],
      ["eligible_tickers", "Eligible Tickers", hasCoverage ? allTickers.length : null],
    ]),
    warnings: hasCoverage
      ? []
      : buildDiagnosticsWarnings([["sentiment_scope_incomplete", "Sentiment scoring scope was incomplete, so the empty result may reflect degraded telemetry.", "warning"]]),
  };
}

function buildValidationDiagnostics(input: {
  outcome: RunDiagnosticsArtifact["outcome"];
  evidencePacketId: string | null;
  recommendationCount: number;
  validationSummary: {
    hardErrorCount: number;
    warningCount: number;
    reasonCodes: string[];
  };
}): Pick<DiagnosticsStepContract, "status" | "summary" | "inputs" | "outputs" | "warnings" | "metrics"> {
  const finalizationSummary = buildValidationSummaryText(input.validationSummary);
  return {
    status: input.validationSummary.hardErrorCount > 0
      ? "error"
      : input.validationSummary.warningCount > 0
        ? "warning"
        : "ok",
    summary: finalizationSummary,
    inputs: {
      finalOutcome: input.outcome,
      recommendationRowsEvaluated: input.recommendationCount,
      evidencePacketReady: Boolean(input.evidencePacketId),
      finalizationScope: "The finalized bundle payload, recommendation rows, and validation summary were checked before persistence.",
    },
    outputs: {
      finalizationSummary,
      hardErrorCount: input.validationSummary.hardErrorCount,
      warningCount: input.validationSummary.warningCount,
      reasonCodes: input.validationSummary.reasonCodes,
      emptyResultReason: input.validationSummary.hardErrorCount === 0 && input.validationSummary.warningCount === 0
        ? "Validation completed cleanly and produced no warning codes."
        : null,
    },
    metrics: buildDiagnosticsMetrics([
      ["hard_error_count", "Hard Errors", input.validationSummary.hardErrorCount],
      ["warning_count", "Warnings", input.validationSummary.warningCount],
    ]),
    warnings: (input.validationSummary.reasonCodes ?? []).map((code) => ({
      warningId: "",
      code,
      message: code,
      severity: input.validationSummary.hardErrorCount > 0 ? "error" as const : "warning" as const,
    })),
  };
}

function buildValidationSummaryText(validationSummary: {
  hardErrorCount: number;
  warningCount: number;
  reasonCodes: string[];
}): string {
  if (validationSummary.hardErrorCount > 0) {
    return `Validation recorded ${validationSummary.hardErrorCount} hard error(s).`;
  }

  if (validationSummary.warningCount > 0) {
    return `Validation completed with ${validationSummary.warningCount} warning(s).`;
  }

  return "Validation and finalization completed without hard errors or warnings.";
}

export function buildRunDiagnosticsArtifact(input: {
  bundleId: string;
  runId: string;
  outcome: RunDiagnosticsArtifact["outcome"];
  generatedAt: string;
  evidencePacketId: string | null;
  evidenceHash: string | null;
  promptHash: string | null;
  versions: {
    schemaVersion: string | null;
    analysisPolicyVersion: string | null;
    viewModelVersion: string | null;
    promptVersion?: string | null;
  };
  primaryModel: string | null;
  responseHash: string | null;
  usingFallbackNews?: boolean;
  regime?: any;
  gapReport?: any;
  macroEnvironment?: MacroNewsEnvironmentResult | null;
  macroConsensus?: MacroThemeConsensusResult | null;
  macroBridge?: MacroExposureBridgeResult | null;
  environmentalGaps?: EnvironmentalGap[] | null;
  candidateSearchLanes?: CandidateSearchLane[] | null;
  candidates?: any[];
  newsResult?: any;
  sentimentSignals?: Map<string, any>;
  sentimentOverlay?: any[];
  reportData?: any;
  validationSummary: {
    hardErrorCount: number;
    warningCount: number;
    reasonCodes: string[];
  };
  adjudicatorNotes?: Record<string, unknown>;
  perSectionChars?: Record<string, unknown>;
  totalInputChars?: number | null;
  contextBudget?: Stage3ContextBudgetSummary | null;
  fullPromptPreflight?: Stage3FullPromptPreflightSummary | null;
  sources?: Array<Record<string, unknown>>;
  existingHoldingsCount?: number | null;
  allTickers?: string[];
}): RunDiagnosticsArtifact {
  const context = {
    evidenceHash: input.evidenceHash,
    promptHash: input.promptHash,
    schemaVersion: input.versions.schemaVersion,
    analysisPolicyVersion: input.versions.analysisPolicyVersion,
    viewModelVersion: input.versions.viewModelVersion,
  };
  const sourceRefs: DiagnosticsSourceRefContract[] = (input.sources ?? input.newsResult?.allSources ?? []).map((source: any) => ({
    title: source?.title ?? source?.source ?? "Untitled source",
    url: source?.url ?? null,
    source: source?.source ?? null,
    publishedAt: source?.publishedAt ?? null,
  }));
  const scoredSignals = Array.from(input.sentimentSignals?.values?.() ?? []).filter((signal: any) =>
    (signal?.finbertScore ?? 0) !== 0 || (signal?.fingptScore ?? 0) !== 0
  );
  const scoredSignalsWithTicker = scoredSignals.map((signal: any) => ({
    ticker: signal?.ticker ?? signal?.symbol ?? null,
    ...signal,
  }));
  const recommendationCount = Array.isArray(input.reportData?.recommendations)
    ? input.reportData.recommendations.length
    : 0;
  const watchlistIdeas = Array.isArray(input.reportData?.watchlistIdeas)
    ? input.reportData.watchlistIdeas
    : [];
  const recommendationRows = Array.isArray(input.reportData?.recommendations)
    ? input.reportData.recommendations
    : [];
  const contextSections = summarizeContextSections(input.perSectionChars ?? null);
  const candidateRows = Array.isArray(input.candidates) ? input.candidates : [];
  const allTickers = Array.isArray(input.allTickers) ? input.allTickers : [];
  const existingHoldingsCount = input.existingHoldingsCount ?? null;
  const topSentimentSignals = summarizeTopSentimentSignals(scoredSignalsWithTicker, input.sentimentOverlay ?? []);
  const validationWarnings = (input.validationSummary.reasonCodes ?? []).map((code) => ({
    code,
    message: code,
    severity: input.validationSummary.hardErrorCount > 0 ? "error" as const : "warning" as const,
  }));

  const marketRegimeDiagnostics = buildMarketRegimeDiagnostics({
    generatedAt: input.generatedAt,
    regime: input.regime,
  });
  const gapScanDiagnostics = buildGapScanDiagnostics({
    gapReport: input.gapReport,
    existingHoldingsCount,
  });
  const macroNewsDiagnostics = buildMacroNewsCollectionDiagnostics({
    macroEnvironment: input.macroEnvironment,
  });
  const macroConsensusDiagnostics = buildMacroThemeConsensusDiagnostics({
    macroConsensus: input.macroConsensus,
  });
  const macroBridgeDiagnostics = buildMacroExposureBridgeDiagnostics({
    macroBridge: input.macroBridge,
  });
  const environmentalGapDiagnostics = buildEnvironmentalGapDiagnostics({
    environmentalGaps: input.environmentalGaps,
  });
  const macroLaneDiagnostics = buildMacroCandidateLaneDiagnostics({
    candidateSearchLanes: input.candidateSearchLanes,
  });
  const candidateScreeningDiagnostics = buildCandidateScreeningDiagnostics({
    candidates: candidateRows,
    existingHoldingsCount,
    allTickers,
    gapReport: input.gapReport,
  });
  const newsSourceDiagnostics = buildNewsSourceDiagnostics({
    allTickers,
    usingFallbackNews: input.usingFallbackNews,
    newsResult: input.newsResult,
    sourceRefs,
  });
  const sentimentDiagnostics = buildSentimentDiagnostics({
    allTickers,
    scoredSignals,
    sentimentOverlay: input.sentimentOverlay,
    topSentimentSignals,
  });
  const reasoningDiagnostics = buildReasoningDiagnostics({
    recommendationRows,
    watchlistIdeas,
    totalInputChars: input.totalInputChars ?? null,
    contextSections,
    contextBudget: input.contextBudget ?? null,
    fullPromptPreflight: input.fullPromptPreflight ?? null,
    adjudicatorNotes: input.adjudicatorNotes,
    allTickers,
    reportData: input.reportData,
    outcome: input.outcome,
  });
  const validationDiagnostics = buildValidationDiagnostics({
    outcome: input.outcome,
    evidencePacketId: input.evidencePacketId,
    recommendationCount,
    validationSummary: input.validationSummary,
  });

  const steps: DiagnosticsStepContract[] = [
    {
      ...buildStepBase(
        {
          stepKey: "market_regime",
          stepName: "Market Regime",
          status: marketRegimeDiagnostics.status,
          summary: marketRegimeDiagnostics.summary,
        },
        context
      ),
      inputs: marketRegimeDiagnostics.inputs,
      outputs: marketRegimeDiagnostics.outputs,
      warnings: marketRegimeDiagnostics.warnings,
    },
    {
      ...buildStepBase(
        {
          stepKey: "gap_scan",
          stepName: "Portfolio Gap Scan",
          status: gapScanDiagnostics.status,
          summary: gapScanDiagnostics.summary,
        },
        context
      ),
      inputs: gapScanDiagnostics.inputs,
      outputs: gapScanDiagnostics.outputs,
      metrics: gapScanDiagnostics.metrics,
      warnings: gapScanDiagnostics.warnings,
    },
    {
      ...buildStepBase(
        {
          stepKey: "macro_news_collection",
          stepName: "Macro-News Collection",
          status: macroNewsDiagnostics.status,
          summary: macroNewsDiagnostics.summary,
        },
        context
      ),
      inputs: macroNewsDiagnostics.inputs,
      outputs: macroNewsDiagnostics.outputs,
      metrics: macroNewsDiagnostics.metrics,
      warnings: macroNewsDiagnostics.warnings,
      sources: macroNewsDiagnostics.sources,
    },
    {
      ...buildStepBase(
        {
          stepKey: "macro_theme_consensus",
          stepName: "Macro Theme Consensus",
          status: macroConsensusDiagnostics.status,
          summary: macroConsensusDiagnostics.summary,
        },
        context
      ),
      inputs: macroConsensusDiagnostics.inputs,
      outputs: macroConsensusDiagnostics.outputs,
      metrics: macroConsensusDiagnostics.metrics,
      warnings: macroConsensusDiagnostics.warnings,
    },
    {
      ...buildStepBase(
        {
          stepKey: "macro_exposure_bridge",
          stepName: "Macro Exposure Bridge",
          status: macroBridgeDiagnostics.status,
          summary: macroBridgeDiagnostics.summary,
        },
        context
      ),
      inputs: macroBridgeDiagnostics.inputs,
      outputs: macroBridgeDiagnostics.outputs,
      metrics: macroBridgeDiagnostics.metrics,
      warnings: macroBridgeDiagnostics.warnings,
    },
    {
      ...buildStepBase(
        {
          stepKey: "environmental_gaps",
          stepName: "Environmental Gaps",
          status: environmentalGapDiagnostics.status,
          summary: environmentalGapDiagnostics.summary,
        },
        context
      ),
      inputs: environmentalGapDiagnostics.inputs,
      outputs: environmentalGapDiagnostics.outputs,
      metrics: environmentalGapDiagnostics.metrics,
      warnings: environmentalGapDiagnostics.warnings,
    },
    {
      ...buildStepBase(
        {
          stepKey: "macro_candidate_lanes",
          stepName: "Macro Candidate Lanes",
          status: macroLaneDiagnostics.status,
          summary: macroLaneDiagnostics.summary,
        },
        context
      ),
      inputs: macroLaneDiagnostics.inputs,
      outputs: macroLaneDiagnostics.outputs,
      metrics: macroLaneDiagnostics.metrics,
      warnings: macroLaneDiagnostics.warnings,
    },
    {
      ...buildStepBase(
        {
          stepKey: "candidate_screening",
          stepName: "Candidate Screening",
          status: candidateScreeningDiagnostics.status,
          summary: candidateScreeningDiagnostics.summary,
        },
        context
      ),
      inputs: candidateScreeningDiagnostics.inputs,
      outputs: candidateScreeningDiagnostics.outputs,
      metrics: candidateScreeningDiagnostics.metrics,
      warnings: candidateScreeningDiagnostics.warnings,
    },
    {
      ...buildStepBase(
        {
          stepKey: "news_sources",
          stepName: "News & Event Sources",
          status: newsSourceDiagnostics.status,
          summary: newsSourceDiagnostics.summary,
        },
        context
      ),
      inputs: newsSourceDiagnostics.inputs,
      outputs: newsSourceDiagnostics.outputs,
      metrics: newsSourceDiagnostics.metrics,
      sources: newsSourceDiagnostics.sources,
      warnings: newsSourceDiagnostics.warnings,
    },
    {
      ...buildStepBase(
        {
          stepKey: "sentiment",
          stepName: "FinBERT / Sentiment",
          status: sentimentDiagnostics.status,
          summary: sentimentDiagnostics.summary,
        },
        context
      ),
      inputs: sentimentDiagnostics.inputs,
      outputs: sentimentDiagnostics.outputs,
      metrics: sentimentDiagnostics.metrics,
      warnings: sentimentDiagnostics.warnings,
    },
    {
      ...buildStepBase(
        {
          stepKey: "gpt5_reasoning",
          stepName: "GPT-5 Reasoning",
          status: reasoningDiagnostics.status,
          summary: reasoningDiagnostics.summary,
        },
        context
      ),
      inputs: reasoningDiagnostics.inputs,
      outputs: reasoningDiagnostics.outputs,
      metrics: reasoningDiagnostics.metrics,
      warnings: reasoningDiagnostics.warnings,
      model: {
        name: input.primaryModel,
        promptVersion: input.versions.promptVersion ?? input.promptHash,
        responseHash: input.responseHash,
      },
    },
    {
      ...buildStepBase(
        {
          stepKey: "validation_finalization",
          stepName: "Validation & Finalization",
          status: validationDiagnostics.status,
          summary: validationDiagnostics.summary,
        },
        context
      ),
      inputs: validationDiagnostics.inputs,
      outputs: validationDiagnostics.outputs,
      metrics: validationDiagnostics.metrics,
      warnings: validationDiagnostics.warnings,
      model: {
        name: input.primaryModel,
        promptVersion: input.versions.promptVersion ?? input.promptHash,
        responseHash: input.responseHash,
      },
    },
  ];

  const stepsWithSections = steps.map((step) =>
    ensureStepSections(step, {
      inputs: "No explicit input telemetry was captured for this step in this run.",
      outputs: "No explicit output summary was captured for this step in this run.",
    })
  );

  return {
    bundleId: input.bundleId,
    runId: input.runId,
    outcome: input.outcome,
    generatedAt: input.generatedAt,
    evidencePacketId: input.evidencePacketId,
    steps: stepsWithSections,
  };
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function runFullAnalysis(
  snapshotId: string,
  customPrompt: string | undefined,
  emit: (e: ProgressEvent) => void,
  triggerType: "manual" | "scheduled" | "debug" = "manual",
  triggeredBy?: string,
  existingRunId?: string
): Promise<{ runId: string; reportId: string; alertLevel: string; alertReason: string | null; changes: any[]; report: any }> {
  const t0 = Date.now();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY");

  const hfKey = process.env.HUGGINGFACE_API_KEY ?? null;
  const openai = new OpenAI({ apiKey });

  // W23: Circuit breaker — fast fail before burning time on all stages
  emit({ type: "log", message: "Checking API connectivity...", level: "info" });
  await checkApiConnectivity(openai);
  emit({ type: "log", message: "API connectivity confirmed", level: "info" });

  // ── Load snapshot + user data ───────────────────────────────────────────────
  const snapshot = await prisma.portfolioSnapshot.findUnique({
    where: { id: snapshotId },
    include: { holdings: true },
  });
  if (!snapshot) throw new Error("Snapshot not found");

  // N6: Empty portfolio guard
  if (snapshot.holdings.length === 0) {
    throw new Error("Cannot run analysis: Portfolio snapshot has no holdings. Please add positions first.");
  }

  // N2: Stale data guard (warn if > 7 days old)
  const ageDays = (Date.now() - snapshot.createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > 7) {
    emit({ type: "log", message: `WARNING: Analyzing a snapshot that is ${Math.round(ageDays)} days old. Prices and weights may be stale.`, level: "warn" });
  }

  // N3: Concurrent run lock (prevent double-execution) — F8: use "running" not "processing"
  const activeRuns = await prisma.analysisRun.count({
    where: { userId: snapshot.userId, status: "running" }
  });
  if (activeRuns > 0) {
    throw new Error("An analysis run is already in progress for this user. Please wait for it to complete.");
  }

  const user = await prisma.user.findUnique({
    where: { id: snapshot.userId },
    include: { profile: true, convictions: { include: { messages: { orderBy: { createdAt: "asc" } } } } },
  });
  if (!user?.profile) throw new Error("User profile not found");

  const settingsObj = await prisma.appSettings.findUnique({ where: { key: "portfolio_config" } });
  const settings = settingsObj ? JSON.parse(settingsObj.value) : {};

  // F5: Scope latestReport to current user to prevent cross-user email data leaks
  const latestReport = await prisma.portfolioReport.findFirst({
    where: { userId: snapshot.userId },
    orderBy: { createdAt: "desc" },
    include: { recommendations: true },
  });

  // Batch 5: Create "running" AnalysisRun record BEFORE any LLM call.
  // This enables: (1) rollback if GPT-5 fails, (2) AbstainResult persistence.
  const stagingRun = existingRunId
    ? await prisma.analysisRun.findUnique({ where: { id: existingRunId } })
    : await prisma.analysisRun.create({
        data: {
          userId: snapshot.userId,
          snapshotId: snapshot.id,
          triggerType,
          triggeredBy: triggeredBy || "User",
          status: "running",
          startedAt: new Date(t0),
        },
      });
  if (!stagingRun) throw new Error("Failed to create staging AnalysisRun record");
  const runId = stagingRun.id;
  let finalizedBundleId: string | null = null;
  let promptHash: string | null = null;

  try {

  const ctx = buildResearchContext({ profile: user.profile, holdings: snapshot.holdings, priorRecommendations: latestReport?.recommendations, customPrompt });
  const today = ctx.today;
  const existingTickers = snapshot.holdings.filter(h => !h.isCash).map(h => h.ticker);
  const heldTickerSet = new Set(existingTickers.map(t => t.toUpperCase()));

  emit({ type: "log", message: `Analysis started: ${existingTickers.length} existing positions`, level: "info" });

  // ══════════════════════════════════════════════════════════════════════════════
  // STAGE 0: Market Intelligence — regime + gap + candidates
  // ══════════════════════════════════════════════════════════════════════════════
  const regime = await detectMarketRegime(openai, today, emit);
  const structuralGapReport = await runStructuralGapAnalysis(
    openai,
    ctx.holdings.map((holding) => ({ ticker: holding.ticker, currentWeight: holding.computedWeight, isCash: holding.isCash })),
    user.profile,
    today,
    emit
  );
  const macroEnvironment = await collectMacroNewsEnvironment(openai, today, emit);
  const macroConsensus = deriveMacroThemeConsensus(macroEnvironment);
  const macroBridge = applyMacroExposureBridge({
    consensus: macroConsensus,
    environment: macroEnvironment,
  });
  const environmentalGaps = deriveEnvironmentalGaps({
    holdings: ctx.holdings,
    structuralGapReport,
    profile: user.profile,
    marketRegime: regime,
    macroConsensus,
    macroBridge,
  });
  const macroCandidateSearchLanes = deriveMacroCandidateSearchLanes(environmentalGaps);
  const gapReport = freezeRunEvidenceSet({
    ...structuralGapReport,
    environmentalGaps,
    candidateSearchLanes: macroCandidateSearchLanes,
  });

  const candidates = await screenCandidates(
    openai,
    existingTickers,
    gapReport.searchBrief,
    macroCandidateSearchLanes,
    user.profile,
    today,
    emit
  );

  const candidateTickers = candidates.map(c => c.ticker);
  const allTickers = [...new Set([...existingTickers, ...candidateTickers])];
  const candidateTickerSet = new Set(candidateTickers.map(t => t.toUpperCase()));

  emit({ type: "log", message: `Total tickers to analyze: ${allTickers.length} (${existingTickers.length} held + ${candidateTickers.length} candidates)`, level: "info" });

  // ══════════════════════════════════════════════════════════════════════════════
  // STAGE 1: News + Price + Valuation + Correlation (F4: parallel)
  // ══════════════════════════════════════════════════════════════════════════════
  emit({ type: "stage_start", stage: "stage1", label: "Stage 1 · Research", detail: "News, price timelines, valuation, correlation — all parallel" });

  const [newsResult, valuations, correlationMatrix] = await Promise.all([
    fetchAllNewsWithFallback(openai, allTickers, today, (step) => {
      const labels = ["24h breaking news", "macro/geopolitical", "company-specific", "sector/regulatory"];
      emit({ type: "log", message: `News search ${step + 1}/4 complete: ${labels[step] ?? "search"}`, level: "info" });
    }),
    fetchValuationForAll(allTickers, emit),
    buildCorrelationMatrix(existingTickers, emit),
  ]);

  // F3: Populate articleMapForPrice from news results so price reactions can be assessed.
  // The map was previously left empty, meaning fetchPriceTimelines received no articles
  // and produced reactions:[] for every ticker → mktScore=0 for all sentiment signals.
  // We extract mention-lines per ticker from combined news — same logic as Stage 2 tickerArticles.
  // publishedAt approximated to current time; sufficient for verdict classification.
  const articleMapForPrice = new Map<string, { title: string; publishedAt: string }[]>();
  const newsTextForPrice = (newsResult.combinedSummary ?? "") + "\n" + (newsResult.breaking24h ?? "");
  for (const ticker of allTickers) {
    const mentionLines = newsTextForPrice
      .split("\n")
      .filter(l => l.toUpperCase().includes(ticker.toUpperCase()))
      .slice(0, 5);
    if (mentionLines.length > 0) {
      articleMapForPrice.set(ticker.toUpperCase(), mentionLines.map(l => ({
        title: l.slice(0, 120),
        // F3.1: Use a fixed mid-morning UTC timestamp instead of the runtime clock.
        // Using the current time placed articles at the moment of analysis, causing
        // react60 to look 60min into the future where no bars exist → verdict="ignored" → mktScore=0.
        // 14:30Z = 9:30 AM EST (winter) or 10:30 AM EDT (summer) — safely inside NYSE session.
        // Bars at pub+60 (10:30 AM or 11:30 AM) and pub+120 always exist for afternoon runs.
        publishedAt: `${today}T14:30:00.000Z`,
      })));
    }
  }

  const timelines = await fetchPriceTimelines(allTickers, articleMapForPrice, today, emit);

  // W24: Check if price data is globally unavailable
  const barsPresent = Array.from(timelines.values()).filter(t => t.bars.length > 0).length;
  const priceDataMissing = barsPresent < allTickers.length * 0.2; // <20% of tickers have bars
  if (priceDataMissing) {
    emit({ type: "log", message: "WARNING: <20% of tickers have price bar data — confidence scores will be degraded", level: "warn" });
  }

  emit({ type: "stage_complete", stage: "stage1", durationMs: Date.now() - t0 });

  // ══════════════════════════════════════════════════════════════════════════════
  // STAGE 2: Sentiment scoring
  // ══════════════════════════════════════════════════════════════════════════════
  // F6 + W14: Build per-ticker article map WITH day-change-pct context
  const tickerArticles = new Map<string, { title: string; text: string; publishedAt: string }[]>();
  const tickerDayPct = new Map<string, number>();

  for (const ticker of allTickers) {
    const tl = timelines.get(ticker.toUpperCase());
    if (tl?.dayChangePct !== undefined) tickerDayPct.set(ticker.toUpperCase(), tl.dayChangePct);

    const mentionLines = (newsResult.combinedSummary + "\n" + newsResult.breaking24h)
      .split("\n")
      .filter(l => l.toUpperCase().includes(ticker.toUpperCase()))
      .slice(0, 5);

    if (mentionLines.length > 0) {
      tickerArticles.set(ticker, mentionLines.map(l => ({
        title: l.slice(0, 120),
        text: l,
        publishedAt: new Date().toISOString(),
      })));
    }
  }

  const tickerReactions = new Map<string, any[]>();
  for (const [ticker, tl] of timelines) {
    tickerReactions.set(ticker, tl.reactions);
  }

  const sentimentSignals = await scoreSentimentForAll(
    tickerArticles.size > 0 ? tickerArticles : new Map(allTickers.map(t => [t, []])),
    tickerReactions,
    hfKey,
    emit,
    tickerDayPct // W14: pass day change pct for price context
  );

  // Pre-filter candidates with strongly negative sentiment
  const eliminatedCandidates = new Set<string>();
  for (const ticker of candidateTickers) {
    const sig = sentimentSignals.get(ticker);
    if (sig && sig.finalScore < -0.3 && sig.confidence > 0.5) {
      eliminatedCandidates.add(ticker.toUpperCase());
      emit({ type: "candidate_eliminated", ticker, reason: `Sentiment pre-filter: ${sig.direction} (score ${sig.finalScore.toFixed(2)})` });
    }
  }
  const activeCandidates = candidateTickers.filter(t => !eliminatedCandidates.has(t.toUpperCase()));

  // W16: Mid-run regime re-check if breaking news is substantial
  let finalRegime = regime;
  if (newsResult.breaking24h && newsResult.breaking24h.length > 300) {
    emit({ type: "log", message: "Breaking news detected — re-checking market regime against latest data...", level: "info" });
    try {
      const updatedRegime = await detectMarketRegime(openai, today, () => {});
      if (updatedRegime.riskMode !== regime.riskMode) {
        emit({ type: "log", message: `Regime shift detected mid-run: ${regime.riskMode} → ${updatedRegime.riskMode}. Using updated regime.`, level: "warn" });
        finalRegime = updatedRegime;
      }
    } catch { /* non-fatal, keep original regime */ }
  }

  emit({ type: "stage_complete", stage: "sentiment", durationMs: Date.now() - t0 });

  // ══════════════════════════════════════════════════════════════════════════════
  // STAGE 3: Freeze EvidencePacket + Primary gpt-5.4 reasoning (F1: single-model path)
  // ══════════════════════════════════════════════════════════════════════════════
  emit({ type: "stage_start", stage: "stage3", label: "Stage 3 · Primary AI Reasoning", detail: "Single gpt-5.4 call with json_schema — authoritative recommendations" });

  const frozenNewsResult = freezeRunEvidenceSet(newsResult);
  const frozenMacroEvidence = freezeRunEvidenceSet(buildFrozenMacroEvidence({
    macroEnvironment,
    macroConsensus,
    macroBridge,
    environmentalGaps,
    candidateSearchLanes: macroCandidateSearchLanes,
  }));
  const replayedMacro = replayMacroOutputsFromFrozenEvidence({
    frozenMacroEvidence,
    holdings: ctx.holdings,
    structuralGapReport,
    profile: user.profile,
    marketRegime: regime,
  });
  const frozenMacroEnvironment = freezeRunEvidenceSet(replayedMacro.macroEnvironment);
  const frozenMacroConsensus = freezeRunEvidenceSet(replayedMacro.macroConsensus);
  const frozenMacroBridge = freezeRunEvidenceSet(replayedMacro.macroBridge);
  const frozenEnvironmentalGaps = freezeRunEvidenceSet(replayedMacro.environmentalGaps);
  const frozenMacroCandidateSearchLanes = freezeRunEvidenceSet(replayedMacro.candidateSearchLanes);
  const frozenValuations = freezeRunEvidenceSet(valuations);
  const frozenCorrelationMatrix = freezeRunEvidenceSet(correlationMatrix);
  const frozenTimelines = new Map(freezeRunEvidenceSet(Array.from(timelines.entries())));
  const frozenSentimentSignals = new Map(freezeRunEvidenceSet(Array.from(sentimentSignals.entries())));
  const frozenTickerArticles = new Map(freezeRunEvidenceSet(Array.from(tickerArticles.entries())));
  const frozenFinalRegime = freezeRunEvidenceSet(finalRegime);
  const frozenBreakingText = typeof frozenNewsResult.breaking24h === "string" ? frozenNewsResult.breaking24h : "";

  const breaking24hSection = frozenBreakingText.trim()
    ? `=== ⚡ BREAKING NEWS (last 24 hours — ${today}) ===\n${guardContextLength(frozenBreakingText, 3000, "breaking")}\n=== END BREAKING NEWS ===\n\n24-HOUR WEIGHTING RULES:\n- STRONG signal: override 30-day thesis\n- MODERATE: adjust weight ±3-5%\n- NOISE: log but don't change recommendation`
    : "";

  const priceReactionSection = Array.from(frozenTimelines.values())
    .filter(tl => tl.reactions.length > 0)
    .map(tl => `${tl.ticker} (${tl.exchange}): day ${tl.dayChangePct > 0 ? "+" : ""}${tl.dayChangePct.toFixed(1)}%${tl.marketClosed ? " [MARKET CLOSED]" : ""} | reactions: ${tl.reactions.map(r => r.verdict).join(", ")}`)
    .join("\n");

  // F2: Replace directional prose ("NVDA: buy") with bounded numeric fields only.
  // Low-confidence entries (conf < 0.15) are filtered out entirely — they add noise, not signal.
  // The "buy"/"sell" label is removed; the primary model sees numeric scores it must interpret itself.
  const sentimentSection = Array.from(frozenSentimentSignals.entries())
    .filter(([, s]) => s.confidence >= 0.15 && s.magnitude >= 0.10)
    .map(([t, s]) =>
      `${t}: NLP score=${s.finalScore.toFixed(2)} | conf=${s.confidence.toFixed(2)} | mag=${s.magnitude.toFixed(2)}` +
      (s.drivingArticle ? ` (driven by: "${s.drivingArticle.slice(0, 60)}")` : "")
    )
    .join("\n");

  const candidateSection = activeCandidates.length > 0
    ? `\n=== CANDIDATE POSITIONS TO EVALUATE ===\nThese are NOT currently held. To recommend adding any:\n1. Evidence quality HIGH only\n2. Identify which existing position funds it\n3. Explain why better than increasing an existing position\n${activeCandidates.map(t => {
        const c = candidates.find(c => c.ticker === t);
        return `${t} (${c?.companyName}, $${c?.validatedPrice?.toFixed(2) ?? "?"}): via ${c?.source}${c?.discoveryLaneId ? `, lane: ${c.discoveryLaneId}` : ""}, catalyst: ${c?.catalyst ?? "none"}, reason: ${c?.reason}`;
      }).join("\n")}\n=== END CANDIDATES ===`
    : "";

  const regimeSection = `=== MARKET REGIME ===\nRisk mode: ${frozenFinalRegime.riskMode} | Rates: ${frozenFinalRegime.rateTrend} | Dollar: ${frozenFinalRegime.dollarTrend} | VIX: ${frozenFinalRegime.vixLevel}\n${frozenFinalRegime.summary}\n=== END REGIME ===`;
  const macroSummarySection = buildMacroAnalyzerSummary({
    macroEnvironment: frozenMacroEnvironment,
    macroConsensus: frozenMacroConsensus,
    macroBridge: frozenMacroBridge,
    environmentalGaps: frozenEnvironmentalGaps,
    candidateSearchLanes: frozenMacroCandidateSearchLanes,
  });

  // W19: Guard all sections against context overflow
  const newsSection = guardContextLength(frozenNewsResult.combinedSummary, 8000, "30-day news");
  const valuationSection = formatValuationSection(frozenValuations);
  const correlationSection = formatCorrelationSection(frozenCorrelationMatrix);

  const stage3ContextBudget = budgetStage3Context({
    regime: regimeSection,
    macroEnvironment: macroSummarySection,
    breaking24h: breaking24hSection,
    news30d: newsSection ? `=== RESEARCH (30-day) ===\n${newsSection}` : "",
    priceReactions: priceReactionSection ? `=== INTRADAY PRICE REACTIONS ===\n${priceReactionSection}` : "",
    sentiment: sentimentSection ? `=== SENTIMENT SIGNALS (informational only — do NOT treat as a directional vote; use as a weak prior only) ===\n${sentimentSection}` : "",
    valuation: valuationSection,
    correlation: correlationSection,
    candidates: candidateSection,
  });
  const additionalContext = stage3ContextBudget.additionalContext;
  const perSectionChars = stage3ContextBudget.perSectionChars;

  if (stage3ContextBudget.budget.trimmingApplied) {
    emit({
      type: "log",
      message: `Stage 3 context budget trimmed ${stage3ContextBudget.budget.trimmedSections.length} section(s): ${stage3ContextBudget.budget.trimmedSections.join(", ")} (${stage3ContextBudget.budget.initialTotalChars} -> ${stage3ContextBudget.budget.finalTotalChars} chars).`,
      level: "warn",
    });
  }

  if (!stage3ContextBudget.budget.fitsBudget) {
    const finalizedAt = new Date();
    const budgetPromptHash = buildPromptHash(additionalContext);
    const budgetMessage = `Stage 3 context remained ${stage3ContextBudget.budget.finalTotalChars} chars after deterministic trimming, above the ${stage3ContextBudget.budget.maxTotalChars}-char budget.`;
    const diagnosticsArtifact = buildRunDiagnosticsArtifact({
      bundleId: "pending",
      runId,
      outcome: "abstained",
      generatedAt: finalizedAt.toISOString(),
      evidencePacketId: null,
      evidenceHash: promptHash,
      promptHash,
      versions: {
        schemaVersion: TERMINAL_CONTRACT_VERSIONS.schemaVersion,
        analysisPolicyVersion: TERMINAL_CONTRACT_VERSIONS.analysisPolicyVersion,
        viewModelVersion: TERMINAL_CONTRACT_VERSIONS.viewModelVersion,
        promptVersion: promptHash,
      },
      primaryModel: "gpt-5.4",
      responseHash: null,
      usingFallbackNews: frozenNewsResult.usingFallback ?? false,
      regime: frozenFinalRegime,
      gapReport,
      macroEnvironment: frozenMacroEnvironment,
      macroConsensus: frozenMacroConsensus,
      macroBridge: frozenMacroBridge,
      environmentalGaps: frozenEnvironmentalGaps,
      candidateSearchLanes: frozenMacroCandidateSearchLanes,
      newsResult: frozenNewsResult,
      validationSummary: {
        hardErrorCount: 1,
        warningCount: 0,
        reasonCodes: ["CONTEXT_TOO_LONG"],
      },
      perSectionChars,
      totalInputChars: additionalContext.length,
      contextBudget: stage3ContextBudget.budget,
      existingHoldingsCount: existingTickers.length,
      allTickers,
      sources: (frozenNewsResult.allSources ?? []).map((source: any) => ({
        title: source.title ?? source.source ?? "Untitled",
        url: source.url ?? null,
        publishedAt: source.publishedAt ?? null,
        source: source.source ?? null,
      })),
    });

    const finalization = await finalizeAnalysisRun({
      runId,
      userId: snapshot.userId,
      snapshotId: snapshot.id,
      outcome: "abstained",
      completedAt: finalizedAt,
      reportSummary: "Analysis incomplete. No recommendations were saved.",
      reportReasoning: budgetMessage,
      recommendations: [],
      errorMessage: budgetMessage,
      profileSnapshot: user.profile as Record<string, unknown>,
      convictionsSnapshot: [],
      evidencePacket: {
        evidencePacketId: null,
        promptHash: budgetPromptHash,
        stage: "stage3",
        macroEvidence: frozenMacroEvidence,
        contextBudget: stage3ContextBudget.budget,
        diagnosticsArtifact,
      },
      evidenceHash: budgetPromptHash,
      evidenceFreshness: {
        usingFallbackNews: frozenNewsResult.usingFallback ?? false,
      },
      sourceList: [],
      versions: TERMINAL_CONTRACT_VERSIONS,
      llm: {
        primaryModel: "gpt-5.4",
        structuredScore: {},
        usage: {},
      },
      deterministic: {
        factorLedger: {},
        recommendationDecision: { outcome: "abstained" },
        positionSizing: {},
      },
      validationSummary: {
        hardErrorCount: 1,
        warningCount: 0,
        reasonCodes: ["CONTEXT_TOO_LONG"],
        debugDetailsRef: null,
      },
      abstainReasonCodes: ["CONTEXT_TOO_LONG"],
      reportViewModel: buildReportViewModel({
        bundleId: "pending",
        outcome: "abstained",
        finalizedAt: finalizedAt.toISOString(),
        summaryMessage: "Analysis incomplete. No recommendations were saved.",
        reasoning: budgetMessage,
        reasonCodes: ["CONTEXT_TOO_LONG"],
        recommendations: [],
        deliveryStatus: "not_eligible",
      }),
      emailPayload: null,
      exportPayload: { recommendations: [] },
      qualityMeta: {
        abstainReason: "CONTEXT_TOO_LONG",
        promptHash,
        usingFallbackNews: frozenNewsResult.usingFallback ?? false,
        contextBudget: stage3ContextBudget.budget,
      },
    });
    finalizedBundleId = finalization.bundleId;

    const abstainResult: AbstainResult = {
      type: "abstain",
      reason: "CONTEXT_TOO_LONG",
      stage: "stage3",
      retryCount: 0,
      runId,
      timestamp: new Date().toISOString(),
    };

    emit({ type: "log", message: `Analysis abstained before the primary model call: ${budgetMessage}`, level: "warn" });
    throw new AnalysisAbstainedError(abstainResult, budgetMessage);
  }

  // Batch 5: Build promptHash + write frozen EvidencePacket BEFORE LLM call
  promptHash = buildPromptHash(additionalContext);
  emit({ type: "log", message: `Evidence packet assembled: ${additionalContext.length} chars, hash=${promptHash}`, level: "info" });

  let evidencePacketId: string | null = null;
  try {
    evidencePacketId = await writeEvidencePacket(
      {
        snapshotId: snapshot.id,
        userId: snapshot.userId,
        runId,
        regime: frozenFinalRegime,
        newsText: stage3ContextBudget.sections.news30d,
        breaking24h: stage3ContextBudget.sections.breaking24h,
        // F2: pass structured signal map + articleTitles (replaces prior prose string)
        sentimentSignals: frozenSentimentSignals,
        articleTitles: new Map(Array.from(frozenTickerArticles.entries()).map(([t, arts]) => [t, arts.map(a => a.title)])),
        priceReactionText: stage3ContextBudget.sections.priceReactions,
        valuationText: stage3ContextBudget.sections.valuation,
        correlationText: stage3ContextBudget.sections.correlation,
        candidateText: stage3ContextBudget.sections.candidates,
        macroEvidence: frozenMacroEvidence,
        customPrompt,
        holdingCount: snapshot.holdings.filter(h => !h.isCash).length,
        candidateCount: activeCandidates.length,
        totalInputChars: additionalContext.length,
        perSectionChars,
      },
      promptHash
    );
    emit({ type: "log", message: `EvidencePacket written: id=${evidencePacketId}`, level: "info" });
  } catch (epErr: any) {
    const finalizedAt = new Date();
    const finalization = await finalizeAnalysisRun({
      runId,
      userId: snapshot.userId,
      snapshotId: snapshot.id,
      outcome: "abstained",
      completedAt: finalizedAt,
      reportSummary: "Analysis incomplete. No recommendations were saved.",
      reportReasoning: epErr?.message ?? "Evidence packet persist failed",
      recommendations: [],
      errorMessage: epErr?.message ?? "Evidence packet persist failed",
      profileSnapshot: user.profile as Record<string, unknown>,
      convictionsSnapshot: [],
      evidencePacket: {
        evidencePacketId: null,
        promptHash,
        stage: "stage3",
        macroEvidence: frozenMacroEvidence,
        contextBudget: stage3ContextBudget.budget,
        diagnosticsArtifact: buildRunDiagnosticsArtifact({
          bundleId: "pending",
          runId,
          outcome: "abstained",
          generatedAt: finalizedAt.toISOString(),
          evidencePacketId: null,
          evidenceHash: promptHash,
          promptHash,
          versions: {
            schemaVersion: TERMINAL_CONTRACT_VERSIONS.schemaVersion,
            analysisPolicyVersion: TERMINAL_CONTRACT_VERSIONS.analysisPolicyVersion,
            viewModelVersion: TERMINAL_CONTRACT_VERSIONS.viewModelVersion,
            promptVersion: promptHash,
          },
          primaryModel: "gpt-5.4",
          responseHash: null,
          usingFallbackNews: frozenNewsResult.usingFallback ?? false,
          regime: frozenFinalRegime,
          gapReport,
          macroEnvironment: frozenMacroEnvironment,
          macroConsensus: frozenMacroConsensus,
          macroBridge: frozenMacroBridge,
          environmentalGaps: frozenEnvironmentalGaps,
          candidateSearchLanes: frozenMacroCandidateSearchLanes,
          validationSummary: {
            hardErrorCount: 1,
            warningCount: 0,
            reasonCodes: ["evidence_packet_persist_failed"],
          },
          perSectionChars,
          totalInputChars: additionalContext.length,
          contextBudget: stage3ContextBudget.budget,
        }),
      },
      evidenceHash: promptHash,
      evidenceFreshness: {
        usingFallbackNews: frozenNewsResult.usingFallback ?? false,
      },
      sourceList: [],
      versions: TERMINAL_CONTRACT_VERSIONS,
      llm: {
        primaryModel: "gpt-5.4",
        structuredScore: {},
        usage: {},
      },
      deterministic: {
        factorLedger: {},
        recommendationDecision: { outcome: "abstained" },
        positionSizing: {},
      },
      validationSummary: {
        hardErrorCount: 1,
        warningCount: 0,
        reasonCodes: ["evidence_packet_persist_failed"],
        debugDetailsRef: null,
      },
      abstainReasonCodes: ["evidence_packet_persist_failed"],
      reportViewModel: buildReportViewModel({
        bundleId: "pending",
        outcome: "abstained",
        finalizedAt: finalizedAt.toISOString(),
        summaryMessage: "Analysis incomplete. No recommendations were saved.",
        reasoning: epErr?.message ?? "Evidence packet persist failed",
        reasonCodes: ["evidence_packet_persist_failed"],
        recommendations: [],
        deliveryStatus: "not_eligible",
      }),
      emailPayload: null,
      exportPayload: { recommendations: [] },
      qualityMeta: {
        abstainReason: "evidence_packet_persist_failed",
        promptHash,
        usingFallbackNews: frozenNewsResult.usingFallback ?? false,
        contextBudget: stage3ContextBudget.budget,
      },
    });
    finalizedBundleId = finalization.bundleId;

    const abstainResult: AbstainResult = {
      type: "abstain",
      reason: "evidence_packet_persist_failed",
      stage: "stage3",
      retryCount: 0,
      runId,
      timestamp: new Date().toISOString(),
    };

    emit({ type: "log", message: `EvidencePacket write failed: ${epErr?.message}. Run marked as abstained.`, level: "error" });
    throw new AnalysisAbstainedError(abstainResult, epErr?.message);
  }

  const convictions = (user.convictions ?? []).filter(c => c.active).map(c => ({
    ticker: c.ticker,
    rationale: c.rationale,
    messages: c.messages.map(m => ({ role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
  }));

  // ── Primary gpt-5.4 call — single authoritative LLM scorer (F1 fix) ─────────
  // Direct await instead of Promise.allSettled. Errors propagate into the
  // try/catch below which runs AbstainResult persistence before re-throwing.
  let reportData: Awaited<ReturnType<typeof generatePortfolioReport>>;
  try {
    reportData = await generatePortfolioReport(
      snapshot.holdings,
      user.profile,
      settings,
      (step, customMessage) => {
        if (customMessage) {
          emit({ type: "log", message: `[Primary Engine] ${customMessage}`, level: "warn" });
        } else {
          emit({ type: "log", message: `Primary Analysis step ${step + 1}/4`, level: "info" });
        }
      },
      latestReport?.recommendations,
      customPrompt,
      convictions,
      additionalContext,
      frozenNewsResult
    );
  } catch (primaryErr: any) {
    // Q3 trace: finish_reason_length, validation_enforce_block, and generic LLM failures
    // all arrive here as thrown Errors from generatePortfolioReport / withRetry.
    const promptPreflight = primaryErr instanceof Stage3PreflightBudgetExceededError
      ? primaryErr.preflight
      : null;
    const isPreflightAbort = primaryErr instanceof Stage3PreflightBudgetExceededError;
    const isLengthAbort     = primaryErr?.message?.includes("finish_reason_length");
    const isValidationBlock = primaryErr?.message?.includes("validation_enforce_block");
    const abstainReason     = isPreflightAbort ? "STAGE3_PREFLIGHT_BUDGET_EXCEEDED"
                            : isLengthAbort    ? "CONTEXT_TOO_LONG"
                            : isValidationBlock ? "VALIDATION_HARD_ERROR"
                            :                     "LLM_FAILURE";

    if (evidencePacketId) await updateEvidencePacketOutcome(evidencePacketId, "abstained");

    const finalizedAt = new Date();
    const finalization = await finalizeAnalysisRun({
      runId,
      userId: snapshot.userId,
      snapshotId: snapshot.id,
      outcome: "abstained",
      completedAt: finalizedAt,
      reportSummary: "Analysis incomplete. No recommendations were saved.",
      reportReasoning: primaryErr?.message ?? "Analysis aborted",
      recommendations: [],
      errorMessage: primaryErr?.message ?? "Analysis aborted",
      profileSnapshot: user.profile as Record<string, unknown>,
      convictionsSnapshot: convictions as Array<Record<string, unknown>>,
      evidencePacket: {
        evidencePacketId,
        promptHash,
        stage: "stage3",
        macroEvidence: frozenMacroEvidence,
        contextBudget: stage3ContextBudget.budget,
        diagnosticsArtifact: buildRunDiagnosticsArtifact({
          bundleId: "pending",
          runId,
          outcome: "abstained",
          generatedAt: finalizedAt.toISOString(),
          evidencePacketId,
          evidenceHash: promptHash,
          promptHash,
          versions: {
            schemaVersion: TERMINAL_CONTRACT_VERSIONS.schemaVersion,
            analysisPolicyVersion: TERMINAL_CONTRACT_VERSIONS.analysisPolicyVersion,
            viewModelVersion: TERMINAL_CONTRACT_VERSIONS.viewModelVersion,
            promptVersion: promptHash,
          },
          primaryModel: "gpt-5.4",
          responseHash: null,
          usingFallbackNews: frozenNewsResult.usingFallback ?? false,
          regime: frozenFinalRegime,
          gapReport,
          macroEnvironment: frozenMacroEnvironment,
          macroConsensus: frozenMacroConsensus,
          macroBridge: frozenMacroBridge,
          environmentalGaps: frozenEnvironmentalGaps,
          candidateSearchLanes: frozenMacroCandidateSearchLanes,
          validationSummary: {
            hardErrorCount: 1,
            warningCount: 0,
            reasonCodes: [abstainReason],
          },
          perSectionChars,
          totalInputChars: additionalContext.length,
          contextBudget: stage3ContextBudget.budget,
          fullPromptPreflight: promptPreflight,
        }),
      },
      evidenceHash: promptHash,
      evidenceFreshness: {
        usingFallbackNews: frozenNewsResult.usingFallback ?? false,
      },
      sourceList: [],
      versions: TERMINAL_CONTRACT_VERSIONS,
      llm: {
        primaryModel: "gpt-5.4",
        structuredScore: {},
        usage: {},
      },
      deterministic: {
        factorLedger: {},
        recommendationDecision: { outcome: "abstained" },
        positionSizing: {},
      },
      validationSummary: {
        hardErrorCount: 1,
        warningCount: 0,
        reasonCodes: [abstainReason],
        debugDetailsRef: null,
      },
      abstainReasonCodes: [abstainReason],
      reportViewModel: buildReportViewModel({
        bundleId: "pending",
        outcome: "abstained",
        finalizedAt: finalizedAt.toISOString(),
        summaryMessage: "Analysis incomplete. No recommendations were saved.",
        reasoning: primaryErr?.message ?? "Analysis aborted",
        reasonCodes: [abstainReason],
        recommendations: [],
        deliveryStatus: "not_eligible",
      }),
      emailPayload: null,
      exportPayload: { recommendations: [] },
      qualityMeta: {
        abstainReason,
        isPreflightAbort,
        isLengthAbort,
        promptHash,
        usingFallbackNews: frozenNewsResult.usingFallback ?? false,
        contextBudget: stage3ContextBudget.budget,
        fullPromptPreflight: promptPreflight,
      },
    });
    finalizedBundleId = finalization.bundleId;

    const abstainResult: AbstainResult = {
      type: "abstain",
      reason: abstainReason,
      stage: "stage3",
      retryCount: 0,
      runId,
      timestamp: new Date().toISOString(),
    };

    emit({ type: "log", message: `Analysis abstained: ${abstainReason}. Run marked as abstained.`, level: "warn" });
    throw new AnalysisAbstainedError(abstainResult, primaryErr?.message);
  }

  // EvidencePacket outcome: "used" — primary LLM succeeded
  if (evidencePacketId) await updateEvidencePacketOutcome(evidencePacketId, "used");

  emit({ type: "stage_complete", stage: "stage3", durationMs: Date.now() - t0 });

  // ── Coverage check — log warning for any held ticker the primary engine missed ─
  const coveredTickers = new Set(reportData.recommendations.map((r: any) => r.ticker.toUpperCase()));
  const missingHeldTickers = Array.from(heldTickerSet).filter(t => t !== "CASH" && !coveredTickers.has(t));
  if (missingHeldTickers.length > 0) {
    emit({ type: "log", message: `WARNING: Primary engine missing coverage for ${missingHeldTickers.length} holdings: ${missingHeldTickers.join(", ")}.`, level: "warn" });
  }

  // ── Sentiment overlay (display-only, no voting) ───────────────────────────────
  const gpt5Roles = new Map<string, string | undefined>();
  for (const rec of reportData.recommendations) {
    gpt5Roles.set((rec as any).ticker, (rec as any).role ?? undefined);
  }

  const sentimentOverlay: SentimentOverlay[] = buildSentimentOverlay(
    allTickers,
    gpt5Roles,
    frozenSentimentSignals,
    candidateTickerSet,
    frozenFinalRegime,
    emit,
    priceDataMissing
  );

  // ── Gated o3-mini adjudicator (diagnostic notes only — F1 fix) ───────────────
  // Fires ONLY for tickers where BOTH confidence=low AND evidenceQuality=low.
  // Output: structured diagnostic notes stored in qualityMeta ONLY.
  // Never changes recommendations, never feeds back into scoring.
  const lowConfTickers = (reportData.recommendations as any[])
    .filter(r => r.confidence === "low" && r.evidenceQuality === "low")
    .map(r => r.ticker);

  let adjudicatorNotes: Record<string, AdjudicatorNote> = {};
  let adjudicatorInvoked = false;

  if (lowConfTickers.length > 0) {
    adjudicatorInvoked = true;
    emit({ type: "log", message: `Gated adjudicator: ${lowConfTickers.length} ticker(s) qualify (low conf + low evidence): ${lowConfTickers.join(", ")}`, level: "info" });
    try {
      adjudicatorNotes = await runO3Adjudicator(openai, lowConfTickers, additionalContext, today, emit);
    } catch (adjErr: any) {
      emit({ type: "log", message: `Gated adjudicator failed (non-fatal): ${adjErr?.message}`, level: "warn" });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // STAGE 5: Persist report
  // ══════════════════════════════════════════════════════════════════════════════
  emit({ type: "stage_start", stage: "stage5", label: "Stage 5 · Saving Results", detail: "Persisting report, conviction threads, analysis run record" });

  // reportData is guaranteed to be defined here — any primary LLM failure was caught
  // and re-thrown as an AbstainResult before reaching this point.

  (reportData as any)._runMeta = {
    regime: frozenFinalRegime,
    structuralGaps: gapReport.structuralGaps,
    environmentalGaps: frozenEnvironmentalGaps,
    macroCandidateSearchLanes: frozenMacroCandidateSearchLanes,
    actionableMacroThemes: frozenMacroConsensus.themes.filter((theme) => theme.actionable).map((theme) => theme.themeKey),
    candidates: candidates.map((candidate) => ({
      ticker: candidate.ticker,
      source: candidate.source,
      candidateOrigin: candidate.candidateOrigin,
      discoveryLaneId: candidate.discoveryLaneId ?? null,
    })),
    sentimentOverlay,
    correlationClusters: frozenCorrelationMatrix.clusters,
    priceDataMissing,
  };

  const changes = compareRecommendations(latestReport?.recommendations || [], reportData.recommendations as any);
  const alert = evaluateAlert(changes, reportData.recommendations as any, user.profile, null);

  const systemVerification = {
    marketRegime: {
      status: frozenFinalRegime.summary !== "Regime data unavailable." ? `${frozenFinalRegime.riskMode}, ${frozenFinalRegime.rateTrend}` : "!Unavailable",
      rationale: frozenFinalRegime.summary
    },
    gapAnalysis: {
      status: Array.isArray(gapReport.gaps) && gapReport.gaps.length > 0 ? `${gapReport.gaps.length} gaps` : "!0 gaps",
      rationale: gapReport.searchBrief || "No gaps identified based on holdings."
    },
    candidateScreening: {
      status: Array.isArray(candidates) && candidates.length > 0 ? `${candidates.length} added` : "!0 added",
      rationale: candidates.map(c => `${c.ticker} (${c.companyName}): ${c.reason}`).join("\n") || "No candidates found."
    },
    fastSearchResearch: {
      status: (frozenNewsResult.combinedSummary?.length ?? 0) > 10 || (frozenNewsResult.breaking24h?.length ?? 0) > 10 ? `${frozenNewsResult.allSources?.length ?? 0} sources` : "!0 sources",
      rationale: frozenNewsResult.statusSummary ?? ""
    },
    finbertSentiment: {
      status: Array.from(frozenSentimentSignals.values()).some(s => (s.finbertScore ?? 0) !== 0 || (s.fingptScore ?? 0) !== 0) ? `${Array.from(frozenSentimentSignals.values()).filter(s => (s.finbertScore ?? 0) !== 0 || (s.fingptScore ?? 0) !== 0).length} scored` : "!0 scored",
      rationale: ""
    },
    gpt5Strategic: {
      status: Array.isArray((reportData as any)?.recommendations) && (reportData as any).recommendations.length > 0 ? `${(reportData as any).recommendations.length} recs` : "!Failed",
      rationale: ""
    },
    // F1 fix: o3miniReasoning removed — o3 is now a gated adjudicator (diagnostic only)
    // Its notes are stored in qualityMeta.adjudicatorNotes, not in systemVerification.
    sentimentOverlay: {
      status: sentimentOverlay.length > 0 ? `${sentimentOverlay.length} tickers enriched` : "!0 tickers",
      overlay: sentimentOverlay,
    },
  };

  // Batch 5: Extract token + model telemetry from reportData._meta (set by withRetry in analyzer.ts)
  const llmMeta = (reportData as any)._meta ?? {};
  const fullPromptPreflight = llmMeta.stage3PromptPreflight ?? null;
  const modelUsed = llmMeta.modelUsed ?? "gpt-4.1";
  const inputTokens = typeof llmMeta.inputTokens === "number" ? llmMeta.inputTokens : null;
  const outputTokens = typeof llmMeta.outputTokens === "number" ? llmMeta.outputTokens : null;
  const retryCount = typeof llmMeta.retryCount === "number" ? llmMeta.retryCount : 0;
  const validationWarningCount = typeof llmMeta.validationWarningCount === "number" ? llmMeta.validationWarningCount : 0;
  const usingFallbackNews = frozenNewsResult.usingFallback ?? false;
  const finalizedAt = new Date();
  const diagnosticsArtifact = buildRunDiagnosticsArtifact({
    bundleId: "pending",
    runId,
    outcome: "validated",
    generatedAt: finalizedAt.toISOString(),
    evidencePacketId,
    evidenceHash: promptHash,
    promptHash,
    versions: {
      schemaVersion: TERMINAL_CONTRACT_VERSIONS.schemaVersion,
      analysisPolicyVersion: TERMINAL_CONTRACT_VERSIONS.analysisPolicyVersion,
      viewModelVersion: TERMINAL_CONTRACT_VERSIONS.viewModelVersion,
      promptVersion: promptHash,
    },
    primaryModel: modelUsed,
    responseHash: hashPromptPayload(reportData),
    usingFallbackNews,
    regime: frozenFinalRegime,
    gapReport,
    macroEnvironment: frozenMacroEnvironment,
    macroConsensus: frozenMacroConsensus,
    macroBridge: frozenMacroBridge,
    environmentalGaps: frozenEnvironmentalGaps,
    candidateSearchLanes: frozenMacroCandidateSearchLanes,
    candidates,
    newsResult: frozenNewsResult,
    sentimentSignals: frozenSentimentSignals,
    sentimentOverlay,
    reportData,
    validationSummary: {
      hardErrorCount: 0,
      warningCount: validationWarningCount,
      reasonCodes: [],
    },
    adjudicatorNotes,
    perSectionChars,
    totalInputChars: additionalContext.length,
    contextBudget: stage3ContextBudget.budget,
    fullPromptPreflight,
    existingHoldingsCount: existingTickers.length,
    allTickers,
    sources: (frozenNewsResult.allSources ?? []).map((source: any) => ({
      title: source.title ?? source.source ?? "Untitled",
      url: source.url ?? null,
      publishedAt: source.publishedAt ?? null,
      source: source.source ?? null,
    })),
  });
  const validatedFinalizationInput: FinalizeAnalysisRunInput = {
    runId,
    userId: snapshot.userId,
    snapshotId: snapshot.id,
    outcome: "validated",
    completedAt: finalizedAt,
    reportSummary: reportData.summary,
    reportReasoning: reportData.reasoning,
    reportMarketContext: reportData.marketContext ?? {},
    recommendations: reportData.recommendations.map((r: any) => ({
      ticker: r.ticker,
      companyName: r.companyName,
      role: r.role ?? null,
      currentShares: r.currentShares,
      currentPrice: r.currentPrice,
      targetShares: r.targetShares,
      shareDelta: r.shareDelta,
      dollarDelta: r.dollarDelta ?? 0,
      currentWeight: r.currentWeight,
      targetWeight: r.targetWeight,
      acceptableRangeLow: r.acceptableRangeLow ?? 0,
      acceptableRangeHigh: r.acceptableRangeHigh ?? 0,
      valueDelta: r.valueDelta ?? 0,
      action: r.action,
      confidence: r.confidence ?? "medium",
      positionStatus: r.positionStatus ?? "on_target",
      evidenceQuality: r.evidenceQuality ?? "medium",
      thesisSummary: r.thesisSummary ?? "",
      detailedReasoning: r.detailedReasoning ?? "",
      whyChanged: r.whyChanged ?? "",
      systemNote: r.systemNote ?? null,
      reasoningSources: r.reasoningSources ?? [],
    })),
    alertLevel: alert.level,
    alertReason: alert.reason,
    profileSnapshot: user.profile as Record<string, unknown>,
    convictionsSnapshot: convictions as Array<Record<string, unknown>>,
    evidencePacket: {
      evidencePacketId,
      promptHash,
      additionalContextLength: additionalContext.length,
      perSectionChars,
      contextBudget: stage3ContextBudget.budget,
      usingFallbackNews,
      priceDataMissing,
      regime: frozenFinalRegime,
      macroEvidence: frozenMacroEvidence,
      diagnosticsArtifact,
    },
    evidenceHash: promptHash,
    evidenceFreshness: {
      usingFallbackNews,
      priceDataMissing,
      generatedAt: finalizedAt.toISOString(),
    },
    sourceList: (frozenNewsResult.allSources ?? []).map((source: any) => ({
      title: source.title ?? source.source ?? "Untitled",
      url: source.url ?? null,
      publishedAt: source.publishedAt ?? null,
      source: source.source ?? null,
    })),
    versions: {
      ...TERMINAL_CONTRACT_VERSIONS,
      promptVersion: promptHash,
    },
    llm: {
      primaryModel: modelUsed,
      structuredScore: reportData as unknown as Record<string, unknown>,
      responseHash: hashPromptPayload(reportData),
      usage: {
        modelUsed,
        inputTokens,
        outputTokens,
        retryCount,
      },
    },
    deterministic: {
      factorLedger: {
        alertLevel: alert.level,
        alertReason: alert.reason,
        changesCount: changes.length,
      },
      recommendationDecision: {
        recommendationsCount: reportData.recommendations.length,
        watchlistIdeasCount: reportData.watchlistIdeas?.length ?? 0,
      },
      positionSizing: {
        recommendations: reportData.recommendations.map((r: any) => ({
          ticker: r.ticker,
          targetShares: r.targetShares,
          targetWeight: r.targetWeight,
        })),
      },
    },
    validationSummary: {
      hardErrorCount: 0,
      warningCount: validationWarningCount,
      reasonCodes: [],
      debugDetailsRef: evidencePacketId ?? null,
    },
    reportViewModel: buildReportViewModel({
      bundleId: "pending",
      outcome: "validated",
      finalizedAt: finalizedAt.toISOString(),
      summaryMessage: reportData.summary,
      reasoning: reportData.reasoning,
      reasonCodes: [],
      recommendations: reportData.recommendations,
      deliveryStatus: "awaiting_ack",
    }),
    emailPayload: {
      bundleId: "pending",
      generatedAt: finalizedAt.toISOString(),
      subject: `Portfolio update for ${today}`,
      html: "",
      summary: reportData.summary,
      recommendations: reportData.recommendations.map((r: any) => ({
        ticker: r.ticker,
        action: r.action,
        targetShares: r.targetShares,
        targetWeight: r.targetWeight,
        reasoning: r.thesisSummary ?? "",
      })),
    },
    exportPayload: buildExportPayload(reportData, alert.level, alert.reason),
    qualityMeta: {
      promptHash,
      usingFallbackNews,
      macroEnvironmentStatus: frozenMacroEnvironment.availabilityStatus ?? null,
      macroEnvironmentSummary: frozenMacroEnvironment.statusSummary ?? null,
      macroEnvironmentIssues: frozenMacroEnvironment.issues ?? [],
      macroConsensusSummary: frozenMacroConsensus.statusSummary ?? null,
      macroConsensusThresholds: frozenMacroConsensus.thresholds ?? null,
      actionableMacroThemes: frozenMacroConsensus.themes.filter((theme) => theme.actionable),
      macroBridgeSummary: frozenMacroBridge.statusSummary ?? null,
      macroBridgeHits: frozenMacroBridge.hits ?? [],
      environmentalGaps: frozenEnvironmentalGaps,
      macroCandidateSearchLanes: frozenMacroCandidateSearchLanes,
      frozenMacroEvidence,
      newsAvailabilityStatus: frozenNewsResult.availabilityStatus ?? null,
      newsStatusSummary: frozenNewsResult.statusSummary ?? null,
      newsIssues: frozenNewsResult.issues ?? [],
      newsSignals: frozenNewsResult.signals ?? null,
      validationWarningCount,
      perSectionChars,
      totalInputChars: additionalContext.length,
      contextBudget: stage3ContextBudget.budget,
      fullPromptPreflight,
      evidencePacketId,
      adjudicatorInvoked,
      adjudicatorTickers: Object.keys(adjudicatorNotes),
      adjudicatorNotes,
      systemVerification,
    },
    changeLogs: changes.map(c => ({
      ticker: c.ticker,
      companyName: c.companyName,
      priorAction: c.priorAction,
      newAction: c.newAction,
      priorTargetShares: c.priorTargetShares,
      newTargetShares: c.newTargetShares,
      sharesDelta: c.sharesDelta,
      deltaDollar: c.dollarDelta ?? null,
      priorWeight: c.priorWeight,
      newWeight: c.newWeight,
      deltaWeight: (c.newWeight != null && c.priorWeight != null) ? (c.newWeight - c.priorWeight) : null,
      changed: c.changed,
      changeReason: c.changeReason,
    })),
  };

  const finalizedRun = await finalizeAnalysisRun(validatedFinalizationInput);
  finalizedBundleId = finalizedRun.bundleId;
  const report = { id: finalizedRun.reportId! };

  // Non-blocking model performance tracking (o3 removed from active pipeline)
  recordRunStats(prisma, {
    gpt5Confidence: 0.7,
    // o3Confidence intentionally omitted — o3 no longer runs on every call (F1 fix)
    divergedTickers: [],   // divergence tracking removed with dual-LLM voting
    totalTickers: allTickers.length,
  }).catch(() => {});

  // N4: Report retention pruning (non-blocking) - keep last 30 reports per user
  prisma.portfolioReport.findMany({
    where: { userId: snapshot.userId },
    orderBy: { createdAt: "desc" },
    skip: 30, // Keep 30 most recent
    select: { id: true }
  }).then(oldReports => {
    if (oldReports.length > 0) {
      const ids = oldReports.map(r => r.id);
      return prisma.portfolioReport.deleteMany({ where: { id: { in: ids } } });
    }
  }).catch(() => {});

  emit({ type: "complete", reportId: report.id, totalMs: Date.now() - t0 });

  return {
    runId,
    reportId: report.id,
    alertLevel: alert.level,
    alertReason: alert.reason,
    changes,
    report: reportData,
  };
  } catch (err: any) {
    if (err instanceof AnalysisAbstainedError) {
      throw err;
    }

    await finalizeAnalysisRun({
      runId,
      userId: snapshot.userId,
      snapshotId: snapshot.id,
      outcome: "failed",
      completedAt: new Date(),
      recommendations: [],
      errorMessage: err?.message ?? "Analysis failed",
      failureCode: "UNHANDLED_EXCEPTION",
      profileSnapshot: user.profile as Record<string, unknown>,
      convictionsSnapshot: [],
      evidencePacket: {
        finalizedBundleId,
      },
      evidenceHash: promptHash ?? `run:${runId}`,
      evidenceFreshness: {},
      sourceList: [],
      versions: TERMINAL_CONTRACT_VERSIONS,
      llm: {
        primaryModel: "gpt-5.4",
        structuredScore: {},
        usage: {},
      },
      deterministic: {
        factorLedger: {},
        recommendationDecision: {},
        positionSizing: {},
      },
      validationSummary: {
        hardErrorCount: 1,
        warningCount: 0,
        reasonCodes: [],
        debugDetailsRef: null,
      },
      reportViewModel: {},
      exportPayload: {},
    });
    throw err;
  }
}

// ── Gated adjudicator types ───────────────────────────────────────────────────

/**
 * Structured diagnostic note returned by the gated o3-mini adjudicator.
 * STRICTLY non-authoritative: no action, no shares, no weights.
 * Stored in qualityMeta only.
 */
interface AdjudicatorNote {
  ticker: string;
  /** Specific risks, concerns, or uncertainties identified. */
  riskFlags: string[];
  /** Brief qualitative assessment of the confidence level. */
  confidenceAssessment: string;
  /** What could change the recommendation thesis. */
  keyUncertainty: string;
}

const TERMINAL_CONTRACT_VERSIONS = {
  analysisPolicyVersion: "v1",
  schemaVersion: "v1",
  promptVersion: "legacy-primary-prompt-v1",
  viewModelVersion: "v1",
  emailTemplateVersion: "v1",
  modelPolicyVersion: "gpt-5.4-primary-v1",
} as const;

function buildReasonCodeBadges(reasonCodes: string[]) {
  return reasonCodes.map((code) => ({
    code,
    label: code,
    tone: "warning" as const,
  }));
}

function buildReportViewModel(params: {
  bundleId: string;
  outcome: "validated" | "abstained" | "degraded";
  finalizedAt: string;
  summaryMessage: string;
  reasoning: string;
  reasonCodes: string[];
  recommendations: any[];
  deliveryStatus: "awaiting_ack" | "not_eligible";
}) {
  return {
    bundleId: params.bundleId,
    bundleOutcome: params.outcome,
    renderState: params.outcome === "validated" ? "validated_awaiting_ack" : params.outcome === "abstained" ? "abstained_summary_only" : "degraded_summary_only",
    createdAt: params.finalizedAt,
    finalizedAt: params.finalizedAt,
    summaryMessage: params.summaryMessage,
    reasoning: params.reasoning,
    reasonCodes: buildReasonCodeBadges(params.reasonCodes),
    recommendations: params.recommendations,
    deliveryStatus: params.deliveryStatus,
    isActionable: params.outcome === "validated",
    isSuperseded: false,
    historicalValidatedContextBundleId: null,
  };
}

function buildExportPayload(reportData: any, alertLevel: string | null, alertReason: string | null) {
  return {
    summary: reportData.summary ?? "",
    reasoning: reportData.reasoning ?? "",
    alertLevel,
    alertReason,
    recommendations: reportData.recommendations ?? [],
    marketContext: reportData.marketContext ?? {},
  };
}

function hashPromptPayload(value: unknown): string {
  return buildPromptHash(JSON.stringify(value));
}

// ── Gated o3-mini adjudicator (diagnostic only) ───────────────────────────────
// Called ONLY when a ticker has BOTH confidence=low AND evidenceQuality=low.
// Returns structured diagnostic notes — never recommendation-shaped output.
// never changes recommendations, never feeds back into scoring.

async function runO3Adjudicator(
  openai: any,
  tickers: string[],
  context: string,
  today: string,
  emit: (e: ProgressEvent) => void
): Promise<Record<string, AdjudicatorNote>> {
  if (tickers.length === 0) return {};

  const res = await openai.chat.completions.create({
    model: "o3-mini",
    max_completion_tokens: 1500,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "developer",
        content: "You are a risk-identification assistant. Output ONLY a JSON object. Do not provide investment advice, buy/sell recommendations, or price targets."
      },
      {
        role: "user",
        content: `Today: ${today}. The primary analysis engine flagged these tickers as having LOW confidence AND LOW evidence quality: [${tickers.join(", ")}].\n\nContext:\n${guardContextLength(context, 4000, "context")}\n\nFor each flagged ticker, identify diagnostic concerns ONLY. Output:\n{"notes":[{"ticker":"SYMBOL","riskFlags":["specific risk 1","specific risk 2"],"confidenceAssessment":"why confidence is low in one sentence","keyUncertainty":"what would change the thesis"}]}\n\nDo NOT include action, score, targetShares, or targetWeight fields. Do NOT recommend Buy/Sell/Hold.`
      }
    ],
  });

  const raw = res.choices[0]?.message?.content ?? "";
  let parsed: AdjudicatorNote[] | null = null;

  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd   = raw.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      const obj = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
      if (Array.isArray(obj.notes)) parsed = obj.notes;
    }
  } catch { /* non-fatal */ }

  if (!parsed || !Array.isArray(parsed)) {
    emit({ type: "log", message: `Adjudicator: could not parse response (len=${raw.length}). Skipping notes.`, level: "warn" });
    return {};
  }

  const result: Record<string, AdjudicatorNote> = {};
  for (const note of parsed) {
    if (typeof note.ticker !== "string") continue;
    // Enforce non-authoritative shape — strip any recommendation fields if model hallucinated them
    result[note.ticker.toUpperCase()] = {
      ticker: note.ticker.toUpperCase(),
      riskFlags:            Array.isArray(note.riskFlags) ? note.riskFlags.map(String).slice(0, 5) : [],
      confidenceAssessment: String(note.confidenceAssessment ?? "").slice(0, 200),
      keyUncertainty:       String(note.keyUncertainty      ?? "").slice(0, 200),
    };
  }

  emit({ type: "log", message: `Adjudicator notes produced for ${Object.keys(result).length} ticker(s)`, level: "info" });
  return result;
}
