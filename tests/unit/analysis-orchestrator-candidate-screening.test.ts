const mockOpenAiCreate = jest.fn();
const mockDetectMarketRegime = jest.fn();
const mockRunStructuralGapAnalysisDetailed = jest.fn();
const mockDeriveEnvironmentalGaps = jest.fn();
const mockScreenCandidatesDetailed = jest.fn();
const mockFetchAllNewsWithFallback = jest.fn();
const mockFetchPriceTimelines = jest.fn();
const mockScoreSentimentForAll = jest.fn();
const mockBuildSentimentOverlay = jest.fn();
const mockBuildResearchContext = jest.fn();
const mockCollectMacroNewsEnvironment = jest.fn();
const mockCollectMacroNewsEnvironmentDetailed = jest.fn();
const mockDeriveMacroThemeConsensus = jest.fn();
const mockApplyMacroExposureBridge = jest.fn();
const mockDeriveMacroCandidateSearchLanes = jest.fn();
const mockGeneratePortfolioReport = jest.fn();
const mockCompareRecommendations = jest.fn();
const mockEvaluateAlert = jest.fn();
const mockFetchValuationForAll = jest.fn();
const mockFormatValuationSection = jest.fn();
const mockBuildCorrelationMatrix = jest.fn();
const mockFormatCorrelationSection = jest.fn();
const mockRecordRunStats = jest.fn();
const mockFinalizeAnalysisRun = jest.fn();
const mockBuildFrozenMacroEvidence = jest.fn();
const mockReplayMacroOutputsFromFrozenEvidence = jest.fn();
const mockBuildPromptHash = jest.fn();
const mockWriteEvidencePacket = jest.fn();
const mockUpdateEvidencePacketOutcome = jest.fn();

const mockPrisma = {
  portfolioSnapshot: {
    findUnique: jest.fn(),
  },
  analysisRun: {
    count: jest.fn(),
    create: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  appSettings: {
    findUnique: jest.fn(),
  },
  portfolioReport: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  analysisBundle: {
    findMany: jest.fn(),
  },
};

jest.mock("openai", () =>
  jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockOpenAiCreate,
      },
    },
  }))
);

jest.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

jest.mock("@/lib/research/market-regime", () => ({
  detectMarketRegime: mockDetectMarketRegime,
}));

jest.mock("@/lib/research/gap-analyzer", () => ({
  runStructuralGapAnalysisDetailed: mockRunStructuralGapAnalysisDetailed,
  deriveEnvironmentalGaps: mockDeriveEnvironmentalGaps,
}));

jest.mock("@/lib/research/candidate-screener", () => ({
  screenCandidatesDetailed: mockScreenCandidatesDetailed,
}));

jest.mock("@/lib/research/news-fetcher", () => ({
  fetchAllNewsWithFallback: mockFetchAllNewsWithFallback,
}));

jest.mock("@/lib/research/price-timeline", () => ({
  fetchPriceTimelines: mockFetchPriceTimelines,
}));

jest.mock("@/lib/research/sentiment-scorer", () => ({
  scoreSentimentForAll: mockScoreSentimentForAll,
}));

jest.mock("@/lib/research/signal-aggregator", () => ({
  buildSentimentOverlay: mockBuildSentimentOverlay,
}));

jest.mock("@/lib/research/context-loader", () => ({
  buildResearchContext: mockBuildResearchContext,
}));

jest.mock("@/lib/research/macro-news-environment", () => ({
  collectMacroNewsEnvironment: mockCollectMacroNewsEnvironment,
  collectMacroNewsEnvironmentDetailed: mockCollectMacroNewsEnvironmentDetailed,
}));

jest.mock("@/lib/research/macro-theme-consensus", () => ({
  deriveMacroThemeConsensus: mockDeriveMacroThemeConsensus,
  MACRO_THEME_CONSENSUS_THRESHOLDS: {
    minSupportingArticles: 3,
    minTrustedSupportingArticles: 2,
    minDistinctPublishers: 2,
    minSupportRatio: 0.7,
    minRecentSupportingArticles7d: 2,
  },
}));

jest.mock("@/lib/research/macro-exposure-bridge", () => ({
  applyMacroExposureBridge: mockApplyMacroExposureBridge,
  MACRO_EXPOSURE_BRIDGE_RULES: [
    {
      ruleId: "bridge.defense_procurement",
    },
  ],
}));

jest.mock("@/lib/research/macro-candidate-lanes", () => ({
  deriveMacroCandidateSearchLanes: mockDeriveMacroCandidateSearchLanes,
  PHASE1_MACRO_LANE_REGISTRY: {},
}));

jest.mock("@/lib/analyzer", () => ({
  generatePortfolioReport: mockGeneratePortfolioReport,
  Stage3PreflightBudgetExceededError: class Stage3PreflightBudgetExceededError extends Error {},
}));

