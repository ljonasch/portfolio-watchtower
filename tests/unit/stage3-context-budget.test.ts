import {
  budgetStage3Context,
  STAGE3_CONTEXT_BUDGET,
} from "@/lib/research/stage3-context-budget";

describe("stage3 context budget", () => {
  const baseSections = {
    regime: "=== MARKET REGIME ===\nStable regime.\n=== END REGIME ===",
    macroEnvironment: "=== MACRO ENVIRONMENT ===\n" + "Macro summary. ".repeat(400),
    breaking24h: "=== BREAKING ===\n" + "Breaking detail. ".repeat(300),
    news30d: "=== RESEARCH ===\n" + "Long-form research. ".repeat(900),
    priceReactions: "=== PRICE REACTIONS ===\n" + "Reaction. ".repeat(300),
    sentiment: "=== SENTIMENT ===\n" + "Signal. ".repeat(250),
    valuation: "=== VALUATION ===\n" + "Valuation detail. ".repeat(260),
    correlation: "=== CORRELATION ===\n" + "Cluster detail. ".repeat(260),
    candidates: "=== CANDIDATES ===\n" + "Candidate detail. ".repeat(300),
  } as const;

  test("trims deterministically in a fixed priority order and fits the default budget", () => {
    const resultA = budgetStage3Context(baseSections);
    const resultB = budgetStage3Context(baseSections);

    expect(resultA).toEqual(resultB);
    expect(resultA.budget.trimmingApplied).toBe(true);
    expect(resultA.budget.fitsBudget).toBe(true);
    expect(resultA.budget.finalTotalChars).toBeLessThanOrEqual(STAGE3_CONTEXT_BUDGET.maxTotalChars);
    expect(resultA.budget.trimmedSections).toEqual(
      expect.arrayContaining(["news30d", "macroEnvironment", "breaking24h"])
    );
  });

  test("reports an over-budget result when even hard caps cannot satisfy the override budget", () => {
    const result = budgetStage3Context(baseSections, {
      maxTotalChars: 100,
      hardCaps: {
        regime: 60,
        macroEnvironment: 60,
        breaking24h: 60,
        news30d: 60,
        priceReactions: 60,
        sentiment: 60,
        valuation: 60,
        correlation: 60,
        candidates: 60,
      },
    });

    expect(result.budget.trimmingApplied).toBe(true);
    expect(result.budget.fitsBudget).toBe(false);
    expect(result.budget.finalTotalChars).toBeGreaterThan(result.budget.maxTotalChars);
  });
});
