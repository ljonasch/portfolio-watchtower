/**
 * Stage 0-C/D: Candidate Stock Screener
 * Structural search brief plus bounded macro lane inputs.
 */

import type { ProgressEvent } from "./progress-events";
import {
  buildCandidateScreeningFingerprint,
  CANDIDATE_SCREENING_MODE_RULES,
  expandCandidateScreeningAliases,
  selectMacroLanesForScreening,
  sortMacroLanesForScreening,
} from "./candidate-screening-fingerprint";
import type {
  CandidateScreeningDiagnostics,
  CandidateScreeningMode,
  CandidateScreeningResult,
  CandidateSearchLane,
  ScreenedCandidate,
  ScreenedCandidateSource,
} from "./types";

interface RawCandidate {
  ticker: string;
  companyName: string;
  source: ScreenedCandidateSource;
  candidateOrigin: "structural" | "macro_lane";
  reason: string;
  catalyst?: string;
  analystRating?: string;
  discoveryLaneId?: string | null;
  macroThemeIds?: string[];
  environmentalGapIds?: string[];
}

interface ScreeningPromptConfig {
  source: ScreenedCandidateSource;
  candidateOrigin: "structural" | "macro_lane";
  discoveryLaneId: string | null;
  prompt: string;
  macroThemeIds?: string[];
  environmentalGapIds?: string[];
}

export interface ScreenCandidatesOptions {
  mode?: CandidateScreeningMode;
  fingerprint?: string;
}

function candidateSourcePriority(source: ScreenedCandidateSource): number {
  switch (source) {
    case "gap_screener":
      return 0;
    case "macro_lane":
      return 1;
    case "momentum":
      return 2;
    default:
      return 3;
  }
}

function compareCandidatesDeterministically(a: ScreenedCandidate, b: ScreenedCandidate): number {
  const sourceDelta = candidateSourcePriority(a.source) - candidateSourcePriority(b.source);
  if (sourceDelta !== 0) return sourceDelta;

  const laneDelta = String(a.discoveryLaneId ?? "").localeCompare(String(b.discoveryLaneId ?? ""));
  if (laneDelta !== 0) return laneDelta;

  const tickerDelta = a.ticker.localeCompare(b.ticker);
  if (tickerDelta !== 0) return tickerDelta;

  const companyDelta = a.companyName.localeCompare(b.companyName);
  if (companyDelta !== 0) return companyDelta;

  return a.reason.localeCompare(b.reason);
}

async function validateCandidatePrice(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;

    const json: any = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;

    const price: number = result.meta?.regularMarketPrice ?? 0;
    if (price <= 0.01) return null;

    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const validCloses = closes.filter((close) => typeof close === "number" && close > 0);
    if (validCloses.length >= 2) {
      const first = validCloses[0];
      const last = validCloses[validCloses.length - 1];
      const dropPct = ((last - first) / first) * 100;
      if (dropPct < -10) {
        return null;
      }
    }

    return price;
  } catch {
    return null;
  }
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

function summarizeMacroLanes(lanes: CandidateSearchLane[]): string {
  if (lanes.length === 0) {
    return "";
  }

  return lanes
    .map((lane) => `${lane.laneKey}: ${lane.description}. Search tags: ${lane.searchTags.join(", ")}.`)
    .join("\n");
}

function buildMacroLaneMap(lanes: CandidateSearchLane[]): Map<string, CandidateSearchLane> {
  return new Map(lanes.map((lane) => [lane.laneId, lane]));
}

function buildStructuralPrompt(input: {
  today: string;
  structuralSearchBrief: string;
  excluded: string;
  permittedAssets: string;
  liquidityReq: string;
}): string {
  return `Today is ${input.today}. Find 3-4 stocks that fill this portfolio structural gap: "${input.structuralSearchBrief}".

Requirements:
- NOT any of these: ${input.excluded}
- Asset types: ${input.permittedAssets}
- ${input.liquidityReq}
- Currently rated Buy or Strong Buy by at least 1 major analyst
- Must have a specific event catalyst from the last 30 days

Return ONLY a JSON array:
[{"ticker":"SYMBOL","companyName":"Name","reason":"why this fills the structural gap","catalyst":"specific event and date","analystRating":"rating or none"}]`;
}

