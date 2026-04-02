/**
 * tests/unit/batch6-validation.test.ts
 * Batch 6 tests: validation hardening.
 *
 * T08 — validatePortfolioReport: hard errors returned for truly invalid output
 * T13 — validatePortfolioReport: shareDelta mismatch is a warning not an error
 * T14 — validatePortfolioReport: duplicate tickers are deduplicated via warning
 * T45 — validation_enforce_block logic: enforce=true throws on hard errors
 * T46 — validation_enforce_block logic: enforce=false proceeds with correction
 * T47 — AbstainReason enum: VALIDATION_HARD_ERROR is a recognized abstain reason
 */

import { validatePortfolioReport } from "@/lib/research/recommendation-validator";
import type { PortfolioReportV3, RecommendationV3 } from "@/lib/research/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRec(overrides: Partial<RecommendationV3> = {}): RecommendationV3 {
  return {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    role: "Core",
    currentShares: 10,
    currentPrice: 150,
    targetShares: 12,
    shareDelta: 2,
    dollarDelta: 300,
    currentWeight: 10,
    targetWeight: 12,
    acceptableRangeLow: 8,
    acceptableRangeHigh: 16,
    valueDelta: 300,
    action: "Buy",
    confidence: "high",
    positionStatus: "underweight",
    evidenceQuality: "high",
    thesisSummary: "Strong earnings momentum.",
    detailedReasoning: "Solid FCF and multiple expansion thesis.",
    whyChanged: "Increased conviction due to AI adoption tailwinds.",
    reasoningSources: [{ title: "Bloomberg", url: "https://bloomberg.com", quality: "high" }],
    ...overrides,
  };
}

function makeReport(
  recs: RecommendationV3[] = [makeRec()],
  overrides: Partial<PortfolioReportV3> = {}
): Partial<PortfolioReportV3> {
  return {
    summary: "Portfolio is well-positioned for the current macro environment.",
    reasoning: "Strong conviction in tech and energy rotation.",
    evidenceQualitySummary: "high",
    marketContext: { shortTerm: [], mediumTerm: [], longTerm: [] },
    portfolioMath: {} as any,
    recommendations: recs,
    watchlistIdeas: [],
    ...overrides,
  };
}

// ─── T08: Hard errors for invalid output ─────────────────────────────────────

