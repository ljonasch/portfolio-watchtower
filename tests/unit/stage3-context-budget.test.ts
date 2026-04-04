import {
  buildStage3AdditionalContext,
  budgetStage3Context,
  reduceStage3AdditionalContextForPromptOverflow,
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

  test("overflow recovery preserves a small top candidate set until the true last-resort step", () => {
    const additionalContext = buildStage3AdditionalContext({
      regime: "=== MARKET REGIME ===\nStable regime.\n=== END REGIME ===",
      macroEnvironment: "=== MACRO ENVIRONMENT (NORMALIZED) ===\n" + "Macro summary. ".repeat(200),
      breaking24h: "=== ⚡ BREAKING NEWS (last 24 hours — 2026-04-03) ===\n" + "Breaking detail. ".repeat(140),
      news30d: "=== RESEARCH (30-day) ===\n" + "Long-form research. ".repeat(350),
      priceReactions: "=== INTRADAY PRICE REACTIONS ===\n" + "Reaction detail. ".repeat(120),
      sentiment: "=== SENTIMENT SIGNALS (informational only — do NOT treat as a directional vote; use as a weak prior only) ===\n" + "Signal. ".repeat(140),
      valuation: "=== VALUATION ANCHORS ===\n" + "Valuation detail. ".repeat(180) + "\n=== END VALUATION ANCHORS ===",
      correlation: "=== CORRELATION MATRIX (90-day) ===\n" + "Cluster detail. ".repeat(180) + "\n=== END CORRELATION MATRIX ===",
      candidates: [
        "=== CANDIDATE POSITIONS TO EVALUATE ===",
        "These are NOT currently held. To recommend adding any:",
        "1. Evidence quality HIGH only",
        "2. Identify which existing position funds it",
        "3. Explain why better than increasing an existing position",
        "AVGO (Broadcom, $100.00): via gap_screener, lane: macro_lane:ai_infrastructure, catalyst: AI networking demand, reason: fills infrastructure gap",
        "RTX (RTX, $90.00): via macro_lane, lane: macro_lane:defense_fiscal_beneficiaries, catalyst: defense budget expansion, reason: policy beneficiary",
        "ETN (Eaton, $95.00): via macro_lane, lane: macro_lane:grid_upgrade, catalyst: grid capex, reason: electrification beneficiary",
        "=== END CANDIDATES ===",
      ].join("\n"),
    });

    const compactNewsAndMacro = reduceStage3AdditionalContextForPromptOverflow(additionalContext, "compact_news_and_macro");
    expect(compactNewsAndMacro.sections.candidates).toContain("AVGO");
    expect(compactNewsAndMacro.sections.candidates).toContain("RTX");
    expect(compactNewsAndMacro.sections.candidates).toContain("=== END CANDIDATES ===");

    const lastResort = reduceStage3AdditionalContextForPromptOverflow(additionalContext, "last_resort_compact_candidates");
    expect(lastResort.sections.candidates).toContain("=== CANDIDATE POSITIONS TO EVALUATE ===");
    expect(lastResort.sections.candidates).toContain("=== END CANDIDATES ===");
    expect(lastResort.sections.candidates).toMatch(/AVGO|RTX|ETN/);
  });

  test("overflow recovery uses a deterministic multi-step reduction ladder", () => {
    const additionalContext = buildStage3AdditionalContext({
      regime: "=== MARKET REGIME ===\nStable regime.\n=== END REGIME ===",
      macroEnvironment: "=== MACRO ENVIRONMENT (NORMALIZED) ===\n" + "Macro summary. ".repeat(240),
      breaking24h: "=== ⚡ BREAKING NEWS (last 24 hours — 2026-04-03) ===\n" + "Breaking detail. ".repeat(180),
      news30d: "=== RESEARCH (30-day) ===\n" + "Long-form research. ".repeat(500),
      priceReactions: "=== INTRADAY PRICE REACTIONS ===\n" + "Reaction detail. ".repeat(200),
      sentiment: "=== SENTIMENT SIGNALS (informational only — do NOT treat as a directional vote; use as a weak prior only) ===\n" + "Signal. ".repeat(180),
      valuation: "=== VALUATION ANCHORS ===\n" + "Valuation detail. ".repeat(220) + "\n=== END VALUATION ANCHORS ===",
      correlation: "=== CORRELATION MATRIX (90-day) ===\n" + "Cluster detail. ".repeat(220) + "\n=== END CORRELATION MATRIX ===",
      candidates: [
        "=== CANDIDATE POSITIONS TO EVALUATE ===",
        "These are NOT currently held. To recommend adding any:",
        "1. Evidence quality HIGH only",
        "2. Identify which existing position funds it",
        "3. Explain why better than increasing an existing position",
        "AVGO (Broadcom, $100.00): via gap_screener, lane: macro_lane:ai_infrastructure, catalyst: AI networking demand, reason: fills infrastructure gap",
        "RTX (RTX, $90.00): via macro_lane, lane: macro_lane:defense_fiscal_beneficiaries, catalyst: defense budget expansion, reason: policy beneficiary",
        "ETN (Eaton, $95.00): via macro_lane, lane: macro_lane:grid_upgrade, catalyst: grid capex, reason: electrification beneficiary",
        "=== END CANDIDATES ===",
      ].join("\n"),
    });

    const stepOne = reduceStage3AdditionalContextForPromptOverflow(additionalContext, "rebudget_lower_priority_sections");
    const stepTwo = reduceStage3AdditionalContextForPromptOverflow(stepOne.additionalContext, "drop_optional_research_tails");
    const stepThree = reduceStage3AdditionalContextForPromptOverflow(stepTwo.additionalContext, "compact_news_and_macro");

    expect(stepOne.stepKey).toBe("rebudget_lower_priority_sections");
    expect(stepTwo.stepKey).toBe("drop_optional_research_tails");
    expect(stepThree.stepKey).toBe("compact_news_and_macro");
    expect(stepTwo.additionalContext.length).toBeLessThan(stepOne.additionalContext.length);
    expect(stepThree.additionalContext.length).toBeLessThan(stepTwo.additionalContext.length);
    expect(stepThree.sections.candidates).toContain("AVGO");
    expect(stepThree.sections.candidates).toContain("RTX");
  });
});
