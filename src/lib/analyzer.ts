/**
 * analyzer.ts  — MVP 3
 * Thin orchestrator. Delegates to modular pipeline stages.
 * Public API is unchanged so scheduler.ts / route.ts need no edits.
 */

import OpenAI from "openai";
import { withRetry } from "./research/retry";
import { prisma } from "./prisma";

// Re-export types for consumers (backwards-compatible)
export type { Source } from "./research/types";
export type { PortfolioReportV3 as PortfolioReportData } from "./research/types";
export type MarketFactor = { factor: string; explanation: string; sources: { title: string; url: string }[] };
export type MarketContext = { shortTerm: MarketFactor[]; mediumTerm: MarketFactor[]; longTerm: MarketFactor[] };

import { buildResearchContext } from "./research/context-loader";
import { fetchAllNewsWithFallback } from "./research/news-fetcher";
import {
  filterToTrustedSources,
  summarizeSourceQuality,
  deduplicateSources,
} from "./research/source-ranker";
import {
  enforceSpeculativeCap,
  enforcePositionCap,
  enrichRecommendationsWithMath,
  buildPortfolioMathSummary,
  validateWeightSum,
  normalizeWeights,
} from "./research/portfolio-constructor";
import { applyLowChurnRecommendationPolicy } from "./policy/low-churn-recommendation-policy";
import { validatePortfolioReport } from "./research/recommendation-validator";
import type {
  ResearchContext,
  RecommendationV3,
  PortfolioReportV3,
  WatchlistIdeaV3,
  Source,
} from "./research/types";

export type RecommendationResult = RecommendationV3;

export function applyAntiChurnOverride(
  recommendations: RecommendationV3[],
  antichurnThresholdPct: number
): RecommendationV3[] {
  for (const rec of recommendations) {
    const weightShift = (rec.targetWeight || 0) - (rec.currentWeight || 0);
    if (
      (rec.action === "Trim" || rec.action === "Buy") &&
      Math.abs(weightShift) < antichurnThresholdPct &&
      rec.targetShares > 0 &&
      rec.currentShares > 0
    ) {
      rec.action = "Hold";
      const antiChurnNote = `Action normalized to Hold: |Δweight| ${Math.abs(weightShift).toFixed(2)}% < antichurn threshold ${antichurnThresholdPct}%.`;
      rec.systemNote = rec.systemNote
        ? `${rec.systemNote} ${antiChurnNote}`
        : antiChurnNote;
    }
  }
  return recommendations;
}

// ─── Build the structured analysis prompt ─────────────────────────────────────