jest.mock("@/lib/comparator", () => ({
  compareRecommendations: mockCompareRecommendations,
}));

jest.mock("@/lib/alerts", () => ({
  evaluateAlert: mockEvaluateAlert,
}));

jest.mock("@/lib/research/valuation-fetcher", () => ({
  fetchValuationForAll: mockFetchValuationForAll,
  formatValuationSection: mockFormatValuationSection,
}));

jest.mock("@/lib/research/correlation-matrix", () => ({
  buildCorrelationMatrix: mockBuildCorrelationMatrix,
  formatCorrelationSection: mockFormatCorrelationSection,
}));

jest.mock("@/lib/research/model-tracker", () => ({
  recordRunStats: mockRecordRunStats,
}));

jest.mock("@/lib/services/analysis-lifecycle-service", () => ({
  finalizeAnalysisRun: mockFinalizeAnalysisRun,
}));

jest.mock("@/lib/research/macro-evidence-freeze", () => ({
  buildFrozenMacroEvidence: mockBuildFrozenMacroEvidence,
  replayMacroOutputsFromFrozenEvidence: mockReplayMacroOutputsFromFrozenEvidence,
}));

jest.mock("@/lib/research/evidence-packet-builder", () => ({
  buildPromptHash: mockBuildPromptHash,
  writeEvidencePacket: mockWriteEvidencePacket,
  updateEvidencePacketOutcome: mockUpdateEvidencePacketOutcome,
}));

import { buildCandidateScreeningFingerprint } from "@/lib/research/candidate-screening-fingerprint";
import { buildGapAnalysisFingerprint, GAP_ANALYSIS_REUSE_MAX_AGE_HOURS } from "@/lib/research/gap-analysis-fingerprint";
import { buildMacroReplayContextFingerprint, MACRO_ENVIRONMENT_REUSE_MAX_AGE_HOURS } from "@/lib/research/macro-environment-reuse";
import { runFullAnalysis } from "@/lib/research/analysis-orchestrator";
import type { CandidateSearchLane } from "@/lib/research/types";

const baseLane: CandidateSearchLane = {
  laneId: "macro_lane:defense_fiscal_beneficiaries",
  laneKey: "defense_fiscal_beneficiaries",
  description: "Defense and fiscal beneficiaries.",
  allowedAssetClasses: ["Stocks", "ETFs"],
  searchTags: ["defense primes"],
  priority: 1,
  sortBehavior: "priority_then_ticker" as const,
  origin: "environmental_gap" as const,
  themeIds: ["macro_theme:defense_fiscal_upcycle"],
  environmentalGapIds: ["env_gap:defense_fiscal_upcycle"],
  bridgeRuleIds: ["bridge.defense_procurement"],
  rationaleSummary: "Defense spending upcycle",
};

function buildStoredCandidateScreeningArtifact(fingerprint: string) {
  return {
    candidateScreening: {
      fingerprint,
      mode: "lite",
      candidates: [
        {
          ticker: "LMT",
          companyName: "Lockheed Martin",
          source: "macro_lane",
          candidateOrigin: "macro_lane",
          reason: "Fits defense lane",
          discoveryLaneId: "macro_lane:defense_fiscal_beneficiaries",
          macroThemeIds: ["macro_theme:defense_fiscal_upcycle"],
          environmentalGapIds: ["env_gap:defense_fiscal_upcycle"],
          validatedPrice: 100,
        },
      ],
      diagnostics: {
        triggerType: "manual",
        mode: "lite",
        modeLabel: "lite",
        modeSelection: "explicit_manual_lite",
        fingerprint,
        maxMacroLanes: 2,
        targetValidatedCandidateCount: 3,
        totalProviderPromptCount: 2,
        structuralPromptCount: 1,
        macroLanePromptCount: 1,
        retryCount: 0,
        totalBackoffSeconds: 0,
        rateLimitedPromptCount: 0,
        macroLaneIdsAvailable: ["macro_lane:defense_fiscal_beneficiaries"],
        macroLaneIdsConsidered: ["macro_lane:defense_fiscal_beneficiaries"],
        queriedLaneIds: ["macro_lane:defense_fiscal_beneficiaries"],
        skippedLaneIds: [],
        laneCountQueried: 1,
        laneCountSkipped: 0,
        skippedLanesDueToEnoughSurvivors: 0,
        rawCandidateCount: 1,
        dedupedCandidateCount: 1,
        candidatesSentToPriceValidation: 1,
        validatedSurvivors: 1,
        validatedSurvivorsByOrigin: {
          structural: 0,
          macroLane: 1,
        },
        reuseHit: false,
        reuseSourceBundleId: null,
        reuseMissReason: null,
        stoppedEarly: false,
      },
    },
  };
}

