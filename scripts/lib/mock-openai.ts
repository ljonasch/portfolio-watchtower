/**
 * scripts/lib/mock-openai.ts
 * Configurable OpenAI stub response builder for test scripts.
 *
 * Usage:
 *   import { buildMockCompletion, buildMockReportResponse } from "./lib/mock-openai";
 *   jest.spyOn(openai.chat.completions, "create").mockResolvedValue(buildMockCompletion("{}"));
 */

import type { RecommendationV3, HoldingRole } from "../../src/lib/research/types";

// ── Raw completion stub ────────────────────────────────────────────────────────

export function buildMockCompletion(content: string | null) {
    return {
        id: "mock-completion-id",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "gpt-4o-mock",
        choices: content === null
            ? []
            : [
                {
                    index: 0,
                    message: { role: "assistant", content },
                    finish_reason: "stop",
                    logprobs: null,
                },
            ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    } as any;
}

// ── Portfolio report stub ──────────────────────────────────────────────────────

export function buildMockRecommendation(
    ticker: string,
    overrides: Partial<RecommendationV3> = {}
): RecommendationV3 {
    return {
        ticker,
        companyName: ticker,
        role: "Core" as HoldingRole,
        currentShares: 10,
        targetShares: 10,
        shareDelta: 0,
        currentWeight: 20,
        targetWeight: 20,
        valueDelta: 0,
        dollarDelta: 0,
        acceptableRangeLow: 15,
        acceptableRangeHigh: 25,
        action: "Hold" as RecommendationV3["action"],
        confidence: "high",
        positionStatus: "on_target",
        evidenceQuality: "medium",
        thesisSummary: `Mock thesis for ${ticker}`,
        detailedReasoning: `Mock reasoning for ${ticker}. ACKNOWLEDGMENT: Mock AI acknowledges conviction.`,
        whyChanged: "No prior data.",
        reasoningSources: [],
        currentPrice: 100,
        ...overrides,
    };
}

/** Build a mock portfolio report with weights summing to 100% */
export function buildMockReportResponse(tickers: string[] = ["AAPL", "MSFT", "CASH"]): string {
    const perWeight = Number((100 / tickers.length).toFixed(2));
    // Adjust last to exactly 100
    const weights = tickers.map((_, i) =>
        i === tickers.length - 1
            ? Number((100 - perWeight * (tickers.length - 1)).toFixed(2))
            : perWeight
    );

    const recs = tickers.map((ticker, i) =>
        buildMockRecommendation(ticker, { targetWeight: weights[i], currentWeight: weights[i] })
    );

    return JSON.stringify({
        recommendations: recs,
        marketTheme: "Stable growth environment",
        riskTheme: "Moderate volatility",
        executiveSummary: "Mock portfolio analysis summary.",
        strategyRationale: "Mock strategy rationale.",
        portfolioMath: {
            totalValue: 100000,
            cashPct: 0,
            speculativeExposurePct: 0,
            concentrationWarnings: [],
            overlapWarnings: [],
            holdingCount: tickers.length,
            weightSumCheck: 100,
        },
    });
}

/** 
 * Build a mock report where weights intentionally don't sum to 100% (for testing normalization).
 * `drift` is the amount to add to the sum (positive = over, negative = under).
 */
export function buildMockBadWeightResponse(tickers: string[], drift: number): string {
    const report = JSON.parse(buildMockReportResponse(tickers));
    // Add drift to first recommendation
    report.recommendations[0].targetWeight += drift;
    return JSON.stringify(report);
}

/**
 * Build a mock conviction response that DOES contain ACKNOWLEDGMENT keyword.
 */
export function buildMockConvictionAck(ticker: string): string {
    return `ACKNOWLEDGMENT: The user raises a valid point about ${ticker}. COUNTERPOINT: However, recent market data suggests the position is fairly valued.`;
}

/**
 * Build a mock conviction response that does NOT contain any keyword (for T6.1 testing).
 */
export function buildMockConvictionNoAck(ticker: string): string {
    return `${ticker} is a strong holding with solid fundamentals and consistent earnings growth.`;
}