function buildAnalysisPrompt(
  ctx: ResearchContext,
  newsSection: string,
  trustedSources: Source[],
  convictions: Array<{ ticker: string; rationale: string; messages?: Array<{ role: string; content: string; createdAt: string }> }>,
  usingFallback: boolean
): string {
  const {
    today, age, profile, constraints, holdings, totalValue,
    priorRecommendations, customPrompt,
  } = ctx;

  const priorRecsSection = priorRecommendations.length > 0
    ? `\n=== PRIOR RECOMMENDATIONS (Convergence Anchor) ===\nUse as your baseline. Do NOT change without specific evidence:\n${priorRecommendations.map(r =>
        `${r.ticker} | action: ${r.action} | target: ${r.targetShares}sh @ ${r.targetWeight}% | role: ${r.role ?? "unclassified"}`
      ).join("\n")}\n\nCONVERGENCE RULE: If current weight is within ±${constraints.driftTolerancePct}% of prior target AND no material news justifies a change, output action="Hold", targetShares=currentShares.\n`
    : "";

  const permittedAssetsSection = profile.permittedAssetClasses?.trim()
    ? `\n=== PERMITTED ASSET CLASSES ===\nUser ONLY permits: ${profile.permittedAssetClasses}\nNever recommend outside these classes. Exit any violating position.\n`
    : "";

  const customConstraintsSection = customPrompt?.trim()
    ? `\n=== USER OVERRIDE DIRECTIVE (ABSOLUTE LAW) ===\n${customPrompt}\n`
    : "";

  const convictionsSection = convictions.length > 0
    ? `\n=== USER CONVICTION DIALOGUES (Persistent — re-injected every run) ===
Today is ${today}. Each entry below is a running dialogue between the user and AI over multiple analysis runs.
You MUST continue the conversation for each conviction ticker in that ticker's detailedReasoning field:
1. Write your response as the next "AI" turn — do not repeat prior AI responses verbatim.
2. Reference the DATE of each prior message and note relevant world events around those dates.
3. Address the user's MOST RECENT point specifically and directly.
4. ALWAYS begin your conviction response with exactly one of these required markers (no exceptions):
   - "ACKNOWLEDGMENT:" — if you understand and partially accept the user's point
   - "COUNTERPOINT:" — if you disagree; follow with evidence current as of ${today}
   - "AGREEMENT:" — if the user's argument has fully convinced you
   These markers are REQUIRED for your response to be saved. A response without them will be silently dropped.
5. After the marker, continue with the full conviction dialogue using SHORT-TERM / MID-TERM / LONG-TERM structure.

${convictions.map(c => {
  const msgs = c.messages ?? [];
  if (msgs.length === 0) return `[${c.ticker}]\n  User (initial): "${c.rationale}"`;
  const thread = msgs.map(m => {
    const d = m.createdAt ? new Date(m.createdAt).toISOString().split("T")[0] : "unknown date";
    return `  [${d}] ${m.role === "user" ? "User" : "AI"}: "${m.content.slice(0, 600)}${m.content.length > 600 ? "..." : ""}"`;
  }).join("\n");
  return `[${c.ticker}] Thread (oldest → newest):\n${thread}\n  → [${today}] Write your next AI response now. MUST start with ACKNOWLEDGMENT:, COUNTERPOINT:, or AGREEMENT:`;
}).join("\n\n")}\n`
    : "";


  const newsQualityNote = usingFallback
    ? "\n[WARNING: Primary live news fetch failed. Using Yahoo Finance fallback only. Lower confidence. Note in summary.]\n"
    : "";

  const trustedSourceList = trustedSources.length > 0
    ? `\nVerified sources you may cite:\n${trustedSources.slice(0, 30).map(s => `- ${s.title}: ${s.url}`).join("\n")}`
    : "";

  return `You are a rigorous, evidence-disciplined portfolio manager. Today is ${today}.
${customConstraintsSection}${permittedAssetsSection}
=== A. USER PROFILE ===
Age: ${age} (birthYear: ${profile.birthYear}) | Target retirement: ${profile.targetRetirementAge ?? "Not specified"}
Employment: ${profile.employmentStatus ?? "Not specified"} — ${profile.profession ?? "Not specified"}
Income: ${profile.annualIncomeRange ?? "Not specified"} | Stability: ${profile.jobStabilityVolatility ?? "Not specified"}
Emergency fund: ${profile.emergencyFundMonths != null ? `${profile.emergencyFundMonths} months` : "Not specified"}
Risk tolerance: ${profile.trackedAccountRiskTolerance}
Objective: ${profile.trackedAccountObjective}
Style: ${profile.trackedAccountStyle ?? "Not specified"}
Time horizon: ${profile.trackedAccountTimeHorizon ?? "Not specified"}
Tax status: ${profile.trackedAccountTaxStatus ?? "Not specified"}
Leverage/options: ${profile.leverageOptionsPermitted ?? "None"}
Separate retirement: ${profile.separateRetirementAssetsAmount != null ? `$${Number(profile.separateRetirementAssetsAmount).toLocaleString()} — ${profile.separateRetirementAccountsDescription ?? ""}` : "Not specified"}
Notes: ${profile.notes ?? "None"}

=== B. BINDING PORTFOLIO CONSTRAINTS ===
Max single position: ${constraints.maxSinglePositionPct}%
Target holding count: ${constraints.targetHoldingCount}
Speculative cap (total): ${constraints.speculativeCapPct}%
Drift tolerance: ±${constraints.driftTolerancePct}%
Cash target: ~${constraints.cashTargetPct}%
Max drawdown tolerance: ${constraints.maxDrawdownTolerancePct}%
Sectors to emphasize: ${profile.sectorsToEmphasize ?? "None"}
Sectors to avoid: ${profile.sectorsToAvoid ?? "None"}

=== C. CURRENT PORTFOLIO (Total: $${totalValue.toLocaleString()}) ===
${JSON.stringify(holdings.map(h => {
  const ageDays = h.lastBoughtAt ? (new Date(today).getTime() - new Date(h.lastBoughtAt).getTime()) / (1000 * 60 * 60 * 24) : null;
  const isSTCG = ageDays !== null && ageDays < 365;
  return {
    ticker: h.ticker,
    companyName: h.companyName,
    shares: h.shares,
    currentPrice: h.currentPrice,
    computedValue: h.computedValue,
    computedWeight: h.computedWeight,
    isCash: h.isCash,
    lastBoughtAt: h.lastBoughtAt ? new Date(h.lastBoughtAt).toISOString().split("T")[0] : null,
    isShortTermCapitalGains: isSTCG,
    taxWarning: isSTCG ? "WARNING: Held < 1 year. Sell/Trim triggers short-term capital taxes." : undefined
  };
}), null, 2)}

${newsSection}${newsQualityNote}${trustedSourceList}

${priorRecsSection}${convictionsSection}
=== D. FIVE-PHASE ANALYSIS (execute in order) ===

PHASE 1 — PROFILE CONSTRAINT BINDING
State the specific constraints that bind this portfolio given the profile above.
Use ONLY what is in the profile. Do not assume anything not stated.
N9 TAX RULE: For any ticker with "isShortTermCapitalGains": true, you must demand a strictly higher evidence threshold before recommending "Sell" or "Trim" to overcome the tax penalty.

PHASE 2 — EVIDENCE QUALITY ASSESSMENT
For each ticker, privately rate your research quality before making recommendations:
- HIGH: Specific facts from named sources (earnings figures, price targets, regulatory rulings)
- MEDIUM: Relevant sector/macro context but limited company-specific data
- LOW: Inference from indirect signals; limited specific information
Use this to calibrate confidence. Express uncertainty honestly. Do not present inferences as facts.

PHASE 3 — ROLE CLASSIFICATION
Assign exactly one role per position: Core | Growth | Tactical | Hedge | Speculative | Income | Watchlist
- Speculative positions: total weight of ALL Speculative positions must stay ≤ ${constraints.speculativeCapPct}%
- Core positions: tightest drift tolerance; do not churn without major evidence
- Tactical positions: may rotate on short/medium-term events

PHASE 4 — PORTFOLIO-LEVEL CONSTRUCTION
Check before finalizing:
- Any single position approaching ${constraints.maxSinglePositionPct}%? Flag concentration.
- Sector/theme overlap (>40% in one theme)?
- Total Speculative weight ≤ ${constraints.speculativeCapPct}%?
- Cash appropriate vs. target ${constraints.cashTargetPct}%?
- Holding count near ${constraints.targetHoldingCount}?

PHASE 5 — RECOMMENDATIONS WITH ATTRIBUTION
For every position (existing + new):
- YOU MUST RETURN A RECOMMENDATION FOR EVERY SINGLE TICKER LISTED IN SECTION C! Do not skip or omit ANY existing holding. Your "recommendations" JSON array must contain at least ${holdings.length} items.
- thesisSummary: 1-2 dense, source-backed sentences. No generic statements.
- detailedReasoning: organized as SHORT-TERM (0-3mo) / MID-TERM (3-18mo) / LONG-TERM (18mo+). For conviction tickers, you MUST start the detailedReasoning with one of: "ACKNOWLEDGMENT:", "COUNTERPOINT:", or "AGREEMENT:" — this is required for the response to be saved to the dialogue thread. Without it, the user will never see your reply.
- whyChanged: MUST explain change vs prior. If no prior: state "No prior recommendation." If changed: cite specific evidence/event that drove it.
- evidenceQuality: honest — use "low" when you lack hard data, "high" only with primary sources.
- positionStatus: "underweight" | "overweight" | "on_target" vs acceptable range ±${constraints.driftTolerancePct}%

CRITICAL MATH (enforced):
1. Sum of all targetWeight values MUST equal exactly 100%
2. shareDelta = targetShares - currentShares (exact, not estimated)  
3. If you reduce one position, INCREASE another — no money disappears
4. New position: currentShares=0, currentWeight=0, action="Buy", shareDelta=targetShares
5. MATH ADJUSTMENTS: If you are making a tiny fractional share adjustment (<2% target weight shift) strictly to balance the 100% portfolio math, KEEP the action as "Hold". DO NOT label it "Trim" or "Buy". Only use "Trim" or "Buy" for deliberate, research-driven strategic changes!

SOURCE RULES:
- ONLY cite URLs from the verified list above, Yahoo Finance quote pages, or major publication homepages
- Never fabricate article URLs
- Factual claims without a cited source must be flagged as inference`;
}