function buildMacroLanePrompt(input: {
  today: string;
  lane: CandidateSearchLane;
  excluded: string;
  permittedAssets: string;
  liquidityReq: string;
}): string {
  return `Today is ${input.today}. Search only within this bounded macro candidate lane:
${summarizeMacroLanes([input.lane])}

Requirements:
- NOT any of these: ${input.excluded}
- Asset types: ${input.permittedAssets}
- ${input.liquidityReq}
- Currently rated Buy or Strong Buy by at least 1 major analyst
- Must have a specific catalyst or business support reason from the last 30 days
- The result must fit the lane; do not invent unrelated names

Return ONLY a JSON array:
[{"ticker":"SYMBOL","companyName":"Name","reason":"why this fits the lane","catalyst":"specific event and date","analystRating":"rating or none"}]`;
}

function buildEmptyDiagnostics(input: {
  mode: CandidateScreeningMode;
  fingerprint: string;
  macroLaneIdsAvailable: string[];
  macroLaneIdsConsidered: string[];
}): CandidateScreeningDiagnostics {
  const modeRules = CANDIDATE_SCREENING_MODE_RULES[input.mode];
  return {
    mode: input.mode,
    fingerprint: input.fingerprint,
    maxMacroLanes: modeRules.maxMacroLanes,
    targetValidatedCandidateCount: modeRules.targetValidatedCandidateCount,
    totalProviderPromptCount: 0,
    structuralPromptCount: 0,
    macroLanePromptCount: 0,
    retryCount: 0,
    totalBackoffSeconds: 0,
    rateLimitedPromptCount: 0,
    macroLaneIdsAvailable: input.macroLaneIdsAvailable,
    macroLaneIdsConsidered: input.macroLaneIdsConsidered,
    queriedLaneIds: [],
    skippedLaneIds: [],
    laneCountQueried: 0,
    laneCountSkipped: 0,
    skippedLanesDueToEnoughSurvivors: 0,
    rawCandidateCount: 0,
    dedupedCandidateCount: 0,
    candidatesSentToPriceValidation: 0,
    validatedSurvivors: 0,
    validatedSurvivorsByOrigin: {
      structural: 0,
      macroLane: 0,
    },
    reuseHit: false,
    reuseSourceBundleId: null,
    reuseMissReason: null,
    stoppedEarly: false,
  };
}

function trackSkippedLane(
  diagnostics: CandidateScreeningDiagnostics,
  laneId: string,
  options?: { dueToEnoughSurvivors?: boolean }
): void {
  if (!diagnostics.skippedLaneIds.includes(laneId)) {
    diagnostics.skippedLaneIds.push(laneId);
    diagnostics.laneCountSkipped += 1;
  }

  if (options?.dueToEnoughSurvivors) {
    diagnostics.skippedLanesDueToEnoughSurvivors += 1;
  }
}

function buildRawCandidatesFromItems(input: {
  items: any[];
  promptConfig: ScreeningPromptConfig;
  seenTickers: Set<string>;
  emit: (event: ProgressEvent) => void;
  diagnostics: CandidateScreeningDiagnostics;
}): RawCandidate[] {
  const acceptedCandidates: RawCandidate[] = [];
  input.diagnostics.rawCandidateCount += input.items.length;

  for (const item of input.items) {
    const ticker = String(item.ticker ?? "").toUpperCase().replace(/[^A-Z0-9.]/g, "");
    if (!ticker || ticker.length > 6) continue;
    if (input.seenTickers.has(ticker)) continue;

    const aliasMatch = Array.from(expandCandidateScreeningAliases([ticker])).some((alias) => input.seenTickers.has(alias));
    if (aliasMatch) {
      input.emit({ type: "log", message: `${ticker}: skipped - already held under alias`, level: "info" });
      continue;
    }

    input.seenTickers.add(ticker);
    acceptedCandidates.push({
      ticker,
      companyName: String(item.companyName ?? "").slice(0, 60),
      source: input.promptConfig.source,
      candidateOrigin: input.promptConfig.candidateOrigin,
      reason: String(item.reason ?? "").slice(0, 220),
      catalyst: item.catalyst ? String(item.catalyst).slice(0, 200) : undefined,
      analystRating: item.analystRating ? String(item.analystRating).slice(0, 50) : undefined,
      discoveryLaneId: input.promptConfig.discoveryLaneId,
      macroThemeIds: input.promptConfig.macroThemeIds,
      environmentalGapIds: input.promptConfig.environmentalGapIds,
    });
  }

  input.diagnostics.dedupedCandidateCount += acceptedCandidates.length;
  input.diagnostics.candidatesSentToPriceValidation += acceptedCandidates.length;
  return acceptedCandidates;
}

