import { applyStructuredNewsOverlay, buildPromptNewsContext } from "@/lib/analyzer";
import type { NewsResult, RecommendationV3 } from "@/lib/research/types";

function buildNewsResult(overrides: Partial<NewsResult>): NewsResult {
  return {
    evidence: [],
    combinedSummary: "",
    breaking24h: "",
    allSources: [],
    usingFallback: false,
    availabilityStatus: "primary_success",
    degradedReason: null,
    statusSummary: "Primary live-news search succeeded for this run.",
    issues: [],
    signals: {
      availabilityStatus: "primary_success",
      degradedReason: null,
      articleCount: 2,
      trustedSourceCount: 2,
      sourceDiversityCount: 2,
      recent24hCount: 1,
      recent7dCount: 2,
      directionalSupport: "positive",
      contradictionLevel: "low",
      catalystPresence: true,
      riskEventPresence: false,
      confidence: "high",
      statusSummary: "Primary live-news search succeeded for this run.",
      tickerSignals: {
        AAPL: {
          ticker: "AAPL",
          availabilityStatus: "primary_success",
          degradedReason: null,
          articleCount: 2,
          trustedSourceCount: 2,
          sourceDiversityCount: 2,
          recent24hCount: 1,
          recent7dCount: 2,
          directionalSupport: "positive",
          catalystPresence: true,
          riskEventPresence: false,
          contradictionLevel: "low",
          newsConfidence: "high",
          explanatoryNote: "Two recent primary articles supported the thesis.",
        },
      },
      issues: [],
    },
    fetchedAt: "2026-04-03T16:00:00.000Z",
    ...overrides,
  };
}

function buildRecommendation(overrides: Partial<RecommendationV3> = {}): RecommendationV3 {
  return {
    ticker: "AAPL",
    companyName: "Apple",
    role: "Core",
    currentShares: 10,
    currentPrice: 100,
    targetShares: 12,
    shareDelta: 2,
    dollarDelta: 200,
    currentWeight: 8,
    targetWeight: 10,
    acceptableRangeLow: 6,
    acceptableRangeHigh: 12,
    valueDelta: 200,
    action: "Buy",
    confidence: "low",
    positionStatus: "underweight",
    evidenceQuality: "low",
    thesisSummary: "Needs better exposure.",
    detailedReasoning: "Detailed rationale.",
    whyChanged: "Original rationale.",
    reasoningSources: [],
    ...overrides,
  };
}

describe("analyzer news overlay", () => {
  test("primary high-confidence structured news can raise confidence modestly in a deterministic way", () => {
    const recs = [buildRecommendation()];
    const newsResult = buildNewsResult({});

    const first = applyStructuredNewsOverlay(recs, newsResult.signals);
    const second = applyStructuredNewsOverlay(recs, newsResult.signals);

    expect(first).toEqual(second);
    expect(first[0]).toEqual(
      expect.objectContaining({
        confidence: "medium",
        evidenceQuality: "mixed",
      })
    );
    expect(first[0].systemNote).toContain("News overlay");
  });

  test("fallback-only news does not boost confidence above the no-news baseline", () => {
    const recs = [buildRecommendation({ confidence: "high", evidenceQuality: "high" })];
    const newsResult = buildNewsResult({
      usingFallback: true,
      availabilityStatus: "fallback_success",
      degradedReason: "primary_transport_failure",
      statusSummary: "Primary live-news search failed due to a connection/provider issue, so Yahoo Finance fallback headlines were used.",
      signals: {
        availabilityStatus: "fallback_success",
        degradedReason: "primary_transport_failure",
        articleCount: 1,
        trustedSourceCount: 1,
        sourceDiversityCount: 1,
        recent24hCount: 0,
        recent7dCount: 1,
        directionalSupport: "neutral",
        contradictionLevel: "low",
        catalystPresence: false,
        riskEventPresence: false,
        confidence: "low",
        statusSummary: "Primary live-news search failed due to a connection/provider issue, so Yahoo Finance fallback headlines were used.",
        tickerSignals: {
          AAPL: {
            ticker: "AAPL",
            availabilityStatus: "fallback_success",
            degradedReason: "primary_transport_failure",
            articleCount: 1,
            trustedSourceCount: 1,
            sourceDiversityCount: 1,
            recent24hCount: 0,
            recent7dCount: 1,
            directionalSupport: "neutral",
            catalystPresence: false,
            riskEventPresence: false,
            contradictionLevel: "low",
            newsConfidence: "low",
            explanatoryNote: "Fallback-only headlines were available after a primary connection failure.",
          },
        },
        issues: [],
      },
    });

    const overlaid = applyStructuredNewsOverlay(recs, newsResult.signals);

    expect(overlaid[0].confidence).toBe("medium");
    expect(overlaid[0].evidenceQuality).toBe("mixed");
    expect(overlaid[0].systemNote).toContain("Fallback-only");
  });

  test("prompt context distinguishes provider failure from true no-news availability", () => {
    const fallbackContext = buildPromptNewsContext(
      buildNewsResult({
        usingFallback: true,
        availabilityStatus: "fallback_success",
        degradedReason: "primary_transport_failure",
        statusSummary: "Primary live-news search failed due to a connection/provider issue, so Yahoo Finance fallback headlines were used.",
        combinedSummary: "Fallback headline summary",
      }),
      "2026-04-03"
    );
    const noNewsContext = buildPromptNewsContext(
      buildNewsResult({
        availabilityStatus: "no_usable_news",
        degradedReason: "no_usable_news",
        statusSummary: "No usable news could be captured from the primary provider or the Yahoo fallback for this run.",
      }),
      "2026-04-03"
    );

    expect(fallbackContext.newsStatusNote).toContain("connection/provider issue");
    expect(fallbackContext.newsStatusNote).toContain("fallback headlines");
    expect(noNewsContext.newsSection).toContain("No usable news could be captured");
    expect(noNewsContext.newsSection).not.toContain("fallback headlines were used");
  });
});
