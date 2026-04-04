export type Stage3ContextSectionKey =
  | "regime"
  | "macroEnvironment"
  | "breaking24h"
  | "news30d"
  | "priceReactions"
  | "sentiment"
  | "valuation"
  | "correlation"
  | "candidates";

export type Stage3PromptOverflowRecoveryStepKey =
  | "rebudget_lower_priority_sections"
  | "drop_optional_research_tails"
  | "compact_news_and_macro"
  | "last_resort_compact_candidates";

export interface Stage3ContextBudgetSummary {
  maxTotalChars: number;
  initialTotalChars: number;
  finalTotalChars: number;
  fitsBudget: boolean;
  trimmingApplied: boolean;
  trimmedSections: Stage3ContextSectionKey[];
  preservedSections: Stage3ContextSectionKey[];
}

export interface Stage3ContextBudgetResult {
  additionalContext: string;
  sections: Record<Stage3ContextSectionKey, string>;
  perSectionChars: Record<Stage3ContextSectionKey, number>;
  budget: Stage3ContextBudgetSummary;
}

const SECTION_LABELS: Record<Stage3ContextSectionKey, string> = {
  regime: "market regime",
  macroEnvironment: "macro environment",
  breaking24h: "breaking news",
  news30d: "30-day research",
  priceReactions: "price reactions",
  sentiment: "sentiment signals",
  valuation: "valuation",
  correlation: "correlation",
  candidates: "candidate review",
};

export const STAGE3_CONTEXT_BUDGET = {
  maxTotalChars: 16000,
  softCaps: {
    regime: 1200,
    macroEnvironment: 2600,
    breaking24h: 2400,
    news30d: 6000,
    priceReactions: 1800,
    sentiment: 1400,
    valuation: 1800,
    correlation: 1400,
    candidates: 2400,
  } satisfies Record<Stage3ContextSectionKey, number>,
  hardCaps: {
    regime: 1000,
    macroEnvironment: 1800,
    breaking24h: 1700,
    news30d: 3600,
    priceReactions: 900,
    sentiment: 700,
    valuation: 1000,
    correlation: 800,
    candidates: 1500,
  } satisfies Record<Stage3ContextSectionKey, number>,
  trimOrder: [
    "correlation",
    "valuation",
    "sentiment",
    "priceReactions",
    "news30d",
    "breaking24h",
    "macroEnvironment",
  ] as Stage3ContextSectionKey[],
  preservedSections: ["regime", "candidates"] as Stage3ContextSectionKey[],
} as const;

export interface Stage3ContextBudgetConfig {
  maxTotalChars: number;
  softCaps: Record<Stage3ContextSectionKey, number>;
  hardCaps: Record<Stage3ContextSectionKey, number>;
  trimOrder: Stage3ContextSectionKey[];
  preservedSections: Stage3ContextSectionKey[];
  candidateMinimumRetainedRows: number;
  allowSingleCandidateFallback: boolean;
}

export interface Stage3PromptOverflowRecoveryResult extends Stage3ContextBudgetResult {
  stepKey: Stage3PromptOverflowRecoveryStepKey;
  changed: boolean;
}

const STAGE3_CONTEXT_SECTION_ORDER: Stage3ContextSectionKey[] = [
  "regime",
  "macroEnvironment",
  "breaking24h",
  "news30d",
  "priceReactions",
  "sentiment",
  "valuation",
  "correlation",
  "candidates",
];

export const STAGE3_PROMPT_OVERFLOW_RECOVERY_STEPS: Stage3PromptOverflowRecoveryStepKey[] = [
  "rebudget_lower_priority_sections",
  "drop_optional_research_tails",
  "compact_news_and_macro",
  "last_resort_compact_candidates",
];

interface CandidateCompactionOptions {
  minimumRetainedRows: number;
  allowSingleRowFallback: boolean;
}

const DEFAULT_CANDIDATE_COMPACTION_OPTIONS: CandidateCompactionOptions = {
  minimumRetainedRows: 1,
  allowSingleRowFallback: true,
};

function clampSectionText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;

  const marker = `\n[${label} trimmed to ${maxChars} chars for Stage 3 context budgeting]`;
  const availableChars = Math.max(0, maxChars - marker.length);
  const truncated = text.slice(0, availableChars);
  const lastPeriod = truncated.lastIndexOf(".");
  const safe = lastPeriod > availableChars * 0.7 ? truncated.slice(0, lastPeriod + 1) : truncated;

  return safe + marker;
}