function buildStoredGapAnalysisArtifact(fingerprint: string) {
  return {
    gapAnalysis: {
      fingerprint,
      report: {
        gaps: [
          {
            type: "opportunity",
            description: "Underexposed to infrastructure beneficiaries",
            affectedTickers: ["MSFT"],
            priority: 1,
          },
        ],
        structuralGaps: [
          {
            type: "opportunity",
            description: "Underexposed to infrastructure beneficiaries",
            affectedTickers: ["MSFT"],
            priority: 1,
          },
        ],
        environmentalGaps: [],
        candidateSearchLanes: [],
        searchBrief: "Find high-quality additions.",
        profilePreferences: "Quality growth",
      },
      diagnostics: {
        fingerprint,
        providerCallCount: 2,
        retryCount: 1,
        totalBackoffSeconds: 65,
        maxSingleBackoffSeconds: 65,
        stageLatencyMs: 65010,
        resultState: "fresh",
        reuseHit: false,
        reuseSourceBundleId: null,
        reuseMissReason: null,
      },
    },
  };
}

function buildStoredMacroEvidenceArtifact(replayContextFingerprint: string) {
  return {
    macroEvidence: {
      schemaVersion: "macro_evidence_v1",
      replayContextFingerprint,
      macroEnvironment: {
        availabilityStatus: "primary_success",
        degradedReason: null,
        statusSummary: "Macro ok",
        articleCount: 1,
        trustedArticleCount: 1,
        distinctPublisherCount: 1,
        sourceDiversity: { distinctPublishers: 1, trustedPublishers: 1, trustedRatio: 1 },
        issues: [],
        articles: [
          {
            articleId: "macro_article:1",
            canonicalUrl: "https://www.reuters.com/macro1",
            title: "Macro theme holding steady",
            publisher: "reuters.com",
            publishedAt: null,
            publishedAtBucket: "last_7d",
            trusted: true,
            queryFamily: "rates_inflation_central_banks",
            retrievalReason: "global macro environment",
            topicHints: ["rates"],
            dedupKey: "macro1",
            stableSortKey: "0:0000:https://www.reuters.com/macro1",
            evidenceHash: "macro1",
          },
        ],
      },
      actionableThemeIds: [],
      bridgeHitIds: [],
      macroBridge: {
        statusSummary: "0 hits",
        hits: [],
      },
      environmentalGapIds: [],
      candidateLaneIds: [],
    },
  };
}

