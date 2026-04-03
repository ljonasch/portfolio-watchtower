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
import { runGapAnalysis }          from "./gap-analyzer";
import { screenCandidates }        from "./candidate-screener";
import { fetchAllNewsWithFallback } from "./news-fetcher";
import { fetchPriceTimelines }     from "./price-timeline";
import { scoreSentimentForAll }    from "./sentiment-scorer";
import { buildSentimentOverlay, type SentimentOverlay } from "./signal-aggregator";
import { buildResearchContext }    from "./context-loader";
import { generatePortfolioReport } from "@/lib/analyzer";
import { compareRecommendations }  from "@/lib/comparator";
import { evaluateAlert }           from "@/lib/alerts";
import { fetchValuationForAll, formatValuationSection } from "./valuation-fetcher";
import { buildCorrelationMatrix, formatCorrelationSection } from "./correlation-matrix";
import { recordRunStats } from "./model-tracker";
import { finalizeAnalysisRun, type FinalizeAnalysisRunInput } from "@/lib/services/analysis-lifecycle-service";
import {
  buildPromptHash,
  buildPerSectionChars,
  writeEvidencePacket,
  updateEvidencePacketOutcome,
} from "./evidence-packet-builder";
import type { ProgressEvent }      from "./progress-events";
import { AnalysisAbstainedError, type AbstainResult } from "./types";
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
    code,
    message,
    severity,
  }));
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
  sources?: Array<Record<string, unknown>>;
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
  const recommendationCount = Array.isArray(input.reportData?.recommendations)
    ? input.reportData.recommendations.length
    : 0;
  const validationWarnings = (input.validationSummary.reasonCodes ?? []).map((code) => ({
    code,
    message: code,
    severity: input.validationSummary.hardErrorCount > 0 ? "error" as const : "warning" as const,
  }));

  const steps: DiagnosticsStepContract[] = [
    {
      ...buildStepBase(
        {
          stepKey: "market_regime",
          stepName: "Market Regime",
          status: input.regime?.summary && input.regime.summary !== "Regime data unavailable." ? "ok" : "warning",
          summary: input.regime?.summary ?? "Regime data unavailable.",
        },
        context
      ),
      inputs: {
        generatedAt: input.generatedAt,
      },
      outputs: {
        riskMode: input.regime?.riskMode ?? null,
        rateTrend: input.regime?.rateTrend ?? null,
        summary: input.regime?.summary ?? null,
      },
    },
    {
      ...buildStepBase(
        {
          stepKey: "gap_scan",
          stepName: "Portfolio Gap Scan",
          status: Array.isArray(input.gapReport?.gaps) && input.gapReport.gaps.length > 0 ? "ok" : "warning",
          summary: input.gapReport?.searchBrief ?? "No portfolio gaps were identified.",
        },
        context
      ),
      outputs: {
        gapCount: Array.isArray(input.gapReport?.gaps) ? input.gapReport.gaps.length : 0,
        topGaps: Array.isArray(input.gapReport?.gaps)
          ? input.gapReport.gaps.slice(0, 5).map((gap: any) => ({
              ticker: gap?.ticker ?? null,
              companyName: gap?.companyName ?? null,
              reason: gap?.reason ?? null,
            }))
          : [],
      },
      metrics: buildDiagnosticsMetrics([
        ["gap_count", "Gap Count", Array.isArray(input.gapReport?.gaps) ? input.gapReport.gaps.length : 0],
      ]),
    },
    {
      ...buildStepBase(
        {
          stepKey: "candidate_screening",
          stepName: "Candidate Screening",
          status: Array.isArray(input.candidates) && input.candidates.length > 0 ? "ok" : "warning",
          summary: Array.isArray(input.candidates) && input.candidates.length > 0
            ? `${input.candidates.length} candidates screened into the run.`
            : "No candidates were added during screening.",
        },
        context
      ),
      outputs: {
        candidateCount: Array.isArray(input.candidates) ? input.candidates.length : 0,
        candidates: Array.isArray(input.candidates)
          ? input.candidates.slice(0, 10).map((candidate: any) => ({
              ticker: candidate?.ticker ?? null,
              companyName: candidate?.companyName ?? null,
              reason: candidate?.reason ?? null,
            }))
          : [],
      },
      metrics: buildDiagnosticsMetrics([
        ["candidate_count", "Candidate Count", Array.isArray(input.candidates) ? input.candidates.length : 0],
      ]),
    },
    {
      ...buildStepBase(
        {
          stepKey: "news_sources",
          stepName: "News & Event Sources",
          status: sourceRefs.length > 0 ? "ok" : "warning",
          summary: sourceRefs.length > 0
            ? `${sourceRefs.length} sources collected for the run.`
            : "No news/event sources were collected for the run.",
        },
        context
      ),
      inputs: {
        usingFallbackNews: input.usingFallbackNews ?? false,
      },
      outputs: {
        breakingSummaryPresent: Boolean(input.newsResult?.breaking24h?.length),
        combinedSummaryPresent: Boolean(input.newsResult?.combinedSummary?.length),
        sourceCount: sourceRefs.length,
      },
      metrics: buildDiagnosticsMetrics([
        ["source_count", "Source Count", sourceRefs.length],
        ["breaking_items", "Breaking Items", input.newsResult?.breaking24h?.length ?? 0],
      ]),
      sources: sourceRefs,
      warnings: input.usingFallbackNews
        ? buildDiagnosticsWarnings([["fallback_news", "Fallback news path was used.", "warning"]])
        : [],
    },
    {
      ...buildStepBase(
        {
          stepKey: "sentiment",
          stepName: "FinBERT / Sentiment",
          status: scoredSignals.length > 0 ? "ok" : "warning",
          summary: scoredSignals.length > 0
            ? `${scoredSignals.length} tickers produced sentiment signals.`
            : "No non-zero sentiment signals were recorded.",
        },
        context
      ),
      outputs: {
        scoredTickerCount: scoredSignals.length,
        overlayTickerCount: Array.isArray(input.sentimentOverlay) ? input.sentimentOverlay.length : 0,
        overlay: input.sentimentOverlay ?? [],
      },
      metrics: buildDiagnosticsMetrics([
        ["scored_tickers", "Scored Tickers", scoredSignals.length],
        ["overlay_tickers", "Overlay Tickers", Array.isArray(input.sentimentOverlay) ? input.sentimentOverlay.length : 0],
      ]),
    },
    {
      ...buildStepBase(
        {
          stepKey: "gpt5_reasoning",
          stepName: "GPT-5 Reasoning",
          status: recommendationCount > 0 ? "ok" : input.outcome === "validated" ? "warning" : "not_run",
          summary: recommendationCount > 0
            ? `${recommendationCount} recommendations were produced by the final reasoning step.`
            : input.outcome === "validated"
              ? "The final reasoning step completed without recommendation rows."
              : "The final reasoning step did not complete.",
        },
        context
      ),
      inputs: {
        totalInputChars: input.totalInputChars ?? null,
        perSectionChars: input.perSectionChars ?? null,
      },
      outputs: {
        recommendationCount,
        watchlistIdeasCount: input.reportData?.watchlistIdeas?.length ?? 0,
      },
      metrics: buildDiagnosticsMetrics([
        ["recommendation_count", "Recommendations", recommendationCount],
        ["watchlist_ideas", "Watchlist Ideas", input.reportData?.watchlistIdeas?.length ?? 0],
      ]),
      warnings: Object.keys(input.adjudicatorNotes ?? {}).length > 0
        ? buildDiagnosticsWarnings([["adjudicator_invoked", "Low-confidence adjudicator notes were captured for this run.", "info"]])
        : [],
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
          status: input.validationSummary.hardErrorCount > 0
            ? "error"
            : input.validationSummary.warningCount > 0
              ? "warning"
              : "ok",
          summary: input.validationSummary.hardErrorCount > 0
            ? "Validation recorded hard errors."
            : input.validationSummary.warningCount > 0
              ? "Validation completed with warnings."
              : "Validation and finalization completed cleanly.",
        },
        context
      ),
      inputs: {
        evidencePacketId: input.evidencePacketId,
      },
      outputs: {
        hardErrorCount: input.validationSummary.hardErrorCount,
        warningCount: input.validationSummary.warningCount,
        reasonCodes: input.validationSummary.reasonCodes,
      },
      metrics: buildDiagnosticsMetrics([
        ["hard_error_count", "Hard Errors", input.validationSummary.hardErrorCount],
        ["warning_count", "Warnings", input.validationSummary.warningCount],
      ]),
      warnings: validationWarnings,
      model: {
        name: input.primaryModel,
        promptVersion: input.versions.promptVersion ?? input.promptHash,
        responseHash: input.responseHash,
      },
    },
  ];

  return {
    bundleId: input.bundleId,
    runId: input.runId,
    outcome: input.outcome,
    generatedAt: input.generatedAt,
    evidencePacketId: input.evidencePacketId,
    steps,
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
  const [regime, gapReport] = await Promise.all([
    detectMarketRegime(openai, today, emit),
    runGapAnalysis(openai, ctx.holdings.map(h => ({ ticker: h.ticker, currentWeight: h.computedWeight, isCash: h.isCash })), user.profile, today, emit),
  ]);

  const candidates = await screenCandidates(openai, existingTickers, gapReport.searchBrief, user.profile, today, emit);

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
  const frozenValuations = freezeRunEvidenceSet(valuations);
  const frozenCorrelationMatrix = freezeRunEvidenceSet(correlationMatrix);
  const frozenTimelines = new Map(freezeRunEvidenceSet(Array.from(timelines.entries())));
  const frozenSentimentSignals = new Map(freezeRunEvidenceSet(Array.from(sentimentSignals.entries())));
  const frozenTickerArticles = new Map(freezeRunEvidenceSet(Array.from(tickerArticles.entries())));
  const frozenFinalRegime = freezeRunEvidenceSet(finalRegime);

  const breaking24hSection = frozenNewsResult.breaking24h?.trim()
    ? `=== ⚡ BREAKING NEWS (last 24 hours — ${today}) ===\n${guardContextLength(frozenNewsResult.breaking24h, 3000, "breaking")}\n=== END BREAKING NEWS ===\n\n24-HOUR WEIGHTING RULES:\n- STRONG signal: override 30-day thesis\n- MODERATE: adjust weight ±3-5%\n- NOISE: log but don't change recommendation`
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
        return `${t} (${c?.companyName}, $${c?.validatedPrice?.toFixed(2) ?? "?"}): via ${c?.source}, catalyst: ${c?.catalyst ?? "none"}, reason: ${c?.reason}`;
      }).join("\n")}\n=== END CANDIDATES ===`
    : "";

  const regimeSection = `=== MARKET REGIME ===\nRisk mode: ${frozenFinalRegime.riskMode} | Rates: ${frozenFinalRegime.rateTrend} | Dollar: ${frozenFinalRegime.dollarTrend} | VIX: ${frozenFinalRegime.vixLevel}\n${frozenFinalRegime.summary}\n=== END REGIME ===`;

  // W19: Guard all sections against context overflow
  const newsSection = guardContextLength(frozenNewsResult.combinedSummary, 8000, "30-day news");
  const valuationSection = formatValuationSection(frozenValuations);
  const correlationSection = formatCorrelationSection(frozenCorrelationMatrix);

  const additionalContext = [
    regimeSection,
    breaking24hSection,
    newsSection ? `=== RESEARCH (30-day) ===\n${newsSection}` : "",
    priceReactionSection ? `=== INTRADAY PRICE REACTIONS ===\n${priceReactionSection}` : "",
    sentimentSection ? `=== SENTIMENT SIGNALS (informational only — do NOT treat as a directional vote; use as a weak prior only) ===\n${sentimentSection}` : "",
    valuationSection,
    correlationSection,
    candidateSection,
  ].filter(Boolean).join("\n\n");

  // Batch 5: Build promptHash + write frozen EvidencePacket BEFORE LLM call
  const perSectionChars = buildPerSectionChars({
    regime: regimeSection,
    breaking24h: breaking24hSection,
    news30d: newsSection,
    priceReactions: priceReactionSection,
    sentiment: sentimentSection,
    valuation: valuationSection,
    correlation: correlationSection,
    candidates: candidateSection,
  });
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
        newsText: newsSection,
        breaking24h: frozenNewsResult.breaking24h ?? "",
        // F2: pass structured signal map + articleTitles (replaces prior prose string)
        sentimentSignals: frozenSentimentSignals,
        articleTitles: new Map(Array.from(frozenTickerArticles.entries()).map(([t, arts]) => [t, arts.map(a => a.title)])),
        priceReactionText: priceReactionSection,
        valuationText: valuationSection,
        correlationText: correlationSection,
        candidateText: candidateSection,
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
          validationSummary: {
            hardErrorCount: 1,
            warningCount: 0,
            reasonCodes: ["evidence_packet_persist_failed"],
          },
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
      additionalContext
    );
  } catch (primaryErr: any) {
    // Q3 trace: finish_reason_length, validation_enforce_block, and generic LLM failures
    // all arrive here as thrown Errors from generatePortfolioReport / withRetry.
    const isLengthAbort     = primaryErr?.message?.includes("finish_reason_length");
    const isValidationBlock = primaryErr?.message?.includes("validation_enforce_block");
    const abstainReason     = isLengthAbort     ? "CONTEXT_TOO_LONG"
                            : isValidationBlock  ? "VALIDATION_HARD_ERROR"
                            :                      "LLM_FAILURE";

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
          validationSummary: {
            hardErrorCount: 1,
            warningCount: 0,
            reasonCodes: [abstainReason],
          },
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
        isLengthAbort,
        promptHash,
        usingFallbackNews: frozenNewsResult.usingFallback ?? false,
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
    gaps: gapReport.gaps,
    candidates: candidates.map(c => c.ticker),
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
      rationale: ""
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
      usingFallbackNews,
      priceDataMissing,
      regime: frozenFinalRegime,
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
      validationWarningCount,
      perSectionChars,
      totalInputChars: additionalContext.length,
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