function compactCandidateRow(row: string, maxChars: number): string {
  if (row.length <= maxChars) return row;

  const [head, remainder = ""] = row.split(": ", 2);
  const compactParts = [
    remainder.match(/via [^,]+/)?.[0] ?? null,
    remainder.match(/lane: [^,]+/)?.[0] ?? null,
    remainder.match(/catalyst: [^,]+/)?.[0] ?? null,
    remainder.match(/reason: .+/)?.[0] ?? null,
  ].filter((part): part is string => Boolean(part));

  const compactRow = compactParts.length > 0
    ? `${head}: ${compactParts.join(", ")}`
    : row;

  if (compactRow.length <= maxChars) return compactRow;

  const marker = " [candidate row trimmed]";
  const availableChars = Math.max(0, maxChars - marker.length);
  return compactRow.slice(0, availableChars) + marker;
}

function compactCandidateSection(
  text: string,
  maxChars: number,
  options: CandidateCompactionOptions = DEFAULT_CANDIDATE_COMPACTION_OPTIONS
): string {
  if (text.length <= maxChars) return text;

  const lines = text.split("\n");
  const endMarker = lines.find((line) => line.trim() === "=== END CANDIDATES ===") ?? "=== END CANDIDATES ===";
  const headerLines: string[] = [];
  const candidateRows: string[] = [];
  let candidateRowsStarted = false;

  for (const line of lines) {
    if (line.trim() === "=== END CANDIDATES ===") continue;

    if (!candidateRowsStarted) {
      headerLines.push(line);
      if (line.trim().startsWith("3.")) {
        candidateRowsStarted = true;
      }
      continue;
    }

    if (line.trim().length > 0) {
      candidateRows.push(line);
    }
  }

  if (candidateRows.length === 0) {
    return clampSectionText(text, maxChars, SECTION_LABELS.candidates);
  }

  const buildCandidateBlock = (rows: string[]) => {
    const omittedCount = Math.max(0, candidateRows.length - rows.length);
    return [
      ...headerLines,
      ...rows,
      omittedCount > 0
        ? `[${SECTION_LABELS.candidates} trimmed to ${maxChars} chars; ${omittedCount} additional candidate row(s) omitted]`
        : "",
      endMarker,
    ].filter(Boolean).join("\n");
  };

  const tryRetainRows = (rows: string[]) => {
    const retainedRows: string[] = [];
    for (const row of rows) {
      const candidateText = buildCandidateBlock([...retainedRows, row]);
      if (candidateText.length > maxChars) {
        continue;
      }
      retainedRows.push(row);
    }
    return retainedRows;
  };

  const originalRows = candidateRows;
  const compactRows = candidateRows.map((row) => compactCandidateRow(row, 180));

  let retainedRows = tryRetainRows(originalRows);
  if (retainedRows.length < options.minimumRetainedRows) {
    retainedRows = tryRetainRows(compactRows);
  }

  if (retainedRows.length >= options.minimumRetainedRows) {
    return buildCandidateBlock(retainedRows);
  }

  if (!options.allowSingleRowFallback) {
    return text;
  }

  const heading = headerLines[0] ?? "=== CANDIDATE POSITIONS TO EVALUATE ===";
  const firstRow = compactCandidateRow(compactRows[0], Math.max(120, maxChars - heading.length - endMarker.length - 120));
  const marker = `[${SECTION_LABELS.candidates} trimmed to ${maxChars} chars; ${Math.max(0, candidateRows.length - 1)} additional candidate row(s) omitted]`;
  return [heading, firstRow, marker, endMarker].filter(Boolean).join("\n");
}

function clampProtectedSectionText(
  key: Stage3ContextSectionKey,
  text: string,
  maxChars: number,
  candidateOptions: CandidateCompactionOptions = DEFAULT_CANDIDATE_COMPACTION_OPTIONS
): string {
  if (key === "candidates") {
    return compactCandidateSection(text, maxChars, candidateOptions);
  }

  return clampSectionText(text, maxChars, SECTION_LABELS[key]);
}

function buildPerSectionChars(sections: Record<Stage3ContextSectionKey, string>): Record<Stage3ContextSectionKey, number> {
  return {
    regime: sections.regime.length,
    macroEnvironment: sections.macroEnvironment.length,
    breaking24h: sections.breaking24h.length,
    news30d: sections.news30d.length,
    priceReactions: sections.priceReactions.length,
    sentiment: sections.sentiment.length,
    valuation: sections.valuation.length,
    correlation: sections.correlation.length,
    candidates: sections.candidates.length,
  };
}