function installBaseMocks() {
  process.env.OPENAI_API_KEY = "test-key";
  mockOpenAiCreate.mockResolvedValue({
    choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
  });
  mockPrisma.portfolioSnapshot.findUnique.mockResolvedValue({
    id: "snap_1",
    userId: "user_1",
    createdAt: new Date("2026-04-02T00:00:00.000Z"),
    holdings: [
      {
        id: "holding_1",
        ticker: "MSFT",
        companyName: "Microsoft",
        shares: 10,
        currentPrice: 100,
        currentValue: 1000,
        isCash: false,
      },
    ],
  });
  mockPrisma.analysisRun.count.mockResolvedValue(0);
  mockPrisma.user.findUnique.mockResolvedValue({
    id: "user_1",
    profile: {
      trackedAccountRiskTolerance: "medium",
      permittedAssetClasses: "Stocks, ETFs",
    },
    convictions: [],
  });
  mockPrisma.appSettings.findUnique.mockResolvedValue(null);
  mockPrisma.portfolioReport.findFirst.mockResolvedValue(null);
  mockPrisma.analysisRun.create.mockResolvedValue({ id: "run_1" });
  mockPrisma.portfolioReport.findMany.mockResolvedValue([]);
  mockPrisma.portfolioReport.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.analysisBundle.findMany.mockResolvedValue([]);
  mockDetectMarketRegime.mockResolvedValue({
    riskMode: "risk_on",
    rateTrend: "stable",
    dollarTrend: "stable",
    vix: "normal",
    summary: "Risk-on regime.",
  });
  mockRunStructuralGapAnalysisDetailed.mockImplementation(async (_openai, _holdings, _profile, _today, _emit, options) => ({
    report: {
      gaps: [],
      structuralGaps: [],
      environmentalGaps: [],
      candidateSearchLanes: [],
      searchBrief: "Find high-quality additions.",
      profilePreferences: "Quality growth",
    },
    diagnostics: {
      fingerprint: options?.fingerprint ?? "gap_fp",
      providerCallCount: 2,
      retryCount: 0,
      totalBackoffSeconds: 0,
      maxSingleBackoffSeconds: 0,
      stageLatencyMs: 100,
      resultState: "fresh",
      reuseHit: false,
      reuseSourceBundleId: null,
      reuseMissReason: options?.reuseMissReason ?? null,
    },
  }));
  mockCollectMacroNewsEnvironment.mockResolvedValue({
    availabilityStatus: "primary_success",
    degradedReason: null,
    statusSummary: "Macro ok",
    articleCount: 0,
    trustedArticleCount: 0,
    distinctPublisherCount: 0,
    sourceDiversity: { distinctPublishers: 0, trustedPublishers: 0, trustedRatio: 0 },
    issues: [],
    articles: [],
  });
  mockCollectMacroNewsEnvironmentDetailed.mockResolvedValue({
    macroEnvironment: {
      availabilityStatus: "primary_success",
      degradedReason: null,
      statusSummary: "Macro ok",
      articleCount: 0,
      trustedArticleCount: 0,
      distinctPublisherCount: 0,
      sourceDiversity: { distinctPublishers: 0, trustedPublishers: 0, trustedRatio: 0 },
      issues: [],
      articles: [],
    },
    diagnostics: {
      replayContextFingerprint: "macro_ctx_fp",
      providerCallCount: 7,
      retryCount: 0,
      totalBackoffSeconds: 0,
      maxSingleBackoffSeconds: 0,
      stageLatencyMs: 100,
      resultState: "fresh",
      reuseHit: false,
      reuseSourceBundleId: null,
      reuseMissReason: null,
      queryFamilyCountAttempted: 7,
      queryFamilyCountWithArticles: 0,
      queryFamilyKeysAttempted: [
        "rates_inflation_central_banks",
        "recession_labor_growth",
        "energy_commodities",
        "geopolitics_shipping_supply_chain",
        "regulation_export_controls_ai_policy",
        "credit_liquidity_banking_stress",
        "defense_fiscal_industrial_policy",
      ],
      queryFamilyKeysWithArticles: [],
    },
  });
  mockDeriveMacroThemeConsensus.mockReturnValue({
    availabilityStatus: "primary_success",
    degradedReason: null,
    thresholds: {
      minSupportingArticles: 3,
      minTrustedSupportingArticles: 2,
      minDistinctPublishers: 2,
      minSupportRatio: 0.7,
      minRecentSupportingArticles7d: 2,
    },
    statusSummary: "0 themes",
    themes: [],
  });
  mockApplyMacroExposureBridge.mockReturnValue({
    statusSummary: "0 hits",
    hits: [],
  });
  mockDeriveEnvironmentalGaps.mockReturnValue([]);
  mockDeriveMacroCandidateSearchLanes.mockReturnValue([baseLane]);
  mockFetchAllNewsWithFallback.mockResolvedValue({
    evidence: [],
    combinedSummary: "",
    breaking24h: "",
    allSources: [],
    usingFallback: false,
    availabilityStatus: "primary_success",
    degradedReason: null,
    statusSummary: "News ok",
    issues: [],
    signals: {
      availabilityStatus: "primary_success",
      degradedReason: null,
      articleCount: 0,
      trustedSourceCount: 0,
      sourceDiversityCount: 0,
      recent24hCount: 0,
      recent7dCount: 0,
      directionalSupport: "neutral",
      contradictionLevel: "low",
      catalystPresence: false,
      riskEventPresence: false,
      confidence: "low",
      statusSummary: "News ok",
      tickerSignals: {},
      issues: [],
    },
    fetchedAt: "2026-04-02T00:00:00.000Z",
  });
  mockFetchValuationForAll.mockResolvedValue([]);
  mockBuildCorrelationMatrix.mockResolvedValue({ clusters: [], matrix: [] });
  mockFormatValuationSection.mockReturnValue("");
  mockFormatCorrelationSection.mockReturnValue("");
  mockFetchPriceTimelines.mockImplementation(async (tickers: string[]) =>
    new Map(
      tickers.map((ticker) => [ticker.toUpperCase(), {
        ticker: ticker.toUpperCase(),
        exchange: "NASDAQ",
        dayChangePct: 0,
        marketClosed: false,
        reactions: [],
        bars: [{ close: 100 }],
      }])
    )
  );
  mockScoreSentimentForAll.mockResolvedValue(
    new Map([
      ["MSFT", { ticker: "MSFT", direction: "hold", finalScore: 0, confidence: 0, finbertScore: 0, fingptScore: 0 }],
      ["LMT", { ticker: "LMT", direction: "hold", finalScore: 0, confidence: 0, finbertScore: 0, fingptScore: 0 }],
    ])
  );
  mockBuildSentimentOverlay.mockReturnValue([]);
  mockBuildResearchContext.mockReturnValue({
    today: "2026-04-02",
    age: 40,
    profile: {
      trackedAccountRiskTolerance: "medium",
      permittedAssetClasses: "Stocks, ETFs",
    },
    frozenProfileJson: "{}",
    constraints: {},
    holdings: [
      {
        ticker: "MSFT",
        companyName: "Microsoft",
        shares: 10,
        currentPrice: 100,
        currentValue: 1000,
        computedValue: 1000,
        computedWeight: 100,
        isCash: false,
      },
    ],
    totalValue: 1000,
    priorRecommendations: [],
    customPrompt: undefined,
  });
  mockBuildFrozenMacroEvidence.mockImplementation((input: any) => ({
    schemaVersion: "macro_evidence_v1",
    replayContextFingerprint: input.replayContextFingerprint ?? undefined,
    macroEnvironment: input.macroEnvironment,
    actionableThemeIds: [],
    bridgeHitIds: [],
    macroBridge: input.macroBridge,
    environmentalGapIds: [],
    candidateLaneIds: input.candidateSearchLanes.map((lane: any) => lane.laneId),
  }));
  mockReplayMacroOutputsFromFrozenEvidence.mockImplementation((input: any) => ({
    macroEnvironment: input.frozenMacroEvidence.macroEnvironment,
    macroConsensus: mockDeriveMacroThemeConsensus.mock.results.at(-1)?.value ?? {
      availabilityStatus: "primary_success",
      degradedReason: null,
      thresholds: {
        minSupportingArticles: 3,
        minTrustedSupportingArticles: 2,
        minDistinctPublishers: 2,
        minSupportRatio: 0.7,
        minRecentSupportingArticles7d: 2,
      },
      statusSummary: "0 themes",
      themes: [],
    },
    macroBridge: input.frozenMacroEvidence.macroBridge,
    environmentalGaps: [],
    candidateSearchLanes: [baseLane],
  }));
  mockBuildPromptHash.mockReturnValue("prompt_hash");
  mockWriteEvidencePacket.mockResolvedValue("packet_1");
  mockUpdateEvidencePacketOutcome.mockResolvedValue(undefined);
  mockGeneratePortfolioReport.mockResolvedValue({
    summary: "Summary",
    reasoning: "Reasoning",
    marketContext: {},
    recommendations: [
      {
        ticker: "MSFT",
        companyName: "Microsoft",
        role: "Core",
        currentShares: 10,
        currentPrice: 100,
        targetShares: 10,
        shareDelta: 0,
        dollarDelta: 0,
        currentWeight: 100,
        targetWeight: 100,
        acceptableRangeLow: 95,
        acceptableRangeHigh: 105,
        valueDelta: 0,
        action: "Hold",
        confidence: "medium",
        positionStatus: "on_target",
        evidenceQuality: "medium",
        thesisSummary: "Keep core holding",
        detailedReasoning: "Stable core holding",
        whyChanged: "",
        reasoningSources: [],
      },
    ],
    watchlistIdeas: [],
  });
  mockCompareRecommendations.mockReturnValue([]);
  mockEvaluateAlert.mockReturnValue({ level: "green", reason: null });
  mockFinalizeAnalysisRun.mockResolvedValue({
    runId: "run_1",
    bundleId: "bundle_new",
    reportId: "report_new",
    outcome: "validated",
  });
  mockRecordRunStats.mockResolvedValue(undefined);
}

