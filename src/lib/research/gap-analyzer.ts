/**
 * Stage 0-A/B: Structural gap analysis plus deterministic environmental-gap derivation.
 */

import type { ProgressEvent } from "./progress-events";
import type {
  CandidateSearchLane,
  EnvironmentalGap,
  GapItem,
  GapReport,
  HoldingInput,
  MacroExposureBridgeResult,
  MacroThemeConsensusResult,
} from "./types";

interface StructuralGapHoldingsRow {
  ticker: string;
  currentWeight: number;
  isCash: boolean;
}

function extractJsonArray(raw: string): any[] {
  const stripped = raw.trim();
  const s = stripped.indexOf("[");
  const e = stripped.lastIndexOf("]");
  if (s !== -1 && e !== -1 && e >= s) {
    try {
      const parsed = JSON.parse(stripped.slice(s, e + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  const match = stripped.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}

async function validateUrls(text: string): Promise<{ verified: number; unverified: string[] }> {
  const urlRegex = /https?:\/\/[^\s\)\"]+/g;
  const found = Array.from(new Set(text.match(urlRegex) ?? [])).slice(0, 5);
  const unverified: string[] = [];
  let verified = 0;

  await Promise.allSettled(
    found.map(async (url) => {
      try {
        const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) });
        if (response.ok) verified += 1;
        else unverified.push(url);
      } catch {
        unverified.push(url);
      }
    })
  );

  return { verified, unverified };
}

export async function runStructuralGapAnalysis(
  openai: any,
  holdings: StructuralGapHoldingsRow[],
  profile: Record<string, any>,
  today: string,
  emit: (e: ProgressEvent) => void
): Promise<GapReport> {
  emit({
    type: "stage_start",
    stage: "gap",
    label: "Portfolio Gap Analysis",
    detail: "Searching market landscape and analyzing structural portfolio blind spots",
  });
  const startedAt = Date.now();

  const holdingsSummary = holdings
    .filter((holding) => !holding.isCash)
    .map((holding) => `${holding.ticker} (${holding.currentWeight.toFixed(1)}%)`)
    .join(", ");

  async function fetchWithRetry(prompt: string, attempt = 1): Promise<any> {
    try {
      return await openai.chat.completions.create({
        model: "gpt-5-search-api",
        max_completion_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (error: any) {
      if (error?.status === 429 && attempt < 8) {
        emit({ type: "log", message: "Gap analyzer rate limit hit, waiting 65s...", level: "warn" });
        await new Promise((resolve) => setTimeout(resolve, 65000));
        return fetchWithRetry(prompt, attempt + 1);
      }
      emit({ type: "log", message: `Gap analysis failed: ${error?.message}`, level: "warn" });
      return null;
    }
  }

  const landscapePrompt = `Today is ${today}. Search for:
1. Which S&P 500 sectors have outperformed YTD and in the last 30 days? (cite % figures)
2. Where is institutional money actively rotating TO right now?
3. Which themes - AI, defense, energy transition, reshoring, healthcare innovation - are driving the most institutional flows?
4. What analyst upgrade cycles are active across sectors right now?

Be specific. Cite data: flows in $B, sector ETF performance %, analyst consensus shifts. Return plain text analysis.`;

  const exposurePrompt = `Today is ${today}. Analyze this portfolio: ${holdingsSummary}

1. What correlated risk is this portfolio overexposed to?
2. What single narrative or macro event would damage most positions simultaneously?
3. What market opportunities RIGHT NOW does this portfolio have zero exposure to?
4. Are there redundant bets - multiple positions making the same bet?

Return plain text, 4-5 paragraphs.`;

  const [landscapeRes, exposureRes] = await Promise.allSettled([
    fetchWithRetry(landscapePrompt),
    fetchWithRetry(exposurePrompt),
  ]);

  const landscapeText = landscapeRes.status === "fulfilled" && landscapeRes.value
    ? (landscapeRes.value as any).choices?.[0]?.message?.content ?? ""
    : "";
  const exposureText = exposureRes.status === "fulfilled" && exposureRes.value
    ? (exposureRes.value as any).choices?.[0]?.message?.content ?? ""
    : "";

  if (landscapeText || exposureText) {
    validateUrls(`${landscapeText} ${exposureText}`).then(({ verified, unverified }) => {
      if (unverified.length > 0) {
        emit({ type: "log", message: `Gap URL check: ${verified} live, ${unverified.length} timed-out/firewalled`, level: "warn" });
      }
    }).catch(() => {});
  }

  let structuralGaps: GapItem[] = [];
  if (landscapeText || exposureText) {
    try {
      const parseRes = await openai.chat.completions.create({
        model: "gpt-5-search-api",
        max_completion_tokens: 250,
        messages: [
          {
            role: "system",
            content: "You extract structured gap data from market analysis text. Return ONLY a JSON array with no other text.",
          },
          {
            role: "user",
            content: `Market landscape analysis:
${landscapeText.slice(0, 2000)}

Portfolio risk exposure analysis:
${exposureText.slice(0, 2000)}

Extract portfolio gaps/opportunities/risks. Return EXACTLY this JSON array format:
[{"type":"opportunity","description":"one sentence about the gap","affectedTickers":[],"priority":1}]

Limit to the highest-signal gaps only. Valid types: critical | opportunity | redundancy | mismatch. priority: 1 (highest) to 5 (lowest).`,
          },
        ],
      });

      structuralGaps = extractJsonArray(parseRes.choices?.[0]?.message?.content ?? "[]")
        .filter((gap) =>
          gap &&
          typeof gap.description === "string" &&
          ["critical", "opportunity", "redundancy", "mismatch"].includes(gap.type) &&
          typeof gap.priority === "number"
        )
        .sort((a, b) => a.priority - b.priority);
    } catch {
      structuralGaps = [];
    }
  }

  for (const gap of structuralGaps) {
    emit({ type: "gap_found", description: gap.description, severity: gap.type, tickers: gap.affectedTickers });
  }

  const opportunities = structuralGaps
    .filter((gap) => gap.type === "opportunity")
    .map((gap) => gap.description)
    .join("; ");
  const profileSectors = [profile.sectorsToEmphasize, profile.trackedAccountObjective].filter(Boolean).join(", ");

  emit({ type: "stage_complete", stage: "gap", durationMs: Date.now() - startedAt });

  return {
    gaps: structuralGaps,
    structuralGaps,
    environmentalGaps: [],
    candidateSearchLanes: [],
    searchBrief: opportunities || profileSectors || "diversified growth opportunities",
    profilePreferences: profileSectors,
  };
}

function inferHoldingExposureTags(holdings: HoldingInput[], profile: Record<string, any>): Set<string> {
  const tags = new Set<string>();
  const emphasis = String(profile.sectorsToEmphasize ?? "").toLowerCase();
  const objective = String(profile.trackedAccountObjective ?? "").toLowerCase();

  for (const holding of holdings.filter((holding) => !holding.isCash)) {
    const ticker = holding.ticker.toUpperCase();
    if (["XOM", "CVX", "SLB", "USO"].includes(ticker)) tags.add("energy_supply");
    if (["LMT", "NOC", "RTX", "ITA"].includes(ticker)) tags.add("defense_spending");
    if (["NVDA", "AVGO", "AMD", "SMH", "QQQ"].includes(ticker)) tags.add("ai_infrastructure");
    if (["UPS", "FDX", "UNP"].includes(ticker)) tags.add("logistics_exposure");
    if (["JPM", "BAC", "GS", "SCHW"].includes(ticker)) tags.add("liquidity_defense");
    if (["VOO", "SPY", "IVV"].includes(ticker) && objective.includes("growth")) tags.add("broad_equity_beta");
  }

  if (emphasis.includes("energy")) tags.add("energy_supply");
  if (emphasis.includes("defense")) tags.add("defense_spending");
  if (emphasis.includes("ai")) tags.add("ai_infrastructure");
  if (objective.includes("income") || objective.includes("preservation")) tags.add("rate_resilience");

  return tags;
}

function inferRegimeAlignment(
  themeKey: string,
  regime: { riskMode?: string; rateTrend?: string } | undefined
): EnvironmentalGap["regimeAlignment"] {
  if (!regime) return "neutral";
  if (themeKey === "higher_for_longer_rates" && regime.rateTrend === "rising") return "aligned";
  if (themeKey === "growth_slowdown_risk" && regime.riskMode === "risk-off") return "aligned";
  if (themeKey === "defense_fiscal_upcycle" && regime.riskMode === "risk-on") return "aligned";
  return "neutral";
}

function compareEnvironmentalGaps(a: EnvironmentalGap, b: EnvironmentalGap): number {
  const urgencyOrder = { high: 0, medium: 1, low: 2 };
  const urgencyDelta = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
  if (urgencyDelta !== 0) return urgencyDelta;
  return a.gapId.localeCompare(b.gapId);
}

export function deriveEnvironmentalGaps(input: {
  holdings: HoldingInput[];
  structuralGapReport: GapReport;
  profile: Record<string, any>;
  marketRegime?: { riskMode?: string; rateTrend?: string };
  macroConsensus: MacroThemeConsensusResult;
  macroBridge: MacroExposureBridgeResult;
  candidateSearchLanes?: CandidateSearchLane[];
}): EnvironmentalGap[] {
  const holdingTags = inferHoldingExposureTags(input.holdings, input.profile);
  const structuralGapCount = input.structuralGapReport.structuralGaps.length;
  const gaps: EnvironmentalGap[] = [];

  for (const theme of input.macroConsensus.themes.filter((theme) => theme.actionable)) {
    const bridgeHits = input.macroBridge.hits.filter((hit) => hit.themeId === theme.themeId);
    const exposureTags = [...new Set([
      ...theme.exposureTags,
      ...bridgeHits.flatMap((hit) => hit.exposureTags),
    ])].sort();
    const laneHints = [...new Set([
      ...bridgeHits.flatMap((hit) => hit.laneHints),
    ])].sort();

    const bridgeRuleIds = [...new Set(bridgeHits.map((hit) => hit.ruleId))].sort();
    const missingExposure = exposureTags.some((tag) => !holdingTags.has(tag));
    const urgency: EnvironmentalGap["urgency"] = missingExposure
      ? (theme.severity === "high" ? "high" : "medium")
      : "low";

    gaps.push({
      gapId: `env_gap:${theme.themeKey}`,
      themeId: theme.themeId,
      themeKey: theme.themeKey,
      bridgeRuleIds,
      description: missingExposure
        ? `Environmental macro theme ${theme.themeLabel} suggests underexposed portfolio lanes that merit bounded review.`
        : `Environmental macro theme ${theme.themeLabel} increases review pressure on current exposures without implying a new portfolio gap by itself.`,
      authority: "environmental",
      urgency,
      exposureTags,
      candidateSearchTags: laneHints,
      reviewCurrentHoldings: true,
      reviewCandidates: true,
      openCandidateDiscovery: laneHints.length > 0 && missingExposure,
      regimeAlignment: inferRegimeAlignment(theme.themeKey, input.marketRegime),
      profileAlignment: structuralGapCount > 0 ? "aligned" : "neutral",
      rationaleSummary: `${theme.summary}${bridgeHits.length > 0 ? ` Bridge hits: ${bridgeHits.map((hit) => hit.ruleId).join(", ")}.` : ""}`,
    });
  }

  return gaps.sort(compareEnvironmentalGaps);
}

export const runGapAnalysis = runStructuralGapAnalysis;