// ─── JSON schema for structured output ───────────────────────────────────────

const SOURCE_SCHEMA = {
  type: "object" as const,
  properties: { title: { type: "string" as const }, url: { type: "string" as const } },
  additionalProperties: false,
  required: ["title", "url"],
};

const MARKET_FACTOR_SCHEMA = {
  type: "object" as const,
  properties: {
    factor: { type: "string" as const },
    explanation: { type: "string" as const },
    sources: { type: "array" as const, items: SOURCE_SCHEMA },
  },
  additionalProperties: false,
  required: ["factor", "explanation", "sources"],
};

const REPORT_JSON_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: { type: "string" as const },
    reasoning: { type: "string" as const },
    evidenceQualitySummary: { type: "string" as const },
    marketContext: {
      type: "object" as const,
      properties: {
        shortTerm: { type: "array" as const, items: MARKET_FACTOR_SCHEMA },
        mediumTerm: { type: "array" as const, items: MARKET_FACTOR_SCHEMA },
        longTerm: { type: "array" as const, items: MARKET_FACTOR_SCHEMA },
      },
      additionalProperties: false,
      required: ["shortTerm", "mediumTerm", "longTerm"],
    },
    recommendations: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          ticker: { type: "string" as const },
          companyName: { type: "string" as const },
          role: { type: "string" as const },
          currentShares: { type: "number" as const },
          currentPrice: { type: "number" as const },
          targetShares: { type: "number" as const },
          shareDelta: { type: "number" as const },
          dollarDelta: { type: "number" as const },
          currentWeight: { type: "number" as const },
          targetWeight: { type: "number" as const },
          acceptableRangeLow: { type: "number" as const },
          acceptableRangeHigh: { type: "number" as const },
          valueDelta: { type: "number" as const },
          action: { type: "string" as const },
          confidence: { type: "string" as const },
          positionStatus: { type: "string" as const },
          evidenceQuality: { type: "string" as const },
          thesisSummary: { type: "string" as const },
          detailedReasoning: { type: "string" as const },
          whyChanged: { type: "string" as const },
          reasoningSources: { type: "array" as const, items: SOURCE_SCHEMA },
        },
        additionalProperties: false,
        required: [
          "ticker", "companyName", "role", "currentShares", "currentPrice",
          "targetShares", "shareDelta", "dollarDelta", "currentWeight", "targetWeight",
          "acceptableRangeLow", "acceptableRangeHigh", "valueDelta", "action",
          "confidence", "positionStatus", "evidenceQuality",
          "thesisSummary", "detailedReasoning", "whyChanged", "reasoningSources",
        ],
      },
    },
    watchlistIdeas: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          ticker: { type: "string" as const },
          companyName: { type: "string" as const },
          role: { type: "string" as const },
          recommendedStarterShares: { type: "number" as const },
          recommendedStarterDollars: { type: "number" as const },
          recommendedStarterWeight: { type: "number" as const },
          wouldReduceTicker: { type: "string" as const },
          whyNow: { type: "string" as const },
          confidence: { type: "string" as const },
          profileFitReason: { type: "string" as const },
          sources: { type: "array" as const, items: SOURCE_SCHEMA },
        },
        additionalProperties: false,
        required: [
          "ticker", "companyName", "role", "recommendedStarterShares",
          "recommendedStarterDollars", "recommendedStarterWeight",
          "wouldReduceTicker", "whyNow", "confidence", "profileFitReason", "sources",
        ],
      },
    },
  },
  additionalProperties: false,
  required: ["summary", "reasoning", "evidenceQualitySummary", "marketContext", "recommendations", "watchlistIdeas"],
};

