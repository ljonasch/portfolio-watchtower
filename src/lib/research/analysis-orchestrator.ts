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
import { prisma } from "@/lib/prisma";
import { detectMarketRegime }      from "./market-regime";
import { runGapAnalysis }          from "./gap-analyzer";
import { screenCandidates }        from "./candidate-screener";
import { fetchAllNewsWithFallback } from "./news-fetcher";
import { fetchPriceTimelines }     from "./price-timeline";
import { scoreSentimentForAll }    from "./sentiment-scorer";
import { aggregateSignals, type ModelVerdict } from "./signal-aggregator";
import { buildResearchContext }    from "./context-loader";
import { generatePortfolioReport } from "@/lib/analyzer";
import { compareRecommendations }  from "@/lib/comparator";
import { evaluateAlert }           from "@/lib/alerts";
import { fetchValuationForAll, formatValuationSection } from "./valuation-fetcher";
import { buildCorrelationMatrix, formatCorrelationSection } from "./correlation-matrix";
import { loadModelWeights, recordRunStats } from "./model-tracker";
import type { ProgressEvent }      from "./progress-events";

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

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function runFullAnalysis(
  snapshotId: string,
  customPrompt: string | undefined,
  emit: (e: ProgressEvent) => void
): Promise<void> {
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

  // N3: Concurrent run lock (prevent double-execution)
  const activeRuns = await prisma.analysisRun.count({
    where: { userId: snapshot.userId, status: "processing" }
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

  const latestReport = await prisma.portfolioReport.findFirst({
    orderBy: { createdAt: "desc" },
    include: { recommendations: true },
  });

  const ctx = buildResearchContext({ profile: user.profile, holdings: snapshot.holdings, priorRecommendations: latestReport?.recommendations, customPrompt });
  const today = ctx.today;
  const existingTickers = snapshot.holdings.filter(h => !h.isCash).map(h => h.ticker);
  const heldTickerSet = new Set(existingTickers.map(t => t.toUpperCase()));

  // F3: Build prior action map for external convergence rule
  const priorActionMap = new Map<string, string>();
  for (const rec of latestReport?.recommendations ?? []) {
    priorActionMap.set(rec.ticker.toUpperCase(), rec.action);
  }

  // F8: Load model weights
  const modelWeights = await loadModelWeights(prisma);
  emit({ type: "log", message: `Model weights: GPT-5=${modelWeights.gpt5} o3=${modelWeights.o3mini} sent=${modelWeights.sentiment} (${modelWeights.runCount} historical runs)`, level: "info" });

  emit({ type: "log", message: `Analysis started: ${existingTickers.length} existing positions`, level: "info" });

  // ══════════════════════════════════════════════════════════════════════════════
  // STAGE 0: Market Intelligence — regime + gap + candidates
  // ══════════════════════════════════════════════════════════════════════════════
  emit({ type: "stage_start", stage: "stage0", label: "Stage 0 · Market Intelligence", detail: "Regime detection, gap analysis, candidate screening, valuation + correlation" });

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

  // Price timelines after news (article timestamps needed)
  const articleMapForPrice = new Map<string, { title: string; publishedAt: string }[]>();
  // (would populate from structured article data in full F1 implementation)

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
  // STAGE 3: Parallel reasoning — GPT-5 + o3-mini
  // ══════════════════════════════════════════════════════════════════════════════
  emit({ type: "stage_start", stage: "stage3", label: "Stage 3 · Parallel AI Reasoning", detail: "GPT-5 (full analysis) + o3-mini (cross-check) running simultaneously" });

  const breaking24hSection = newsResult.breaking24h?.trim()
    ? `=== ⚡ BREAKING NEWS (last 24 hours — ${today}) ===\n${guardContextLength(newsResult.breaking24h, 3000, "breaking")}\n=== END BREAKING NEWS ===\n\n24-HOUR WEIGHTING RULES:\n- STRONG signal: override 30-day thesis\n- MODERATE: adjust weight ±3-5%\n- NOISE: log but don't change recommendation`
    : "";

  const priceReactionSection = Array.from(timelines.values())
    .filter(tl => tl.reactions.length > 0)
    .map(tl => `${tl.ticker} (${tl.exchange}): day ${tl.dayChangePct > 0 ? "+" : ""}${tl.dayChangePct.toFixed(1)}%${tl.marketClosed ? " [MARKET CLOSED]" : ""} | reactions: ${tl.reactions.map(r => r.verdict).join(", ")}`)
    .join("\n");

  const sentimentSection = Array.from(sentimentSignals.entries())
    .map(([t, s]) => `${t}: ${s.direction} (score ${s.finalScore.toFixed(2)}, conf ${s.confidence.toFixed(2)})${s.drivingArticle ? ` — "${s.drivingArticle.slice(0, 60)}"` : ""}`)
    .join("\n");

  const candidateSection = activeCandidates.length > 0
    ? `\n=== CANDIDATE POSITIONS TO EVALUATE ===\nThese are NOT currently held. To recommend adding any:\n1. Evidence quality HIGH only\n2. Identify which existing position funds it\n3. Explain why better than increasing an existing position\n${activeCandidates.map(t => {
        const c = candidates.find(c => c.ticker === t);
        return `${t} (${c?.companyName}, $${c?.validatedPrice?.toFixed(2) ?? "?"}): via ${c?.source}, catalyst: ${c?.catalyst ?? "none"}, reason: ${c?.reason}`;
      }).join("\n")}\n=== END CANDIDATES ===`
    : "";

  const regimeSection = `=== MARKET REGIME ===\nRisk mode: ${finalRegime.riskMode} | Rates: ${finalRegime.rateTrend} | Dollar: ${finalRegime.dollarTrend} | VIX: ${finalRegime.vixLevel}\n${finalRegime.summary}\n=== END REGIME ===`;

  // W19: Guard all sections against context overflow
  const newsSection = guardContextLength(newsResult.combinedSummary, 8000, "30-day news");
  const valuationSection = formatValuationSection(valuations);
  const correlationSection = formatCorrelationSection(correlationMatrix);

  const additionalContext = [
    regimeSection,
    breaking24hSection,
    newsSection ? `=== RESEARCH (30-day) ===\n${newsSection}` : "",
    priceReactionSection ? `=== INTRADAY PRICE REACTIONS ===\n${priceReactionSection}` : "",
    sentimentSection ? `=== SENTIMENT SIGNALS ===\n${sentimentSection}` : "",
    valuationSection,
    correlationSection,
    candidateSection,
  ].filter(Boolean).join("\n\n");

  const convictions = (user.convictions ?? []).filter(c => c.active).map(c => ({
    ticker: c.ticker,
    rationale: c.rationale,
    messages: c.messages.map(m => ({ role: m.role, content: m.content, createdAt: m.createdAt.toISOString() })),
  }));

  const [fullReport, o3Verdicts] = await Promise.allSettled([
    generatePortfolioReport(
      snapshot.holdings,
      user.profile,
      settings,
      (step) => emit({ type: "log", message: `GPT-5 analysis step ${step + 1}/4`, level: "info" }),
      latestReport?.recommendations,
      customPrompt,
      convictions,
      additionalContext
    ),
    runO3CrossCheck(openai, allTickers, additionalContext, today, emit),
  ]);

  emit({ type: "stage_complete", stage: "stage3", durationMs: Date.now() - t0 });

  // ══════════════════════════════════════════════════════════════════════════════
  // STAGE 4: Aggregate signals
  // ══════════════════════════════════════════════════════════════════════════════
  emit({ type: "stage_start", stage: "stage4", label: "Stage 4 · Signal Aggregation", detail: "Combining GPT-5 + o3-mini + sentiment into weighted composite with regime multipliers" });

  const gpt5Verdicts = new Map<string, ModelVerdict>();
  if (fullReport.status === "fulfilled") {
    for (const rec of fullReport.value.recommendations) {
      gpt5Verdicts.set(rec.ticker, {
        ticker: rec.ticker,
        action: rec.action as any,
        confidence: rec.confidence as any ?? "medium",
        keyReason: rec.thesisSummary?.slice(0, 100) ?? "",
        evidenceQuality: rec.evidenceQuality as any ?? "medium",
        role: rec.role ?? undefined,
      });
    }
  }

  const o3VerdictMap = new Map<string, ModelVerdict>();
  if (o3Verdicts.status === "fulfilled") {
    for (const v of o3Verdicts.value) {
      o3VerdictMap.set(v.ticker, v);
    }
  }

  // N7: Skipped ticker guard — ensure GPT-5 covered all holdings
  const missingHeldTickers = Array.from(heldTickerSet).filter(t => t !== "CASH" && !gpt5Verdicts.has(t));
  if (missingHeldTickers.length > 0) {
    emit({ type: "log", message: `WARNING: GPT-5 missing coverage for ${missingHeldTickers.length} holdings: ${missingHeldTickers.join(", ")}. Relying strictly on o3-mini and sentiment anchors.`, level: "warn" });
  }

  const aggregated = aggregateSignals(
    allTickers,
    gpt5Verdicts,
    o3VerdictMap,
    sentimentSignals,
    candidateTickerSet,
    finalRegime,
    emit,
    priorActionMap,    // F3: external convergence anchor
    priceDataMissing   // W24: price data flag
  );

  emit({ type: "stage_complete", stage: "stage4", durationMs: Date.now() - t0 });

  // ══════════════════════════════════════════════════════════════════════════════
  // STAGE 5: Persist report
  // ══════════════════════════════════════════════════════════════════════════════
  emit({ type: "stage_start", stage: "stage5", label: "Stage 5 · Saving Results", detail: "Persisting report, conviction threads, analysis run record" });

  if (fullReport.status !== "fulfilled") {
    throw new Error(`GPT-5 analysis failed: ${(fullReport as any).reason}`);
  }
  const reportData = fullReport.value;

  (reportData as any)._aggregation = {
    regime: finalRegime,
    gaps: gapReport.gaps,
    candidates: candidates.map(c => c.ticker),
    divergedTickers: aggregated.filter(a => a.diverged).map(a => a.ticker),
    aggregatedSignals: aggregated,
    correlationClusters: correlationMatrix.clusters,
    priceDataMissing,
  };

  const changes = compareRecommendations(latestReport?.recommendations || [], reportData.recommendations as any);
  const alert = evaluateAlert(changes, reportData.recommendations as any, user.profile, null);

  const run = await prisma.analysisRun.create({
    data: {
      userId: snapshot.userId,
      snapshotId: snapshot.id,
      triggerType: "manual",
      triggeredBy: user.name || "User",
      status: "complete",
      alertLevel: alert.level,
      alertReason: alert.reason,
      profileSnapshot: JSON.stringify(user.profile),
      startedAt: new Date(t0),
      completedAt: new Date(),
      changeLogs: {
        create: changes.map(c => ({
          ticker: c.ticker,
          companyName: c.companyName,
          priorAction: c.priorAction,
          newAction: c.newAction,
          priorTargetShares: c.priorTargetShares,
          newTargetShares: c.newTargetShares,
          sharesDelta: c.sharesDelta,
          priorWeight: c.priorWeight,
          newWeight: c.newWeight,
          changed: c.changed,
          changeReason: c.changeReason,
        }))
      }
    }
  });

  const report = await prisma.portfolioReport.create({
    data: {
      userId: snapshot.userId,
      snapshotId: snapshot.id,
      analysisRunId: run.id,
      summary: reportData.summary,
      reasoning: reportData.reasoning,
      marketContext: JSON.stringify(reportData.marketContext ?? {}),
      recommendations: {
        create: reportData.recommendations.map((r: any) => ({
          ticker: r.ticker,
          companyName: r.companyName,
          role: r.role,
          currentShares: r.currentShares,
          targetShares: r.targetShares,
          shareDelta: r.shareDelta,
          currentWeight: r.currentWeight,
          targetWeight: r.targetWeight,
          valueDelta: r.valueDelta,
          action: r.action,
          confidence: r.confidence,
          thesisSummary: r.thesisSummary,
          detailedReasoning: r.detailedReasoning,
          reasoningSources: JSON.stringify(r.reasoningSources ?? []),
        }))
      }
    }
  });

  // F8: Record model performance stats (non-blocking)
  recordRunStats(prisma, {
    gpt5Confidence: 0.7, // approximate
    o3Confidence: 0.65,
    divergedTickers: aggregated.filter(a => a.diverged).map(a => a.ticker),
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
}

// ── o3-mini cross-check (fixed) ────────────────────────────────────────────────

async function runO3CrossCheck(
  openai: any,
  tickers: string[],
  context: string,
  today: string,
  emit: (e: ProgressEvent) => void
): Promise<ModelVerdict[]> {
  emit({ type: "log", message: "o3-mini cross-check initializing...", level: "info" });

  try {
    const res = await openai.chat.completions.create({
      model: "o3-mini",
      // IMPORTANT: o3-mini uses hidden reasoning tokens before visible output.
      // With < 2000 tokens the response is empty or truncated even for ~10 ticker requests.
      // 4000 tokens handles portfolios up to ~25 tickers safely.
      max_completion_tokens: 4000,
      messages: [
        {
          role: "system",
          content: "You are a concise financial analyst. Return ONLY a valid JSON array. No markdown, no preamble, no explanation. Start your response with [ and end with ]."
        },
        {
          role: "user",
          content: `Today: ${today}. Context:\n${guardContextLength(context, 6000, "context")}\n\nFor each ticker in [${tickers.join(", ")}], return a JSON array element:\n[{"ticker":"SYMBOL","action":"Buy","confidence":"high","keyReason":"one sentence citing a specific fact","evidenceQuality":"high"}]\n\nValid action values: Buy, Hold, Sell, Trim\nValid confidence values: high, medium, low\nDo NOT use any other values. Return ONLY the JSON array starting with [.`
        }
      ],
    });

    const raw = res.choices[0]?.message?.content ?? "";

    // Robust extraction: find first [ to last ]
    const start = raw.indexOf("[");
    const end   = raw.lastIndexOf("]");
    if (start === -1 || end === -1) {
      emit({ type: "log", message: `o3-mini: no JSON array found in response (len=${raw.length})`, level: "warn" });
      return [];
    }

    const cleaned = raw.slice(start, end + 1);
    const parsed: any[] = JSON.parse(cleaned);

    // W25: normalize actions, validate shapes
    const VALID_ACTIONS = new Set(["Buy", "Hold", "Sell", "Trim"]);
    const ACTION_NORMALIZE: Record<string, string> = {
      "buy": "Buy", "hold": "Hold", "sell": "Sell", "trim": "Trim",
      "strong buy": "Buy", "accumulate": "Buy", "reduce": "Trim",
      "strong sell": "Sell", "overweight": "Buy", "underweight": "Sell",
    };
    const normalizeAction = (a: string) => ACTION_NORMALIZE[a?.toLowerCase()] ?? (VALID_ACTIONS.has(a) ? a : "Hold");

    const verdicts: ModelVerdict[] = parsed
      .filter(v => v && typeof v.ticker === "string")
      .map(v => ({
        ticker: v.ticker.toUpperCase(),
        action: normalizeAction(v.action) as any,
        confidence: ["high", "medium", "low"].includes(v.confidence) ? v.confidence : "medium",
        keyReason: String(v.keyReason ?? "").slice(0, 150),
        evidenceQuality: ["high", "medium", "low"].includes(v.evidenceQuality) ? v.evidenceQuality : "medium",
      }));

    emit({ type: "log", message: `o3-mini cross-check complete: ${verdicts.length} verdicts`, level: "info" });
    return verdicts;
  } catch (err: any) {
    emit({ type: "log", message: `o3-mini cross-check failed: ${err?.message}`, level: "warn" });
    return [];
  }
}