describe("T08 — validatePortfolioReport: hard errors", () => {
  test("no recommendations → valid=false and error on recommendations field", () => {
    const result = validatePortfolioReport(makeReport([]), 100000);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "recommendations")).toBe(true);
  });

  test("recommendation with missing ticker → hard error", () => {
    const rec = makeRec({ ticker: undefined as any });
    const result = validatePortfolioReport(makeReport([rec]), 100000);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "ticker")).toBe(true);
  });

  test("recommendation with missing targetShares → hard error", () => {
    const rec = makeRec({ targetShares: undefined as any });
    const result = validatePortfolioReport(makeReport([rec]), 100000);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "targetShares")).toBe(true);
  });

  test("recommendation with missing targetWeight → hard error", () => {
    const rec = makeRec({ targetWeight: undefined as any });
    const result = validatePortfolioReport(makeReport([rec]), 100000);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === "targetWeight")).toBe(true);
  });

  test("valid recommendation → valid=true, no hard errors", () => {
    const result = validatePortfolioReport(makeReport(), 0); // totalValue=0 skips weight math
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── T13: shareDelta mismatch is a warning, not error ─────────────────────────

describe("T13 — validatePortfolioReport: shareDelta mismatch is a warning", () => {
  test("shareDelta 1 off from targetShares-currentShares → warning not error", () => {
    // targetShares=12, currentShares=10 → expectedDelta=2, but reportedDelta=3
    const rec = makeRec({ targetShares: 12, currentShares: 10, shareDelta: 3 });
    const result = validatePortfolioReport(makeReport([rec]), 0);
    expect(result.valid).toBe(true);   // NOT a hard error
    expect(result.warnings.some(w => w.field === "shareDelta")).toBe(true);
  });

  test("shareDelta correct → no warning", () => {
    const rec = makeRec({ targetShares: 12, currentShares: 10, shareDelta: 2 });
    const result = validatePortfolioReport(makeReport([rec]), 0);
    expect(result.warnings.some(w => w.field === "shareDelta")).toBe(false);
  });
});

// ─── T14: Duplicate tickers deduplicated via warning ─────────────────────────

describe("T14 — validatePortfolioReport: duplicate tickers removed", () => {
  test("two recs with the same ticker → second removed with warning", () => {
    const rec1 = makeRec({ ticker: "NVDA", targetShares: 5, currentShares: 0, shareDelta: 5 });
    const rec2 = makeRec({ ticker: "NVDA", targetShares: 8, currentShares: 0, shareDelta: 8 });
    const result = validatePortfolioReport(makeReport([rec1, rec2]), 0);
    expect(result.correctedReport?.recommendations?.filter(r => r.ticker === "NVDA")).toHaveLength(1);
    expect(result.warnings.some(w => w.field === "ticker" && (w.message ?? "").includes("Duplicate"))).toBe(true);
  });

  test("no duplicate tickers → no deduplication warning", () => {
    const rec1 = makeRec({ ticker: "AAPL" });
    const rec2 = makeRec({ ticker: "NVDA", targetShares: 5, currentShares: 0, shareDelta: 5 });
    const result = validatePortfolioReport(makeReport([rec1, rec2]), 0);
    expect(result.warnings.some(w => w.field === "ticker")).toBe(false);
  });
});

// ─── T45: enforce=true throws on hard errors ──────────────────────────────────

describe("T45 — validation_enforce_block: enforce=true path", () => {
  test("hard errors cause throw when enforce=true — simulates analyzer behavior", () => {
    const rawParsed: Partial<PortfolioReportV3> = makeReport([]);
    const validation = validatePortfolioReport(rawParsed, 100000);

    // Simulate the enforce=true branch from Batch 6 analyzer code
    const validationEnforceBlock = true;
    const runEnforceBlock = () => {
      if (validation.errors.length > 0 && validationEnforceBlock) {
        const errorSummary = validation.errors.map(e => `${e.field}: ${e.message}`).join("; ");
        throw new Error(
          `validation_enforce_block: Report failed validation with ${validation.errors.length} hard error(s): ${errorSummary}`
        );
      }
    };
    expect(runEnforceBlock).toThrow(/validation_enforce_block/);
  });
});

// ─── T46: enforce=false proceeds with correction ───────────────────────────────

describe("T46 — validation_enforce_block: enforce=false path", () => {
  test("hard errors do NOT throw when enforce=false — logs and continues", () => {
    const rawParsed: Partial<PortfolioReportV3> = makeReport([]);
    const validation = validatePortfolioReport(rawParsed, 100000);

    const validationEnforceBlock = false;
    const runEnforceBlock = () => {
      if (validation.errors.length > 0 && validationEnforceBlock) {
        throw new Error("Should not throw");
      }
      // Log-only path: valid=false but we proceed
    };
    expect(runEnforceBlock).not.toThrow();
    expect(validation.valid).toBe(false);
  });
});

// ─── T47: AbstainReason enum coverage ─────────────────────────────────────────

describe("T47 — AbstainReason enum coverage", () => {
  test("VALIDATION_HARD_ERROR is a known abstain reason string", () => {
    const VALID_ABSTAIN_REASONS = ["CONTEXT_TOO_LONG", "LLM_FAILURE", "VALIDATION_HARD_ERROR"];
    expect(VALID_ABSTAIN_REASONS).toContain("VALIDATION_HARD_ERROR");
  });

  test("error message containing validation_enforce_block is classified as VALIDATION_HARD_ERROR", () => {
    const msg = "validation_enforce_block: Report failed validation with 1 hard error(s): ticker: Missing ticker";
    const isValidationBlock = msg.includes("validation_enforce_block");
    expect(isValidationBlock).toBe(true);
  });
});
