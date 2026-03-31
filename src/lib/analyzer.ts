/**
 * analyzer.ts  — MVP 3
 * Thin orchestrator. Delegates to modular pipeline stages.
 * Public API is unchanged so scheduler.ts / route.ts need no edits.
 */

import OpenAI from "openai";

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
  enrichRecommendationsWithMath,
  buildPortfolioMathSummary,
  validateWeightSum,
  normalizeWeights,
} from "./research/portfolio-constructor";
import { validatePortfolioReport } from "./research/recommendation-validator";
import type {
  ResearchContext,
  RecommendationV3,
  PortfolioReportV3,
  WatchlistIdeaV3,
  Source,
} from "./research/types";

export type RecommendationResult = RecommendationV3;

// ─── Build the structured analysis prompt ─────────────────────────────────────

function buildAnalysisPrompt(
  ctx: ResearchContext,
  newsSection: string,
  trustedSources: Source[],
  convictions: Array<{ ticker: string; rationale: string }>,
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
    ? `\n=== USER CONVICTION NOTES (Persistent — re-injected every run) ===\nThe user has provided explicit reasons for their position in the following tickers.\nYou MUST address each conviction in its recommendation:\n1. Acknowledge the user's stated reasoning under "ACKNOWLEDGMENT:" in detailedReasoning.\n2. Incorporate it into sizing if the logic is sound.\n3. If you disagree, state specific counterpoints under "COUNTERPOINT:" with evidence.\n4. Never silently ignore a conviction.\n\n${convictions.map(c => `[${c.ticker}] User conviction: "${c.rationale}"`).join("\n")}\n`
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
${JSON.stringify(holdings.map(h => ({
  ticker: h.ticker,
  companyName: h.companyName,
  shares: h.shares,
  currentPrice: h.currentPrice,
  computedValue: h.computedValue,
  computedWeight: h.computedWeight,
  isCash: h.isCash,
})), null, 2)}

${newsSection}${newsQualityNote}${trustedSourceList}

${priorRecsSection}${convictionsSection}
=== D. FIVE-PHASE ANALYSIS (execute in order) ===

PHASE 1 — PROFILE CONSTRAINT BINDING
State the specific constraints that bind this portfolio given the profile above.
Use ONLY what is in the profile. Do not assume anything not stated.

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
- thesisSummary: 1-2 dense, source-backed sentences. No generic statements.
- detailedReasoning: organized as SHORT-TERM (0-3mo) / MID-TERM (3-18mo) / LONG-TERM (18mo+). If addressing a conviction: include "ACKNOWLEDGMENT:" and "COUNTERPOINT:" if you disagree.
- whyChanged: MUST explain change vs prior. If no prior: state "No prior recommendation." If changed: cite specific evidence/event that drove it.
- evidenceQuality: honest — use "low" when you lack hard data, "high" only with primary sources.
- positionStatus: "underweight" | "overweight" | "on_target" vs acceptable range ±${constraints.driftTolerancePct}%

CRITICAL MATH (enforced):
1. Sum of all targetWeight values MUST equal exactly 100%
2. shareDelta = targetShares - currentShares (exact, not estimated)  
3. If you reduce one position, INCREASE another — no money disappears
4. New position: currentShares=0, currentWeight=0, action="Buy", shareDelta=targetShares

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
  onProgress?: (step: number) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  priorRecommendations?: any[],
  customPrompt?: string,
  convictions?: Array<{ ticker: string; rationale: string }>
): Promise<PortfolioReportV3> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY in your .env file.");

  const openai = new OpenAI({ apiKey });

  // Step 1: Build research context (pure, deterministic)
  const ctx = buildResearchContext({ profile, holdings, priorRecommendations, customPrompt });

  // Step 2: Fetch live news with 50s hard timeout
  const { combinedSummary, allSources, usingFallback } = await Promise.race([
    fetchAllNewsWithFallback(openai, ctx.holdings.map(h => h.ticker), ctx.today, onProgress),
    new Promise<{ combinedSummary: string; allSources: Source[]; usingFallback: boolean }>(
      (resolve) => setTimeout(() => resolve({ combinedSummary: "", allSources: [], usingFallback: true }), 50000)
    ),
  ]);

  // Step 3: Filter to high-quality sources, deduplicate
  const trustedSources = filterToTrustedSources(deduplicateSources(allSources));
  const sourceQuality = summarizeSourceQuality(allSources);

  const newsSection = combinedSummary.trim()
    ? `=== VERIFIED CURRENT NEWS (live web search, ${ctx.today}) ===\n${combinedSummary}\n=== END CURRENT NEWS ===`
    : `[NO LIVE NEWS: Primary search returned no content. Lower confidence across all company-specific recommendations. Do not fabricate news events.]`;

  // Step 4: Build prompt and call LLM
  onProgress?.(3);
  const prompt = buildAnalysisPrompt(ctx, newsSection, trustedSources, convictions ?? [], usingFallback);

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
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
      { role: "user", content: prompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty response.");

  let rawParsed: Partial<PortfolioReportV3>;
  try {
    rawParsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse LLM JSON response.");
  }

  // Step 5: Validate and deterministically correct
  const validation = validatePortfolioReport(rawParsed, ctx.totalValue);
  if (validation.errors.length > 0) console.warn("[analyzer] Validation errors:", validation.errors);
  if (validation.warnings.length > 0) console.warn("[analyzer] Corrected:", validation.warnings);

  let recommendations = (validation.correctedReport?.recommendations ?? []) as RecommendationV3[];

  // Step 6: Enforce speculative cap + enrich with deterministic math
  recommendations = enforceSpeculativeCap(recommendations, ctx.constraints.speculativeCapPct);
  recommendations = enrichRecommendationsWithMath(recommendations, ctx);

  // Final weight normalization
  const { valid: finalWeightValid, sum: finalSum } = validateWeightSum(recommendations);
  if (!finalWeightValid) {
    console.warn(`[analyzer] Final weight sum ${finalSum}% — normalizing.`);
    recommendations = normalizeWeights(recommendations);
  }

  // Fix currentWeight for all holdings using authoritative snapshot values
  const holdingValueMap = new Map(ctx.holdings.map(h => [h.ticker, h.computedValue]));
  for (const rec of recommendations) {
    const actualValue = holdingValueMap.get(rec.ticker);
    if (actualValue !== undefined && ctx.totalValue > 0) {
      rec.currentWeight = Number(((actualValue / ctx.totalValue) * 100).toFixed(2));
    } else if (!holdingValueMap.has(rec.ticker)) {
      rec.currentShares = 0;
      rec.currentWeight = 0;
      if (!rec.shareDelta || rec.shareDelta === 0) rec.shareDelta = rec.targetShares;
    }
  }

  const portfolioMath = buildPortfolioMathSummary(recommendations, ctx);

  const report: PortfolioReportV3 = {
    summary: rawParsed.summary ?? "",
    reasoning: rawParsed.reasoning ?? "",
    evidenceQualitySummary: rawParsed.evidenceQualitySummary ?? "",
    marketContext: rawParsed.marketContext ?? { shortTerm: [], mediumTerm: [], longTerm: [] },
    portfolioMath,
    recommendations,
    watchlistIdeas: (rawParsed.watchlistIdeas ?? []) as WatchlistIdeaV3[],
  };

  // Attach metadata for scheduler to persist
  (report as any)._meta = {
    sourceQualitySummary: sourceQuality,
    frozenProfileJson: ctx.frozenProfileJson,
    usingFallback,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
  };

  return report;
}