async function validateAcceptedCandidates(input: {
  rawCandidates: RawCandidate[];
  emit: (event: ProgressEvent) => void;
}): Promise<ScreenedCandidate[]> {
  if (input.rawCandidates.length === 0) {
    return [];
  }

  input.emit({
    type: "log",
    message: `Validating ${input.rawCandidates.length} candidates via price check...`,
    level: "info",
  });

  const validationResults: Array<ScreenedCandidate | null> = await Promise.all(
    input.rawCandidates.map(async (candidate) => {
      const price = await validateCandidatePrice(candidate.ticker);
      if (price === null) {
        input.emit({ type: "log", message: `${candidate.ticker}: REJECTED - no live price (delisted or hallucinated)`, level: "warn" });
        return null;
      }

      return {
        ...candidate,
        validatedPrice: price,
      };
    })
  );

  return validationResults.filter((candidate): candidate is ScreenedCandidate => candidate !== null);
}

export async function screenCandidatesDetailed(
  openai: any,
  existingTickers: string[],
  structuralSearchBrief: string,
  macroCandidateSearchLanes: CandidateSearchLane[],
  profile: Record<string, any>,
  today: string,
  emit: (e: ProgressEvent) => void,
  options: ScreenCandidatesOptions = {}
): Promise<CandidateScreeningResult> {
  emit({
    type: "stage_start",
    stage: "candidates",
    label: "Candidate Stock Screening",
    detail: "Structural gap-targeted screening plus bounded macro candidate lanes",
  });
  const t0 = Date.now();

  const mode = options.mode ?? "full";
  const excluded = existingTickers.join(", ");
  const riskTolerance = profile.trackedAccountRiskTolerance ?? "medium";
  const permittedAssets = profile.permittedAssetClasses ?? "Stocks, ETFs";
  const liquidityReq = riskTolerance === "low"
    ? "liquid, established companies with >$5B market cap"
    : "liquid with average daily volume >500K shares";

  const excludedSet = expandCandidateScreeningAliases(existingTickers);
  const allSortedMacroLanes = sortMacroLanesForScreening(macroCandidateSearchLanes);
  const laneSelection = selectMacroLanesForScreening(macroCandidateSearchLanes, mode);
  const laneMap = buildMacroLaneMap(allSortedMacroLanes);
  const fingerprint = options.fingerprint
    ?? buildCandidateScreeningFingerprint({
      mode,
      structuralSearchBrief,
      macroCandidateSearchLanes,
      existingTickers,
      permittedAssetClasses: permittedAssets,
      riskTolerance,
    });
  const diagnostics = buildEmptyDiagnostics({
    mode,
    fingerprint,
    macroLaneIdsAvailable: allSortedMacroLanes.map((lane) => lane.laneId),
    macroLaneIdsConsidered: laneSelection.selected.map((lane) => lane.laneId),
  });
  for (const skippedLane of laneSelection.skippedByMode) {
    trackSkippedLane(diagnostics, skippedLane.laneId);
  }

  async function fetchWithRetry(promptConfig: ScreeningPromptConfig, attempt = 1): Promise<any> {
    diagnostics.totalProviderPromptCount += 1;
    if (promptConfig.candidateOrigin === "structural") {
      diagnostics.structuralPromptCount += 1;
    } else {
      diagnostics.macroLanePromptCount += 1;
    }

    try {
      return await openai.chat.completions.create({
        model: "gpt-5-search-api",
        max_completion_tokens: 350,
        messages: [{ role: "user", content: promptConfig.prompt }],
      });
    } catch (err: any) {
      if (err?.status === 429 && attempt < 8) {
        diagnostics.retryCount += 1;
        diagnostics.rateLimitedPromptCount += 1;
        diagnostics.totalBackoffSeconds += 65;
        emit({ type: "log", message: "Candidate screener rate limit hit, waiting 65s...", level: "warn" });
        await new Promise((resolve) => setTimeout(resolve, 65000));
        return fetchWithRetry(promptConfig, attempt + 1);
      }
      if (err?.status === 429) {
        diagnostics.rateLimitedPromptCount += 1;
      }
      emit({ type: "log", message: `Candidate screen failed: ${err?.message}`, level: "warn" });
      return null;
    }
  }

  const seenTickers = new Set(excludedSet);
  const validated: ScreenedCandidate[] = [];
  const targetValidatedCandidateCount = diagnostics.targetValidatedCandidateCount;

  const structuralPrompt: ScreeningPromptConfig = {
    source: "gap_screener",
    candidateOrigin: "structural",
    discoveryLaneId: null,
    prompt: buildStructuralPrompt({
      today,
      structuralSearchBrief,
      excluded,
      permittedAssets,
      liquidityReq,
    }),
  };

  const structuralResponse = await fetchWithRetry(structuralPrompt);
  const structuralItems = extractJsonArray(structuralResponse?.choices?.[0]?.message?.content ?? "");
  const structuralRawCandidates = buildRawCandidatesFromItems({
    items: structuralItems,
    promptConfig: structuralPrompt,
    seenTickers,
    emit,
    diagnostics,
  });
  validated.push(
    ...(await validateAcceptedCandidates({
      rawCandidates: structuralRawCandidates,
      emit,
    }))
  );

  if (validated.length >= targetValidatedCandidateCount && laneSelection.selected.length > 0) {
    diagnostics.stoppedEarly = true;
    for (const lane of laneSelection.selected) {
      trackSkippedLane(diagnostics, lane.laneId, { dueToEnoughSurvivors: true });
    }
    emit({
      type: "log",
      message: `Candidate screening stop-early: structural survivors already met the ${targetValidatedCandidateCount}-candidate target for ${mode} mode.`,
      level: "info",
    });
  } else {
    for (let index = 0; index < laneSelection.selected.length; index += 1) {
      const lane = laneSelection.selected[index];
      if (validated.length >= targetValidatedCandidateCount) {
        diagnostics.stoppedEarly = true;
        for (const remainingLane of laneSelection.selected.slice(index)) {
          trackSkippedLane(diagnostics, remainingLane.laneId, { dueToEnoughSurvivors: true });
        }
        emit({
          type: "log",
          message: `Candidate screening stop-early: ${validated.length} validated candidates already survived after lane-boundary checks.`,
          level: "info",
        });
        break;
      }

      diagnostics.queriedLaneIds.push(lane.laneId);
      diagnostics.laneCountQueried += 1;
      const promptConfig: ScreeningPromptConfig = {
        source: "macro_lane",
        candidateOrigin: "macro_lane",
        discoveryLaneId: lane.laneId,
        macroThemeIds: lane.themeIds,
        environmentalGapIds: lane.environmentalGapIds,
        prompt: buildMacroLanePrompt({
          today,
          lane,
          excluded,
          permittedAssets,
          liquidityReq,
        }),
      };
      const response = await fetchWithRetry(promptConfig);
      const items = extractJsonArray(response?.choices?.[0]?.message?.content ?? "");
      const rawCandidates = buildRawCandidatesFromItems({
        items,
        promptConfig,
        seenTickers,
        emit,
        diagnostics,
      });
      validated.push(
        ...(await validateAcceptedCandidates({
          rawCandidates,
          emit,
        }))
      );
    }
  }

  const validatedSorted = validated.sort(compareCandidatesDeterministically);
  diagnostics.validatedSurvivors = validatedSorted.length;
  diagnostics.validatedSurvivorsByOrigin = {
    structural: validatedSorted.filter((candidate) => candidate.candidateOrigin === "structural").length,
    macroLane: validatedSorted.filter((candidate) => candidate.candidateOrigin === "macro_lane").length,
  };

  for (const candidate of validatedSorted) {
    const lane = candidate.discoveryLaneId ? laneMap.get(candidate.discoveryLaneId) : null;
    emit({
      type: "candidate_found",
      ticker: candidate.ticker,
      companyName: candidate.companyName,
      source: candidate.source,
      reason: lane ? `${candidate.reason} [lane: ${lane.laneKey}]` : candidate.reason,
      catalyst: candidate.catalyst,
    });
  }

  emit({
    type: "log",
    message: `Candidates: ${validatedSorted.length} validated, ${diagnostics.candidatesSentToPriceValidation - validatedSorted.length} rejected`,
    level: "info",
  });
  emit({ type: "stage_complete", stage: "candidates", durationMs: Date.now() - t0 });
  return {
    candidates: validatedSorted,
    diagnostics,
  };
}

export async function screenCandidates(
  openai: any,
  existingTickers: string[],
  structuralSearchBrief: string,
  macroCandidateSearchLanes: CandidateSearchLane[],
  profile: Record<string, any>,
  today: string,
  emit: (e: ProgressEvent) => void,
  options: ScreenCandidatesOptions = {}
): Promise<ScreenedCandidate[]> {
  const result = await screenCandidatesDetailed(
    openai,
    existingTickers,
    structuralSearchBrief,
    macroCandidateSearchLanes,
    profile,
    today,
    emit,
    options
  );
  return result.candidates;
}
