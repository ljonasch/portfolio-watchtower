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

export interface Stage3ContextBudgetSummary {
  maxTotalChars: number;
  initialTotalChars: number;
  finalTotalChars: number;
  fitsBudget: boolean;
  trimmingApplied: boolean;
  trimmedSections: Stage3ContextSectionKey[];
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
    "candidates",
    "macroEnvironment",
    "regime",
  ] as Stage3ContextSectionKey[],
} as const;

export interface Stage3ContextBudgetConfig {
  maxTotalChars: number;
  softCaps: Record<Stage3ContextSectionKey, number>;
  hardCaps: Record<Stage3ContextSectionKey, number>;
  trimOrder: Stage3ContextSectionKey[];
}

function clampSectionText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;

  const marker = `\n[${label} trimmed to ${maxChars} chars for Stage 3 context budgeting]`;
  const availableChars = Math.max(0, maxChars - marker.length);
  const truncated = text.slice(0, availableChars);
  const lastPeriod = truncated.lastIndexOf(".");
  const safe = lastPeriod > availableChars * 0.7 ? truncated.slice(0, lastPeriod + 1) : truncated;

  return safe + marker;
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
  return Object.values(sections).filter(Boolean).join("\n\n");
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
  };

  const initialSections = { ...input };
  const initialTotalChars = buildAdditionalContext(initialSections).length;
  const workingSections = { ...initialSections };
  const trimmedSections = new Set<Stage3ContextSectionKey>();

  for (const key of Object.keys(workingSections) as Stage3ContextSectionKey[]) {
    const next = clampSectionText(workingSections[key], budgetConfig.softCaps[key], SECTION_LABELS[key]);
    if (next !== workingSections[key]) {
      trimmedSections.add(key);
      workingSections[key] = next;
    }
  }

  let additionalContext = buildAdditionalContext(workingSections);

  if (additionalContext.length > budgetConfig.maxTotalChars) {
    for (const key of budgetConfig.trimOrder) {
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
    },
  };
}
