import { buildMacroAnalyzerSummary, buildRunDiagnosticsArtifact } from "@/lib/research/analysis-orchestrator";

describe("analysis orchestrator diagnostics", () => {
  test("builds a typed diagnostics artifact from persisted run signals", () => {
    const artifact = buildRunDiagnosticsArtifact({
      bundleId: "pending",
      runId: "run_1",
      outcome: "validated",
      generatedAt: "2026-04-02T00:00:00.000Z",
      evidencePacketId: "packet_1",
      evidenceHash: "evidence_hash",
      promptHash: "prompt_hash",
      versions: {
        schemaVersion: "v1",
        analysisPolicyVersion: "v1",
        viewModelVersion: "v1",
        promptVersion: "prompt_hash",
      },
      primaryModel: "gpt-5.4",
      responseHash: "response_hash",
      usingFallbackNews: false,
      regime: {
        riskMode: "risk_on",
        rateTrend: "falling",
        summary: "Risk-on regime with easing rates.",
      },
      gapReport: {
        gaps: [{ ticker: "AVGO", companyName: "Broadcom", reason: "AI infra gap" }],
        structuralGaps: [{ type: "opportunity", description: "AI infra gap", priority: 1 }],
        environmentalGaps: [
          {
            gapId: "env_gap:defense_fiscal_upcycle",
            themeId: "macro_theme:defense_fiscal_upcycle",
            themeKey: "defense_fiscal_upcycle",
            bridgeRuleIds: ["bridge.defense_procurement"],
            description: "Defense exposure underweight",
            authority: "environmental",
            urgency: "medium",
            exposureTags: ["defense_spending"],
            candidateSearchTags: ["defense_fiscal_beneficiaries"],
            reviewCurrentHoldings: true,
            reviewCandidates: true,
            openCandidateDiscovery: true,
            regimeAlignment: "aligned",
            profileAlignment: "aligned",
            rationaleSummary: "Defense macro theme opened a bounded discovery lane.",
          },
        ],
        candidateSearchLanes: [
          {
            laneId: "macro_lane:defense_fiscal_beneficiaries",
            laneKey: "defense_fiscal_beneficiaries",
            description: "Defense lane",
            allowedAssetClasses: ["Stocks", "ETFs"],
            searchTags: ["defense primes"],
            priority: 2,
            sortBehavior: "priority_then_ticker",
            origin: "environmental_gap",
            themeIds: ["macro_theme:defense_fiscal_upcycle"],
            environmentalGapIds: ["env_gap:defense_fiscal_upcycle"],
            bridgeRuleIds: ["bridge.defense_procurement"],
            rationaleSummary: "Defense macro theme opened a bounded discovery lane.",
          },
        ],
        searchBrief: "One gap found.",
      },
      macroEnvironment: {
        availabilityStatus: "primary_success",
        degradedReason: null,
        statusSummary: "Macro-news collection succeeded across the fixed global query families for this run.",
        articleCount: 3,
        trustedArticleCount: 3,
        distinctPublisherCount: 3,
        sourceDiversity: { distinctPublishers: 3, trustedPublishers: 3, trustedRatio: 1 },
        issues: [],
        articles: [
          {
            articleId: "macro_article:1",
            canonicalUrl: "https://www.reuters.com/macro1",
            title: "Defense budgets climb across NATO",
            publisher: "reuters.com",
            publishedAt: null,
            publishedAtBucket: "last_7d",
            trusted: true,
            queryFamily: "defense_fiscal_industrial_policy",
            retrievalReason: "global macro environment",
            topicHints: ["defense", "nato"],
            dedupKey: "macro1",
            stableSortKey: "0:0000:https://www.reuters.com/macro1",
            evidenceHash: "macro1",
          },
        ],
      },
      macroConsensus: {
        availabilityStatus: "primary_success",
        degradedReason: null,
        thresholds: {
          minSupportingArticles: 3,
          minTrustedSupportingArticles: 2,
          minDistinctPublishers: 2,
          minSupportRatio: 0.7,
          minRecentSupportingArticles7d: 2,
        },
        statusSummary: "1 macro theme(s) cleared the deterministic consensus gate out of 1 observed theme(s).",
        themes: [
          {
            themeId: "macro_theme:defense_fiscal_upcycle",
            themeKey: "defense_fiscal_upcycle",
            themeLabel: "Defense / Fiscal / Industrial Policy",
            queryFamilies: ["defense_fiscal_industrial_policy"],
            supportingArticleIds: ["macro_article:1", "macro_article:2", "macro_article:3"],
            counterArticleIds: [],
            supportingArticleCount: 3,
            trustedSupportingCount: 3,
            distinctPublisherCount: 3,
            supportRatio: 1,
            contradictionLevel: "low",
            recentSupportingCount7d: 3,
            confidence: "high",
            severity: "medium",
            actionable: true,
            exposureTags: ["defense_spending"],
            candidateSearchTags: ["defense primes"],
            summary: "Defense theme reached the phase-1 gate.",
          },
        ],
      },
      macroBridge: {
        statusSummary: "1 deterministic macro exposure bridge hit(s) were produced from actionable macro themes.",
        hits: [
          {
            bridgeHitId: "macro_theme:defense_fiscal_upcycle:bridge.defense_procurement:nato",
            ruleId: "bridge.defense_procurement",
            themeId: "macro_theme:defense_fiscal_upcycle",
            matchedToken: "nato",
            exposureTags: ["defense_spending", "industrial_policy"],
            environmentalGapHints: ["procurement_beneficiary_review", "industrial_policy_beneficiary_review"],
            laneHints: ["defense_fiscal_beneficiaries"],
            sectorTags: ["Defense"],
            sensitivityTags: ["policy_beneficiary"],
            rationaleSummary: "Defense bridge fired",
          },
        ],
      },
      environmentalGaps: [
        {
          gapId: "env_gap:defense_fiscal_upcycle",
          themeId: "macro_theme:defense_fiscal_upcycle",
          themeKey: "defense_fiscal_upcycle",
          bridgeRuleIds: ["bridge.defense_procurement"],
          description: "Defense exposure underweight",
          authority: "environmental",
          urgency: "medium",
          exposureTags: ["defense_spending"],
          candidateSearchTags: ["defense_fiscal_beneficiaries"],
          reviewCurrentHoldings: true,
          reviewCandidates: true,
          openCandidateDiscovery: true,
          regimeAlignment: "aligned",
          profileAlignment: "aligned",
          rationaleSummary: "Defense macro theme opened a bounded discovery lane.",
        },
      ],
      candidateSearchLanes: [
        {
          laneId: "macro_lane:defense_fiscal_beneficiaries",
          laneKey: "defense_fiscal_beneficiaries",
          description: "Defense lane",
          allowedAssetClasses: ["Stocks", "ETFs"],
          searchTags: ["defense primes"],
          priority: 2,
          sortBehavior: "priority_then_ticker",
          origin: "environmental_gap",
          themeIds: ["macro_theme:defense_fiscal_upcycle"],
          environmentalGapIds: ["env_gap:defense_fiscal_upcycle"],
          bridgeRuleIds: ["bridge.defense_procurement"],
          rationaleSummary: "Defense macro theme opened a bounded discovery lane.",
        },
      ],
      candidates: [{ ticker: "AVGO", companyName: "Broadcom", reason: "AI infra gap", source: "gap_screener", candidateOrigin: "structural" }],
      newsResult: {
        availabilityStatus: "primary_success",
        degradedReason: null,
        statusSummary: "Primary live-news search succeeded and produced cited sources for this run.",
        issues: [],
        signals: {
          articleCount: 1,
          sourceDiversityCount: 1,
          confidence: "medium",
          directionalSupport: "positive",
        },
        allSources: [{ title: "News item", url: "https://example.com", source: "example", publishedAt: null }],
        breaking24h: "Breaking",
        combinedSummary: "Combined summary",
      },
      sentimentSignals: new Map([
        ["AVGO", { finbertScore: 0.6, fingptScore: 0 }],
      ]),
      sentimentOverlay: [{ ticker: "AVGO", stance: "positive" }],
      reportData: {
        summary: "Add AI infrastructure exposure while trimming overlapping software risk.",
        recommendations: [
          { ticker: "AVGO", companyName: "Broadcom", action: "Buy", thesisSummary: "Improves AI infrastructure exposure." },
          { ticker: "MSFT", companyName: "Microsoft", action: "Hold", thesisSummary: "Maintains core platform exposure." },
        ],
        watchlistIdeas: [{ ticker: "NVDA", companyName: "NVIDIA" }],
      },
      validationSummary: {
        hardErrorCount: 0,
        warningCount: 1,
        reasonCodes: ["thin_evidence"],
      },
      adjudicatorNotes: { AVGO: { confidence: "medium" } },
      perSectionChars: { news: 1200 },
      totalInputChars: 4200,
      contextBudget: {
        maxTotalChars: 16000,
        initialTotalChars: 5100,
        finalTotalChars: 4200,
        fitsBudget: true,
        trimmingApplied: true,
        trimmedSections: ["news30d"],
      },
      existingHoldingsCount: 6,
      allTickers: ["AAPL", "MSFT", "AVGO", "NVDA"],
      sources: [{ title: "News item", url: "https://example.com", source: "example", publishedAt: null }],
    });

    expect(artifact.bundleId).toBe("pending");
    expect(artifact.steps.map((step) => step.stepKey)).toEqual([
      "market_regime",
      "gap_scan",
      "macro_news_collection",
      "macro_theme_consensus",
      "macro_exposure_bridge",
      "environmental_gaps",
      "macro_candidate_lanes",
      "candidate_screening",
      "news_sources",
      "sentiment",
      "gpt5_reasoning",
      "validation_finalization",
    ]);
    expect(artifact.steps.find((step) => step.stepKey === "news_sources")?.sources).toHaveLength(1);
    expect(artifact.steps.find((step) => step.stepKey === "gpt5_reasoning")?.model).toEqual(
      expect.objectContaining({ name: "gpt-5.4", responseHash: "response_hash" })
    );
    for (const step of artifact.steps) {
      expect(Object.keys(step.inputs).length).toBeGreaterThan(0);
      expect(Object.keys(step.outputs).length).toBeGreaterThan(0);
      expect(Object.keys(step.inputs).some((key) => key !== "note")).toBe(true);
      expect(Object.keys(step.outputs).some((key) => key !== "note")).toBe(true);
      for (const warning of step.warnings) {
        expect(warning.warningId).toBeTruthy();
      }
    }
    expect(artifact.steps.find((step) => step.stepKey === "candidate_screening")?.inputs).toEqual(
      expect.objectContaining({
        heldTickerCount: 6,
        screeningGoal: "One gap found.",
        categoriesConsidered: "Existing holdings plus externally screened candidates were considered.",
        rankingBasis: "Gap fit and externally screened candidate reasoning.",
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "candidate_screening")?.outputs).toEqual(
      expect.objectContaining({
        screenedInCount: 1,
        screenedInByOrigin: {
          structural: 1,
          macroLane: 0,
        },
        outcomeExplanation: "1 candidate(s) passed screening and were advanced into the analyzed ticker set.",
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "news_sources")?.inputs).toEqual(
      expect.objectContaining({
        searchWindow: "Breaking 24h plus broader 30-day company, sector, and macro search",
        newsAvailabilityStatus: "primary_success",
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "news_sources")?.outputs).toEqual(
      expect.objectContaining({
        outcomeExplanation: "Primary live-news search succeeded and produced cited sources for this run.",
        newsSupportStrength: "positive support, medium confidence, 1 distinct source domain(s).",
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "gpt5_reasoning")?.outputs).toEqual(
      expect.objectContaining({
        recommendationCount: 2,
        outputSummary: "Add AI infrastructure exposure while trimming overlapping software risk.",
        contextBudgetSummary: "Stage 3 context was trimmed deterministically from 5100 to 4200 chars before the primary reasoning call.",
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "gpt5_reasoning")?.inputs).toEqual(
      expect.objectContaining({
        contextBudget: expect.objectContaining({
          maxTotalChars: 16000,
          trimmingApplied: true,
          trimmedSections: ["news30d"],
        }),
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "market_regime")?.inputs).toEqual(
      expect.objectContaining({
        indicatorsReviewed: [
          "CBOE VIX volatility",
          "US 10-year Treasury yield",
          "US Dollar Index",
        ],
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "gap_scan")?.outputs).toEqual(
      expect.objectContaining({
        outcomeExplanation: "1 material portfolio gap(s) were identified from the current holdings and profile context.",
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "macro_theme_consensus")?.outputs).toEqual(
      expect.objectContaining({
        actionableThemeCount: 1,
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "macro_exposure_bridge")?.outputs).toEqual(
      expect.objectContaining({
        hitCount: 1,
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "macro_candidate_lanes")?.outputs).toEqual(
      expect.objectContaining({
        laneCount: 1,
      })
    );
  });

  test("gap scan clearly distinguishes a clean no-gap result from degraded inputs", () => {
    const cleanNoGapArtifact = buildRunDiagnosticsArtifact({
      bundleId: "pending",
      runId: "run_clean",
      outcome: "validated",
      generatedAt: "2026-04-02T00:00:00.000Z",
      evidencePacketId: "packet_1",
      evidenceHash: "evidence_hash",
      promptHash: "prompt_hash",
      versions: {
        schemaVersion: "v1",
        analysisPolicyVersion: "v1",
        viewModelVersion: "v1",
      },
      primaryModel: "gpt-5.4",
      responseHash: "response_hash",
      gapReport: {
        gaps: [],
        searchBrief: "Look for concentration risk and missing themes.",
        profilePreferences: "AI, healthcare",
      },
      reportData: { recommendations: [] },
      validationSummary: {
        hardErrorCount: 0,
        warningCount: 0,
        reasonCodes: [],
      },
      existingHoldingsCount: 6,
      allTickers: ["AAPL", "MSFT", "AVGO"],
    });

    const degradedArtifact = buildRunDiagnosticsArtifact({
      bundleId: "pending",
      runId: "run_degraded",
      outcome: "validated",
      generatedAt: "2026-04-02T00:00:00.000Z",
      evidencePacketId: "packet_1",
      evidenceHash: "evidence_hash",
      promptHash: "prompt_hash",
      versions: {
        schemaVersion: "v1",
        analysisPolicyVersion: "v1",
        viewModelVersion: "v1",
      },
      primaryModel: "gpt-5.4",
      responseHash: "response_hash",
      gapReport: {
        gaps: [],
      },
      reportData: { recommendations: [] },
      validationSummary: {
        hardErrorCount: 0,
        warningCount: 0,
        reasonCodes: [],
      },
    });

    expect(cleanNoGapArtifact.steps.find((step) => step.stepKey === "gap_scan")).toEqual(
      expect.objectContaining({
        status: "ok",
        outputs: expect.objectContaining({
          outcomeExplanation: "The gap scan ran successfully and found no material portfolio gaps worth actioning in this run.",
          emptyResultReason: "No material gaps cleared the step's threshold for surfacing in this run.",
        }),
      })
    );

    expect(degradedArtifact.steps.find((step) => step.stepKey === "gap_scan")).toEqual(
      expect.objectContaining({
        status: "warning",
        outputs: expect.objectContaining({
          outcomeExplanation: "Gap scan degraded because the run did not persist enough holdings or search-basis context to explain an empty result confidently.",
        }),
        warnings: [
          expect.objectContaining({
            code: "gap_scan_inputs_incomplete",
          }),
        ],
      })
    );
  });

  test("candidate screening clearly explains a no-pass result", () => {
    const artifact = buildRunDiagnosticsArtifact({
      bundleId: "pending",
      runId: "run_candidates",
      outcome: "validated",
      generatedAt: "2026-04-02T00:00:00.000Z",
      evidencePacketId: "packet_1",
      evidenceHash: "evidence_hash",
      promptHash: "prompt_hash",
      versions: {
        schemaVersion: "v1",
        analysisPolicyVersion: "v1",
        viewModelVersion: "v1",
      },
      primaryModel: "gpt-5.4",
      responseHash: "response_hash",
      gapReport: {
        gaps: [],
        searchBrief: "Find external candidates that fill missing healthcare exposure.",
      },
      candidates: [],
      reportData: { recommendations: [] },
      validationSummary: {
        hardErrorCount: 0,
        warningCount: 0,
        reasonCodes: [],
      },
      existingHoldingsCount: 5,
      allTickers: ["AAPL", "MSFT", "LLY", "UNH", "CASH"],
    });

    expect(artifact.steps.find((step) => step.stepKey === "candidate_screening")).toEqual(
      expect.objectContaining({
        status: "ok",
        inputs: expect.objectContaining({
          heldTickerCount: 5,
          screeningGoal: "Find external candidates that fill missing healthcare exposure.",
        }),
        outputs: expect.objectContaining({
          screenedInCount: 0,
          outcomeExplanation: "Candidate screening ran and no external candidates passed the screen for this run.",
          emptyResultReason: "No screened candidates met the bar to be advanced into the final analyzed set.",
        }),
      })
    );
  });

  test("news diagnostics distinguish degraded primary transport failure from true no-news", () => {
    const degradedArtifact = buildRunDiagnosticsArtifact({
      bundleId: "pending",
      runId: "run_news_degraded",
      outcome: "validated",
      generatedAt: "2026-04-02T00:00:00.000Z",
      evidencePacketId: "packet_1",
      evidenceHash: "evidence_hash",
      promptHash: "prompt_hash",
      versions: {
        schemaVersion: "v1",
        analysisPolicyVersion: "v1",
        viewModelVersion: "v1",
      },
      primaryModel: "gpt-5.4",
      responseHash: "response_hash",
      usingFallbackNews: true,
      newsResult: {
        availabilityStatus: "fallback_success",
        degradedReason: "primary_transport_failure",
        statusSummary: "Primary live-news search failed due to a connection/provider issue, so Yahoo Finance fallback headlines were used.",
        issues: [
          { kind: "primary_transport_failure", message: "Connection error.", severity: "warning" },
          { kind: "fallback_used", message: "Yahoo Finance fallback headlines supplied usable coverage for this run.", severity: "info" },
        ],
        signals: {
          articleCount: 2,
          sourceDiversityCount: 1,
          confidence: "low",
          directionalSupport: "neutral",
        },
        breaking24h: "",
        combinedSummary: "Fallback summary",
        allSources: [{ title: "Fallback item", url: "https://finance.yahoo.com/apple", source: "yahoo", publishedAt: null }],
      },
      reportData: { recommendations: [] },
      validationSummary: {
        hardErrorCount: 0,
        warningCount: 0,
        reasonCodes: [],
      },
      allTickers: ["AAPL"],
    });

    expect(degradedArtifact.steps.find((step) => step.stepKey === "news_sources")).toEqual(
      expect.objectContaining({
        status: "ok",
        inputs: expect.objectContaining({
          searchWindow: "Yahoo Finance fallback headlines",
          degradedReason: "primary_transport_failure",
        }),
        outputs: expect.objectContaining({
          outcomeExplanation: "Primary live-news search failed due to a connection/provider issue, so Yahoo Finance fallback headlines were used.",
        }),
      })
    );
  });

  test("repeated news rate-limit warnings are aggregated and assigned stable ids", () => {
    const artifact = buildRunDiagnosticsArtifact({
      bundleId: "pending",
      runId: "run_news_rate_limit",
      outcome: "validated",
      generatedAt: "2026-04-02T00:00:00.000Z",
      evidencePacketId: "packet_1",
      evidenceHash: "evidence_hash",
      promptHash: "prompt_hash",
      versions: {
        schemaVersion: "v1",
        analysisPolicyVersion: "v1",
        viewModelVersion: "v1",
      },
      primaryModel: "gpt-5.4",
      responseHash: "response_hash",
      usingFallbackNews: true,
      newsResult: {
        availabilityStatus: "fallback_success",
        degradedReason: "primary_rate_limited",
        statusSummary: "Primary live-news search was rate-limited, so Yahoo Finance fallback headlines were used.",
        issues: [
          { kind: "primary_rate_limited", message: "Rate limit (429) hit for model gpt-5-search-api. Waiting 65 seconds before retrying." },
          { kind: "primary_rate_limited", message: "Rate limit (429) hit for model gpt-5-search-api. Waiting 65 seconds before retrying." },
          { kind: "fallback_used", message: "Yahoo Finance fallback headlines supplied usable coverage for this run." },
        ],
        signals: {
          articleCount: 2,
          sourceDiversityCount: 1,
          confidence: "low",
          directionalSupport: "neutral",
        },
        breaking24h: "",
        combinedSummary: "Fallback summary",
        allSources: [{ title: "Fallback item", url: "https://finance.yahoo.com/apple", source: "yahoo", publishedAt: null }],
      },
      reportData: { recommendations: [] },
      validationSummary: {
        hardErrorCount: 0,
        warningCount: 0,
        reasonCodes: [],
      },
      allTickers: ["AAPL"],
    });

    const newsStep = artifact.steps.find((step) => step.stepKey === "news_sources");
    expect(newsStep?.warnings).toHaveLength(2);
    expect(newsStep?.warnings[0]).toEqual(
      expect.objectContaining({
        code: "primary_rate_limited",
        message: "Primary live-news search was rate-limited 2 time(s) during this run. Yahoo Finance fallback headlines were used afterward.",
        warningId: expect.stringContaining("news_sources:primary_rate_limited:"),
      })
    );
  });

  test("macro analyzer summary contains normalized summaries only and omits raw article titles", () => {
    const summary = buildMacroAnalyzerSummary({
      macroEnvironment: {
        availabilityStatus: "primary_success",
        degradedReason: null,
        statusSummary: "Macro collection succeeded.",
        articleCount: 3,
        trustedArticleCount: 3,
        distinctPublisherCount: 3,
        sourceDiversity: { distinctPublishers: 3, trustedPublishers: 3, trustedRatio: 1 },
        issues: [],
        articles: [
          {
            articleId: "macro_article:1",
            canonicalUrl: "https://www.reuters.com/macro1",
            title: "Red Sea attacks force carriers onto longer routes",
            publisher: "reuters.com",
            publishedAt: null,
            publishedAtBucket: "last_7d",
            trusted: true,
            queryFamily: "geopolitics_shipping_supply_chain",
            retrievalReason: "global macro environment",
            topicHints: ["shipping", "war"],
            dedupKey: "macro1",
            stableSortKey: "0:0000:https://www.reuters.com/macro1",
            evidenceHash: "macro1",
          },
        ],
      },
      macroConsensus: {
        availabilityStatus: "primary_success",
        degradedReason: null,
        thresholds: {
          minSupportingArticles: 3,
          minTrustedSupportingArticles: 2,
          minDistinctPublishers: 2,
          minSupportRatio: 0.7,
          minRecentSupportingArticles7d: 2,
        },
        statusSummary: "1 macro theme cleared the gate.",
        themes: [
          {
            themeId: "macro_theme:shipping_disruption",
            themeKey: "shipping_disruption",
            themeLabel: "Shipping / Supply Chain Disruption",
            queryFamilies: ["geopolitics_shipping_supply_chain"],
            supportingArticleIds: ["macro_article:1", "macro_article:2", "macro_article:3"],
            counterArticleIds: [],
            supportingArticleCount: 3,
            trustedSupportingCount: 3,
            distinctPublisherCount: 3,
            supportRatio: 1,
            contradictionLevel: "low",
            recentSupportingCount7d: 3,
            confidence: "high",
            severity: "medium",
            actionable: true,
            exposureTags: ["supply_chain_resilience"],
            candidateSearchTags: ["shipping resilience"],
            summary: "Shipping disruption cleared the gate.",
          },
        ],
      },
      macroBridge: {
        statusSummary: "1 bridge hit",
        hits: [
          {
            bridgeHitId: "hit1",
            ruleId: "bridge.shipping_corridors",
            themeId: "macro_theme:shipping_disruption",
            matchedToken: "red sea",
            exposureTags: ["supply_chain_resilience", "logistics_exposure"],
            environmentalGapHints: ["supply_chain_concentration_review", "logistics_resilience_review"],
            laneHints: ["shipping_resilience"],
            sectorTags: ["Industrials"],
            sensitivityTags: ["supply_chain_risk"],
            rationaleSummary: "Shipping bridge hit",
          },
        ],
      },
      environmentalGaps: [
        {
          gapId: "env_gap:shipping_disruption",
          themeId: "macro_theme:shipping_disruption",
          themeKey: "shipping_disruption",
          bridgeRuleIds: ["bridge.shipping_corridors"],
          description: "Shipping resilience gap",
          authority: "environmental",
          urgency: "high",
          exposureTags: ["supply_chain_resilience"],
          candidateSearchTags: ["shipping_resilience"],
          reviewCurrentHoldings: true,
          reviewCandidates: true,
          openCandidateDiscovery: true,
          regimeAlignment: "neutral",
          profileAlignment: "aligned",
          rationaleSummary: "Shipping gap",
        },
      ],
      candidateSearchLanes: [
        {
          laneId: "macro_lane:shipping_resilience",
          laneKey: "shipping_resilience",
          description: "Shipping lane",
          allowedAssetClasses: ["Stocks", "ETFs"],
          searchTags: ["shipping resilience"],
          priority: 4,
          sortBehavior: "priority_then_ticker",
          origin: "environmental_gap",
          themeIds: ["macro_theme:shipping_disruption"],
          environmentalGapIds: ["env_gap:shipping_disruption"],
          bridgeRuleIds: ["bridge.shipping_corridors"],
          rationaleSummary: "Shipping gap opened bounded lane",
        },
      ],
    });

    expect(summary).toContain("Actionable themes:");
    expect(summary).toContain("Macro candidate lanes:");
    expect(summary).not.toContain("Red Sea attacks force carriers onto longer routes");
  });
});