function buildAdditionalContext(sections: Record<Stage3ContextSectionKey, string>): string {
  return STAGE3_CONTEXT_SECTION_ORDER.map((key) => sections[key]).filter(Boolean).join("\n\n");
}

function emptyStage3Sections(): Record<Stage3ContextSectionKey, string> {
  return {
    regime: "",
    macroEnvironment: "",
    breaking24h: "",
    news30d: "",
    priceReactions: "",
    sentiment: "",
    valuation: "",
    correlation: "",
    candidates: "",
  };
}

function detectStage3SectionKey(line: string): Stage3ContextSectionKey | null {
  const trimmed = line.trim();
  if (trimmed === "=== MARKET REGIME ===") return "regime";
  if (trimmed === "=== MACRO ENVIRONMENT (NORMALIZED) ===") return "macroEnvironment";
  if (trimmed.includes("BREAKING NEWS (last 24 hours")) return "breaking24h";
  if (trimmed === "=== RESEARCH (30-day) ===") return "news30d";
  if (trimmed === "=== INTRADAY PRICE REACTIONS ===") return "priceReactions";
  if (trimmed.startsWith("=== SENTIMENT SIGNALS")) return "sentiment";
  if (trimmed === "=== VALUATION ANCHORS ===") return "valuation";
  if (trimmed === "=== CORRELATION MATRIX (90-day) ===") return "correlation";
  if (trimmed === "=== CANDIDATE POSITIONS TO EVALUATE ===") return "candidates";
  return null;
}

export function parseStage3AdditionalContext(additionalContext?: string): Record<Stage3ContextSectionKey, string> {
  const sections = emptyStage3Sections();
  if (!additionalContext?.trim()) {
    return sections;
  }

  let currentKey: Stage3ContextSectionKey | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentKey) return;
    sections[currentKey] = currentLines.join("\n").trim();
    currentLines = [];
  };

  for (const line of additionalContext.split("\n")) {
    const detectedKey = detectStage3SectionKey(line);
    if (detectedKey) {
      flush();
      currentKey = detectedKey;
      currentLines = [line];
      continue;
    }

    if (currentKey) {
      currentLines.push(line);
    }
  }

  flush();
  return sections;
}

export function buildStage3AdditionalContext(sections: Record<Stage3ContextSectionKey, string>): string {
  return buildAdditionalContext(sections);
}

export function budgetStage3Context(
  input: Record<Stage3ContextSectionKey, string>,
  overrides?: Partial<Stage3ContextBudgetConfig>
): Stage3ContextBudgetResult {
  const budgetConfig = {
    maxTotalChars: overrides?.maxTotalChars ?? STAGE3_CONTEXT_BUDGET.maxTotalChars,
    softCaps: { ...STAGE3_CONTEXT_BUDGET.softCaps, ...(overrides?.softCaps ?? {}) },
    hardCaps: { ...STAGE3_CONTEXT_BUDGET.hardCaps, ...(overrides?.hardCaps ?? {}) },
    trimOrder: overrides?.trimOrder ?? STAGE3_CONTEXT_BUDGET.trimOrder,
    preservedSections: overrides?.preservedSections ?? STAGE3_CONTEXT_BUDGET.preservedSections,
    candidateMinimumRetainedRows: overrides?.candidateMinimumRetainedRows ?? DEFAULT_CANDIDATE_COMPACTION_OPTIONS.minimumRetainedRows,
    allowSingleCandidateFallback: overrides?.allowSingleCandidateFallback ?? DEFAULT_CANDIDATE_COMPACTION_OPTIONS.allowSingleRowFallback,
  };

  const initialSections = { ...input };
  const initialTotalChars = buildAdditionalContext(initialSections).length;
  const workingSections = { ...initialSections };
  const trimmedSections = new Set<Stage3ContextSectionKey>();

  for (const key of Object.keys(workingSections) as Stage3ContextSectionKey[]) {
    const next = budgetConfig.preservedSections.includes(key)
      ? clampProtectedSectionText(key, workingSections[key], budgetConfig.softCaps[key], {
        minimumRetainedRows: budgetConfig.candidateMinimumRetainedRows,
        allowSingleRowFallback: budgetConfig.allowSingleCandidateFallback,
      })
      : clampSectionText(workingSections[key], budgetConfig.softCaps[key], SECTION_LABELS[key]);
    if (next !== workingSections[key]) {
      trimmedSections.add(key);
      workingSections[key] = next;
    }
  }

  let additionalContext = buildAdditionalContext(workingSections);

  if (additionalContext.length > budgetConfig.maxTotalChars) {
    for (const key of budgetConfig.trimOrder) {
      if (budgetConfig.preservedSections.includes(key)) {
        continue;
      }
      const next = clampSectionText(workingSections[key], budgetConfig.hardCaps[key], SECTION_LABELS[key]);
      if (next !== workingSections[key]) {
        trimmedSections.add(key);
        workingSections[key] = next;
        additionalContext = buildAdditionalContext(workingSections);
      }

      if (additionalContext.length <= budgetConfig.maxTotalChars) {
        break;
      }
    }
  }

  const finalTotalChars = additionalContext.length;

  return {
    additionalContext,
    sections: workingSections,
    perSectionChars: buildPerSectionChars(workingSections),
    budget: {
      maxTotalChars: budgetConfig.maxTotalChars,
      initialTotalChars,
      finalTotalChars,
      fitsBudget: finalTotalChars <= budgetConfig.maxTotalChars,
      trimmingApplied: trimmedSections.size > 0,
      trimmedSections: [...trimmedSections],
      preservedSections: [...budgetConfig.preservedSections],
    },
  };
}