// ─── Main export (backwards-compatible signature) ─────────────────────────────

export async function generatePortfolioReport(
  // Use any[] here intentionally — callers pass Prisma Holding[] or plain objects
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  holdings: any[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settings: Record<string, any>,
  onProgress?: (step: number, customMessage?: string) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  priorRecommendations?: any[],
  customPrompt?: string,
  convictions?: Array<{ ticker: string; rationale: string; messages?: Array<{ role: string; content: string; createdAt: string }> }>,
  /** Pre-built context block from orchestrator (regime, sentiment, price reactions, candidates) */
  additionalContext?: string
): Promise<PortfolioReportV3> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in your .env file.");

  const openai = new OpenAI({ apiKey });

  // Step 1: Build research context (pure, deterministic)
  const ctx = buildResearchContext({ profile, holdings, priorRecommendations, customPrompt });

  // Step 2: Fetch live news — SKIP when orchestrator already injected additionalContext (F6: removes duplicate fetch)
  let combinedSummary = "";
  let allSources: Source[] = [];
  let usingFallback = false;
  let breaking24h = "";

  if (!additionalContext) {
    // Standalone call (no orchestrator): fetch news ourselves with 55s timeout
    const newsResult = await Promise.race([
      fetchAllNewsWithFallback(openai, ctx.holdings.map(h => h.ticker), ctx.today, onProgress),
      new Promise<{ combinedSummary: string; allSources: Source[]; usingFallback: boolean; breaking24h: string }>(
        (resolve) => setTimeout(() => resolve({ combinedSummary: "", allSources: [], usingFallback: true, breaking24h: "" }), 55000)
      ),
    ]);
    combinedSummary = newsResult.combinedSummary;
    allSources = newsResult.allSources;
    usingFallback = newsResult.usingFallback;
    breaking24h = (newsResult as any).breaking24h ?? "";
  } else {
    // Orchestrator already fetched and injected news via additionalContext — skip redundant fetch
    usingFallback = false;
  }

  // Step 3: Filter to high-quality sources, deduplicate
  const trustedSources = filterToTrustedSources(deduplicateSources(allSources));
  const sourceQuality = summarizeSourceQuality(allSources);

  // Build news section: breaking 24h block appears first with highest priority
  const breaking24hSection = breaking24h.trim()
    ? `=== ⚡ BREAKING NEWS (last 24 hours — ${ctx.today}) ===
${breaking24h}
=== END BREAKING NEWS ===

24-HOUR WEIGHTING RULES (apply to SHORT-TERM section of detailedReasoning):
- STRONG signal: override the 30-day thesis if it directly contradicts prior action. Change recommendation.
- MODERATE signal: adjust target weight ±3–5% within acceptable range. Note in whyChanged.
- NOISE signal: log it in thesisSummary but do NOT change the recommendation.
- If no breaking news exists for a ticker, state "No breaking developments" in SHORT-TERM.
=== END 24-HOUR RULES ===`
    : "";

  const thirtyDaySection = combinedSummary.trim()
    ? `=== VERIFIED CURRENT NEWS (last 30 days — ${ctx.today}) ===\n${combinedSummary.slice(0, 2000)}\n=== END CURRENT NEWS ===`
    : "";

  const newsSection = [
    breaking24hSection,
    thirtyDaySection,
  ].filter(Boolean).join("\n\n") ||
    `[NO LIVE NEWS: Primary search returned no content. Lower confidence across all company-specific recommendations. Do not fabricate news events.]`;

  // Step 4a: Dynamic max_completion_tokens (Batch 3 — replaces hardcoded value)
  // Formula: min(holdingCount × 500 + 1500, 16000)
  // 16 tickers → 9500 tokens, well above the old 6000 cap that caused abstains on large portfolios.
  // Ceiling 16000 prevents runaway cost on arbitrarily large uploads.
  const holdingCount = ctx.holdings.filter(h => !h.isCash).length;
  const dynamicMaxTokens = Math.min(holdingCount * 500 + 1500, 16000);

  // Batch 6: Read validation_enforce_block from AppSettings once before the LLM call.
  // Batch 9 / T47: Read antichurn_threshold_pct from AppSettings — NOT a hardcoded literal.
  // Default 1.5% if key is missing (backward-compatible with deployments pre-Batch-9).
  const [enforceBlockSetting, antichurnSetting] = await Promise.all([
    prisma.appSettings.findUnique({ where: { key: "validation_enforce_block" } }),
    prisma.appSettings.findUnique({ where: { key: "antichurn_threshold_pct" } }),
  ]);
  const validationEnforceBlock = enforceBlockSetting?.value === "true";
  const antichurnThresholdPct = parseFloat(antichurnSetting?.value ?? "1.5");
  const safeAntichurnThreshold = isNaN(antichurnThresholdPct) ? 1.5 : antichurnThresholdPct;

  // Step 4b: Build prompt and call LLM with single retry on JSON parse failure
  // (Replaces prohibited 8-attempt multi-model waterfall — Batch 3)
  onProgress?.(3);
  const prompt = buildAnalysisPrompt(ctx, newsSection, trustedSources, convictions ?? [], usingFallback);

  // Prepend orchestrator-provided context (regime, sentiment, price reactions, candidates)
  const fullPrompt = additionalContext
    ? `${additionalContext}\n\n${prompt}`
    : prompt;

  let response: any = null;
  let rawParsed: Partial<PortfolioReportV3> | null = null;
  let llmRetryCount = 0;  // Batch 5: track actual retry count for qualityMeta

  // Single model (gpt-4.1), 1 retry on JSON parse failure only.
  // finish_reason === "length" → hard fail immediately (AbstainResult in orchestrator).
  await withRetry<void>(
    async (attemptNumber: number) => {
      llmRetryCount = attemptNumber - 1;  // attemptNumber is 1-indexed
      const payload: any = {
        model: "gpt-5.4",
        max_completion_tokens: dynamicMaxTokens,
        response_format: {
          type: "json_schema",
          json_schema: { name: "portfolio_report_v3", strict: true, schema: REPORT_JSON_SCHEMA },
        },
        messages: [
          {
            role: "system",
            content: `You are a rigorous, evidence-disciplined portfolio analyst API.
- Never fabricate URLs. Only cite URLs from the verified list or well-known homepages.
- Express uncertainty honestly. If evidence is weak, say so and lower confidence.
- All targetWeight values MUST sum to exactly 100%.
- shareDelta must equal targetShares minus currentShares exactly.
- Every user conviction must be explicitly acknowledged and responded to.
- If you reduce one position's weight, redistribute that weight elsewhere.`,
          },
          { role: "user", content: fullPrompt },
        ],
      };

      response = await openai.chat.completions.create(payload);

      // Batch 3: finish_reason === "length" → hard fail BEFORE parse — no persist
      const finishReason = response.choices[0]?.finish_reason;
      if (finishReason === "length") {
        throw new Error(
          `finish_reason_length: Model output was truncated (max_completion_tokens=${dynamicMaxTokens}). Analysis aborted.`
        );
      }

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error(`LLM returned empty response. Finish reason: ${finishReason ?? "unknown"}`);
      }

      const cleanContent = content.replace(/```[a-z]*\n?/gi, "").replace(/```$/gi, "").trim();
      rawParsed = JSON.parse(cleanContent);
    },
    {
      maxAttempts: 2,           // Primary call + 1 retry on JSON parse failure
      backoffMs: 10000,         // 10s backoff on retry
      abortOnLengthError: true, // finish_reason=length → no retry
    }
  );

  if (!rawParsed) {
    throw new Error("Failed to generate and parse valid portfolio report JSON after retry.");
  }
  const parsedReport = rawParsed as Partial<PortfolioReportV3>;

  // Step 5: Validate and deterministically correct
  const validation = validatePortfolioReport(rawParsed, ctx.totalValue);
  if (validation.errors.length > 0) {
    // Batch 6: Hard errors present
    if (validationEnforceBlock) {
      // Enforce mode: throw immediately so the orchestrator persists AbstainResult
      const errorSummary = validation.errors.map(e => `${e.field}: ${e.message}`).join("; ");
      throw new Error(
        `validation_enforce_block: Report failed validation with ${validation.errors.length} hard error(s): ${errorSummary}`
      );
    } else {
      // Log-only mode: record errors but continue with best-effort correction
      console.warn("[analyzer] Validation errors (enforce=false, proceeding with correction):", validation.errors);
    }
  }
  if (validation.warnings.length > 0) console.warn("[analyzer] Corrected:", validation.warnings);

  let recommendations = (validation.correctedReport?.recommendations ?? []) as RecommendationV3[];

  // Step 6: Enforce caps (speculative + max position) + enrich with deterministic math
  recommendations = enforceSpeculativeCap(recommendations, ctx.constraints.speculativeCapPct);
  recommendations = enforcePositionCap(recommendations, ctx.constraints.maxSinglePositionPct);
  recommendations = enrichRecommendationsWithMath(recommendations, ctx);

  // Final weight normalization
  const { valid: finalWeightValid, sum: finalSum } = validateWeightSum(recommendations);
  if (!finalWeightValid || Math.abs(finalSum - 100) > 0.05) {
    if (Math.abs(finalSum - 100) > 0.05) console.warn(`[analyzer] Final weight sum ${finalSum}% — normalizing.`);
    recommendations = normalizeWeights(recommendations);
  }

  const applyAuthoritativeCurrentWeights = (rows: RecommendationV3[]) => {
    const holdingValueMap = new Map(ctx.holdings.map(h => [h.ticker, h.computedValue]));

    for (const rec of rows) {
      const actualValue = holdingValueMap.get(rec.ticker);
      if (actualValue !== undefined && ctx.totalValue > 0) {
        rec.currentWeight = Number(((actualValue / ctx.totalValue) * 100).toFixed(2));
      } else if (!holdingValueMap.has(rec.ticker)) {
        rec.currentShares = 0;
        rec.currentWeight = 0;
        if (!rec.shareDelta || rec.shareDelta === 0) rec.shareDelta = rec.targetShares;
      }
    }
  };

  // Fix currentWeight for all holdings using authoritative snapshot values
  applyAuthoritativeCurrentWeights(recommendations);

  // Deterministic Anti-Churn Override:
  // T47: threshold is read from AppSettings at runtime (antichurn_threshold_pct), not a literal.
  // Default 1.5%. If the model labeled Trim/Buy just to fractionally balance < threshold, override to Hold.
  recommendations = applyAntiChurnOverride(recommendations, safeAntichurnThreshold);

  const lowChurnResult = applyLowChurnRecommendationPolicy(recommendations, ctx, safeAntichurnThreshold);
  recommendations = lowChurnResult.recommendations;

  const { valid: postPolicyWeightValid, sum: postPolicyWeightSum } = validateWeightSum(recommendations);
  if (!postPolicyWeightValid || Math.abs(postPolicyWeightSum - 100) > 0.05) {
    if (Math.abs(postPolicyWeightSum - 100) > 0.05) {
      console.warn(`[analyzer] Low-churn policy left weight sum at ${postPolicyWeightSum}% — normalizing through the existing balance path.`);
    }
    recommendations = normalizeWeights(recommendations);
  }

  applyAuthoritativeCurrentWeights(recommendations);
  recommendations = enrichRecommendationsWithMath(recommendations, ctx).map((rec) => ({
    ...rec,
    valueDelta: rec.dollarDelta,
  }));

  const portfolioMath = buildPortfolioMathSummary(recommendations, ctx);

  const report: PortfolioReportV3 = {
    summary: parsedReport.summary ?? "",
    reasoning: parsedReport.reasoning ?? "",
    evidenceQualitySummary: parsedReport.evidenceQualitySummary ?? "",
    marketContext: parsedReport.marketContext ?? { shortTerm: [], mediumTerm: [], longTerm: [] },
    portfolioMath,
    recommendations,
    watchlistIdeas: (parsedReport.watchlistIdeas ?? []) as WatchlistIdeaV3[],
  };

  // Attach metadata for scheduler to persist (Batch 5: added model telemetry)
  (report as any)._meta = {
    sourceQualitySummary: sourceQuality,
    frozenProfileJson: ctx.frozenProfileJson,
    usingFallback,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
    lowChurnPolicy: lowChurnResult.meta,
    // Batch 5: token telemetry wired from OpenAI response.usage
    modelUsed: response?.model ?? "gpt-4.1",
    inputTokens: response?.usage?.prompt_tokens ?? null,
    outputTokens: response?.usage?.completion_tokens ?? null,
    retryCount: llmRetryCount,
    validationWarningCount: validation.warnings.length,
  };

  return report;
}