describe("analysis orchestrator candidate screening reuse gate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installBaseMocks();
  });

  test("matching prior bundle evidence fingerprint reuses screened candidates and skips fresh screening for an explicit manual lite run", async () => {
    const fingerprint = buildCandidateScreeningFingerprint({
      mode: "lite",
      structuralSearchBrief: "Find high-quality additions.",
      macroCandidateSearchLanes: [baseLane],
      existingTickers: ["MSFT"],
      permittedAssetClasses: "Stocks, ETFs",
      riskTolerance: "medium",
    });
    mockPrisma.analysisBundle.findMany.mockResolvedValue([
      {
        id: "bundle_reuse",
        evidencePacketJson: JSON.stringify(buildStoredCandidateScreeningArtifact(fingerprint)),
      },
    ]);

    const emit = jest.fn();
    const result = await runFullAnalysis("snap_1", undefined, emit, "manual", "user", undefined, "lite");

    expect(mockScreenCandidatesDetailed).not.toHaveBeenCalled();
    expect(mockFinalizeAnalysisRun).toHaveBeenCalled();
    expect(mockFinalizeAnalysisRun.mock.calls.at(-1)?.[0]?.evidencePacket?.candidateScreening?.diagnostics).toEqual(
      expect.objectContaining({
        reuseHit: true,
        reuseSourceBundleId: "bundle_reuse",
        totalProviderPromptCount: 0,
      })
    );
    expect(mockFinalizeAnalysisRun.mock.calls.at(-1)?.[0]?.evidencePacket?.candidateScreening?.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticker: "LMT", candidateOrigin: "macro_lane" }),
      ])
    );
    expect(result.reportId).toBe("report_new");
  });

  test("changed fingerprint falls through to fresh screening in an explicit manual lite run", async () => {
    mockPrisma.analysisBundle.findMany.mockResolvedValue([
      {
        id: "bundle_old",
        evidencePacketJson: JSON.stringify(buildStoredCandidateScreeningArtifact("different_fp")),
      },
    ]);
    mockScreenCandidatesDetailed.mockResolvedValue({
      candidates: [
        {
          ticker: "AAPL",
          companyName: "Apple",
          source: "gap_screener",
          candidateOrigin: "structural",
          reason: "Structural fit",
          validatedPrice: 100,
        },
      ],
      diagnostics: {
        triggerType: "manual",
        mode: "lite",
        modeLabel: "lite",
        modeSelection: "explicit_manual_lite",
        fingerprint: "ignored_here",
        maxMacroLanes: 2,
        targetValidatedCandidateCount: 3,
        totalProviderPromptCount: 1,
        structuralPromptCount: 1,
        macroLanePromptCount: 0,
        retryCount: 0,
        totalBackoffSeconds: 0,
        rateLimitedPromptCount: 0,
        macroLaneIdsAvailable: ["macro_lane:defense_fiscal_beneficiaries"],
        macroLaneIdsConsidered: ["macro_lane:defense_fiscal_beneficiaries"],
        queriedLaneIds: [],
        skippedLaneIds: ["macro_lane:defense_fiscal_beneficiaries"],
        laneCountQueried: 0,
        laneCountSkipped: 1,
        skippedLanesDueToEnoughSurvivors: 1,
        rawCandidateCount: 1,
        dedupedCandidateCount: 1,
        candidatesSentToPriceValidation: 1,
        validatedSurvivors: 1,
        validatedSurvivorsByOrigin: {
          structural: 1,
          macroLane: 0,
        },
        reuseHit: false,
        reuseSourceBundleId: null,
        reuseMissReason: null,
        stoppedEarly: true,
      },
    });

    const emit = jest.fn();
    await runFullAnalysis("snap_1", undefined, emit, "manual", "user", undefined, "lite");

    expect(mockScreenCandidatesDetailed).toHaveBeenCalledTimes(1);
    expect(mockScreenCandidatesDetailed.mock.calls[0]?.[7]).toEqual(
      expect.objectContaining({
        mode: "lite",
        triggerType: "manual",
        modeLabel: "lite",
        modeSelection: "explicit_manual_lite",
      })
    );
    expect(mockFinalizeAnalysisRun.mock.calls.at(-1)?.[0]?.evidencePacket?.candidateScreening?.diagnostics).toEqual(
      expect.objectContaining({
        reuseHit: false,
        reuseMissReason: "no_matching_bundle_fingerprint",
        totalProviderPromptCount: 1,
      })
    );
  });

  test("scheduled runs default to full screening even when no manual override is provided", async () => {
    mockPrisma.analysisBundle.findMany.mockResolvedValue([
      {
        id: "bundle_reuse",
        evidencePacketJson: JSON.stringify(buildStoredCandidateScreeningArtifact("irrelevant_fp")),
      },
    ]);
    mockScreenCandidatesDetailed.mockResolvedValue({
      candidates: [],
      diagnostics: {
        triggerType: "scheduled",
        mode: "full",
        modeLabel: "normal",
        modeSelection: "default_normal",
        fingerprint: "ignored_here",
        maxMacroLanes: null,
        targetValidatedCandidateCount: 5,
        totalProviderPromptCount: 1,
        structuralPromptCount: 1,
        macroLanePromptCount: 0,
        retryCount: 0,
        totalBackoffSeconds: 0,
        rateLimitedPromptCount: 0,
        macroLaneIdsAvailable: ["macro_lane:defense_fiscal_beneficiaries"],
        macroLaneIdsConsidered: ["macro_lane:defense_fiscal_beneficiaries"],
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
      },
    });

    await runFullAnalysis("snap_1", undefined, jest.fn(), "scheduled", "cron");

    expect(mockPrisma.analysisBundle.findMany).toHaveBeenCalledTimes(2);
    expect(mockScreenCandidatesDetailed).toHaveBeenCalledTimes(1);
    expect(mockScreenCandidatesDetailed.mock.calls[0]?.[7]).toEqual(
      expect.objectContaining({
        mode: "full",
        triggerType: "scheduled",
        modeLabel: "normal",
        modeSelection: "default_normal",
      })
    );
  });

  test("matching latest finalized gap-analysis artifact reuses structural gaps and skips fresh gap provider calls", async () => {
    const fingerprint = buildGapAnalysisFingerprint({
      holdings: [
        { ticker: "MSFT", currentWeight: 100, isCash: false },
      ],
      profile: {
        trackedAccountObjective: undefined,
        sectorsToEmphasize: undefined,
      },
    });
    mockPrisma.analysisBundle.findMany.mockResolvedValue([
      {
        id: "bundle_gap_reuse",
        finalizedAt: new Date("2026-04-02T12:00:00.000Z"),
        evidencePacketJson: JSON.stringify(buildStoredGapAnalysisArtifact(fingerprint)),
      },
    ]);
    mockScreenCandidatesDetailed.mockResolvedValue({
      candidates: [],
      diagnostics: {
        triggerType: "manual",
        mode: "full",
        modeLabel: "normal",
        modeSelection: "default_normal",
        fingerprint: "screen_fp",
        maxMacroLanes: null,
        targetValidatedCandidateCount: 5,
        totalProviderPromptCount: 1,
        structuralPromptCount: 1,
        macroLanePromptCount: 0,
        retryCount: 0,
        totalBackoffSeconds: 0,
        rateLimitedPromptCount: 0,
        macroLaneIdsAvailable: ["macro_lane:defense_fiscal_beneficiaries"],
        macroLaneIdsConsidered: ["macro_lane:defense_fiscal_beneficiaries"],
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
      },
    });

    await runFullAnalysis("snap_1", undefined, jest.fn(), "manual", "user");

    expect(mockRunStructuralGapAnalysisDetailed).not.toHaveBeenCalled();
    expect(mockFinalizeAnalysisRun.mock.calls.at(-1)?.[0]?.evidencePacket?.gapAnalysis?.diagnostics).toEqual(
      expect.objectContaining({
        reuseHit: true,
        reuseSourceBundleId: "bundle_gap_reuse",
        resultState: "frozen_artifact_reuse",
        providerCallCount: 0,
      })
    );
  });

  test("changed gap fingerprint falls through to fresh structural gap analysis", async () => {
    mockPrisma.analysisBundle.findMany.mockResolvedValue([
      {
        id: "bundle_gap_old",
        finalizedAt: new Date("2026-04-02T12:00:00.000Z"),
        evidencePacketJson: JSON.stringify(buildStoredGapAnalysisArtifact("different_gap_fp")),
      },
    ]);
    mockScreenCandidatesDetailed.mockResolvedValue({
      candidates: [],
      diagnostics: {
        triggerType: "manual",
        mode: "full",
        modeLabel: "normal",
        modeSelection: "default_normal",
        fingerprint: "screen_fp",
        maxMacroLanes: null,
        targetValidatedCandidateCount: 5,
        totalProviderPromptCount: 1,
        structuralPromptCount: 1,
        macroLanePromptCount: 0,
        retryCount: 0,
        totalBackoffSeconds: 0,
        rateLimitedPromptCount: 0,
        macroLaneIdsAvailable: ["macro_lane:defense_fiscal_beneficiaries"],
        macroLaneIdsConsidered: ["macro_lane:defense_fiscal_beneficiaries"],
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
      },
    });

    await runFullAnalysis("snap_1", undefined, jest.fn(), "manual", "user");

    expect(mockRunStructuralGapAnalysisDetailed).toHaveBeenCalledTimes(1);
    expect(mockFinalizeAnalysisRun.mock.calls.at(-1)?.[0]?.evidencePacket?.gapAnalysis?.diagnostics).toEqual(
      expect.objectContaining({
        reuseHit: false,
        reuseMissReason: "gap_fingerprint_mismatch",
      })
    );
  });

  test("stale gap artifacts force a fresh structural gap analysis even on exact fingerprint match", async () => {
    const staleFingerprint = buildGapAnalysisFingerprint({
      holdings: [
        { ticker: "MSFT", currentWeight: 100, isCash: false },
      ],
      profile: {
        trackedAccountObjective: undefined,
        sectorsToEmphasize: undefined,
      },
    });
    const staleFinalizedAt = new Date(Date.now() - ((GAP_ANALYSIS_REUSE_MAX_AGE_HOURS + 2) * 60 * 60 * 1000));
    mockPrisma.analysisBundle.findMany.mockResolvedValue([
      {
        id: "bundle_gap_stale",
        finalizedAt: staleFinalizedAt,
        evidencePacketJson: JSON.stringify(buildStoredGapAnalysisArtifact(staleFingerprint)),
      },
    ]);
    mockScreenCandidatesDetailed.mockResolvedValue({
      candidates: [],
      diagnostics: {
        triggerType: "manual",
        mode: "full",
        modeLabel: "normal",
        modeSelection: "default_normal",
        fingerprint: "screen_fp",
        maxMacroLanes: null,
        targetValidatedCandidateCount: 5,
        totalProviderPromptCount: 1,
        structuralPromptCount: 1,
        macroLanePromptCount: 0,
        retryCount: 0,
        totalBackoffSeconds: 0,
        rateLimitedPromptCount: 0,
        macroLaneIdsAvailable: ["macro_lane:defense_fiscal_beneficiaries"],
        macroLaneIdsConsidered: ["macro_lane:defense_fiscal_beneficiaries"],
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
      },
    });

    await runFullAnalysis("snap_1", undefined, jest.fn(), "manual", "user");

    expect(mockRunStructuralGapAnalysisDetailed).toHaveBeenCalledTimes(1);
    expect(mockFinalizeAnalysisRun.mock.calls.at(-1)?.[0]?.evidencePacket?.gapAnalysis?.diagnostics).toEqual(
      expect.objectContaining({
        reuseHit: false,
        reuseMissReason: "stale_finalized_gap_analysis",
      })
    );
  });

  test("matching latest finalized frozen macro evidence reuses macro collection and skips fresh provider calls", async () => {
    const macroReplayContextFingerprint = buildMacroReplayContextFingerprint({
      holdings: [
        { ticker: "MSFT", computedWeight: 100, isCash: false },
      ],
      profile: {
        trackedAccountObjective: undefined,
        sectorsToEmphasize: undefined,
      },
      structuralGapReport: {
        gaps: [],
        structuralGaps: [],
        environmentalGaps: [],
        candidateSearchLanes: [],
        searchBrief: "Find high-quality additions.",
        profilePreferences: "Quality growth",
      },
      marketRegime: {
        riskMode: "risk_on",
        rateTrend: "stable",
      },
    });
    mockPrisma.analysisBundle.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "bundle_macro_reuse",
          finalizedAt: new Date(Date.now() - (6 * 60 * 60 * 1000)),
          evidencePacketJson: JSON.stringify(buildStoredMacroEvidenceArtifact(macroReplayContextFingerprint)),
        },
      ]);

    await runFullAnalysis("snap_1", undefined, jest.fn(), "manual", "user");

    expect(mockCollectMacroNewsEnvironmentDetailed).not.toHaveBeenCalled();
    expect(mockReplayMacroOutputsFromFrozenEvidence).toHaveBeenCalledTimes(2);
    expect(mockFinalizeAnalysisRun.mock.calls.at(-1)?.[0]?.evidencePacket?.diagnosticsArtifact?.steps.find((step: any) => step.stepKey === "macro_news_collection")?.outputs).toEqual(
      expect.objectContaining({
        providerPressureState: "frozen_artifact_reuse",
        providerCallCount: 0,
        queryFamilyCountAttempted: 0,
      })
    );
    expect(mockFinalizeAnalysisRun.mock.calls.at(-1)?.[0]?.evidencePacket?.macroEvidence).toEqual(
      expect.objectContaining({
        replayContextFingerprint: macroReplayContextFingerprint,
      })
    );
  });

  test("changed macro replay context falls through to fresh macro collection", async () => {
    mockPrisma.analysisBundle.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "bundle_macro_old",
          finalizedAt: new Date(Date.now() - (6 * 60 * 60 * 1000)),
          evidencePacketJson: JSON.stringify(buildStoredMacroEvidenceArtifact("different_macro_ctx")),
        },
      ]);

    await runFullAnalysis("snap_1", undefined, jest.fn(), "manual", "user");

    expect(mockCollectMacroNewsEnvironmentDetailed).toHaveBeenCalledTimes(1);
    expect(mockCollectMacroNewsEnvironmentDetailed.mock.calls[0]?.[3]).toEqual(
      expect.objectContaining({
        reuseMissReason: "macro_replay_context_mismatch",
      })
    );
  });

  test("stale finalized macro evidence forces a fresh macro collection even on exact replay-context match", async () => {
    const macroReplayContextFingerprint = buildMacroReplayContextFingerprint({
      holdings: [
        { ticker: "MSFT", computedWeight: 100, isCash: false },
      ],
      profile: {
        trackedAccountObjective: undefined,
        sectorsToEmphasize: undefined,
      },
      structuralGapReport: {
        gaps: [],
        structuralGaps: [],
        environmentalGaps: [],
        candidateSearchLanes: [],
        searchBrief: "Find high-quality additions.",
        profilePreferences: "Quality growth",
      },
      marketRegime: {
        riskMode: "risk_on",
        rateTrend: "stable",
      },
    });
    const staleFinalizedAt = new Date(Date.now() - ((MACRO_ENVIRONMENT_REUSE_MAX_AGE_HOURS + 2) * 60 * 60 * 1000));
    mockPrisma.analysisBundle.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "bundle_macro_stale",
          finalizedAt: staleFinalizedAt,
          evidencePacketJson: JSON.stringify(buildStoredMacroEvidenceArtifact(macroReplayContextFingerprint)),
        },
      ]);

    await runFullAnalysis("snap_1", undefined, jest.fn(), "manual", "user");

    expect(mockCollectMacroNewsEnvironmentDetailed).toHaveBeenCalledTimes(1);
    expect(mockCollectMacroNewsEnvironmentDetailed.mock.calls[0]?.[3]).toEqual(
      expect.objectContaining({
        reuseMissReason: "stale_finalized_macro_evidence",
      })
    );
  });
});
