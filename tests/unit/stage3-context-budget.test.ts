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

  test("preserves the regime section and at least one usable candidate row after compaction", () => {
    const result = budgetStage3Context({
      ...baseSections,
      candidates: [
        "=== CANDIDATE POSITIONS TO EVALUATE ===",
        "These are NOT currently held. To recommend adding any:",
        "1. Evidence quality HIGH only",
        "2. Identify which existing position funds it",
        "3. Explain why better than increasing an existing position",
        "AVGO (Broadcom, $100.00): via gap_screener, lane: macro_lane:defense_fiscal_beneficiaries, catalyst: AI networking, reason: fills infrastructure gap",
        "RTX (RTX, $90.00): via macro_lane, lane: macro_lane:defense_fiscal_beneficiaries, catalyst: defense budget expansion, reason: policy beneficiary",
        "=== END CANDIDATES ===",
      ].join("\n"),
    }, {
      maxTotalChars: 1800,
      softCaps: {
        regime: 200,
        macroEnvironment: 200,
        breaking24h: 200,
        news30d: 200,
        priceReactions: 200,
        sentiment: 200,
        valuation: 200,
        correlation: 200,
        candidates: 320,
      },
    });

    expect(result.sections.regime).toContain("=== MARKET REGIME ===");
    expect(result.sections.candidates).toContain("=== CANDIDATE POSITIONS TO EVALUATE ===");
    expect(result.sections.candidates).toContain("=== END CANDIDATES ===");
    expect(result.sections.candidates).toMatch(/AVGO|RTX/);
    expect(result.budget.preservedSections).toEqual(expect.arrayContaining(["regime", "candidates"]));
  });
});