export function reduceStage3AdditionalContextForPromptOverflow(
  additionalContext: string,
  stepKey: Stage3PromptOverflowRecoveryStepKey
): Stage3PromptOverflowRecoveryResult {
  const parsedSections = parseStage3AdditionalContext(additionalContext);
  let result: Stage3ContextBudgetResult;

  switch (stepKey) {
    case "rebudget_lower_priority_sections":
      result = budgetStage3Context(parsedSections, {
        softCaps: {
          regime: 1000,
          macroEnvironment: 1500,
          breaking24h: 1200,
          news30d: 2200,
          priceReactions: 500,
          sentiment: 450,
          valuation: 650,
          correlation: 500,
          candidates: 1800,
        },
        hardCaps: {
          regime: 900,
          macroEnvironment: 1200,
          breaking24h: 900,
          news30d: 1600,
          priceReactions: 300,
          sentiment: 250,
          valuation: 400,
          correlation: 300,
          candidates: 1600,
        },
        candidateMinimumRetainedRows: 2,
        allowSingleCandidateFallback: false,
      });
      break;
    case "drop_optional_research_tails":
      result = budgetStage3Context({
        ...parsedSections,
        priceReactions: "",
        sentiment: "",
        valuation: "",
        correlation: "",
      }, {
        softCaps: {
          regime: 1000,
          macroEnvironment: 1500,
          breaking24h: 1200,
          news30d: 2200,
          priceReactions: 0,
          sentiment: 0,
          valuation: 0,
          correlation: 0,
          candidates: 1800,
        },
        hardCaps: {
          regime: 900,
          macroEnvironment: 1200,
          breaking24h: 900,
          news30d: 1600,
          priceReactions: 0,
          sentiment: 0,
          valuation: 0,
          correlation: 0,
          candidates: 1600,
        },
        candidateMinimumRetainedRows: 2,
        allowSingleCandidateFallback: false,
      });
      break;
    case "compact_news_and_macro":
      result = budgetStage3Context(parsedSections, {
        softCaps: {
          regime: 900,
          macroEnvironment: 1000,
          breaking24h: 800,
          news30d: 1200,
          priceReactions: 0,
          sentiment: 0,
          valuation: 0,
          correlation: 0,
          candidates: 1600,
        },
        hardCaps: {
          regime: 800,
          macroEnvironment: 800,
          breaking24h: 600,
          news30d: 800,
          priceReactions: 0,
          sentiment: 0,
          valuation: 0,
          correlation: 0,
          candidates: 1400,
        },
        candidateMinimumRetainedRows: 2,
        allowSingleCandidateFallback: false,
      });
      break;
    case "last_resort_compact_candidates":
      result = budgetStage3Context(parsedSections, {
        softCaps: {
          regime: 900,
          macroEnvironment: 600,
          breaking24h: 500,
          news30d: 700,
          priceReactions: 0,
          sentiment: 0,
          valuation: 0,
          correlation: 0,
          candidates: 950,
        },
        hardCaps: {
          regime: 800,
          macroEnvironment: 500,
          breaking24h: 400,
          news30d: 500,
          priceReactions: 0,
          sentiment: 0,
          valuation: 0,
          correlation: 0,
          candidates: 850,
        },
        candidateMinimumRetainedRows: 1,
        allowSingleCandidateFallback: true,
      });
      break;
    default:
      result = budgetStage3Context(parsedSections);
      break;
  }

  return {
    ...result,
    stepKey,
    changed: result.additionalContext !== additionalContext,
  };
}
