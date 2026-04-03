import { buildRunDiagnosticsArtifact } from "@/lib/research/analysis-orchestrator";

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
        searchBrief: "One gap found.",
      },
      candidates: [{ ticker: "AVGO", companyName: "Broadcom", reason: "AI infra gap", source: "gap_screener" }],
      newsResult: {
        allSources: [{ title: "News item", url: "https://example.com", source: "example", publishedAt: null }],
        breaking24h: [{ title: "Breaking" }],
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
      existingHoldingsCount: 6,
      allTickers: ["AAPL", "MSFT", "AVGO", "NVDA"],
      sources: [{ title: "News item", url: "https://example.com", source: "example", publishedAt: null }],
    });

    expect(artifact.bundleId).toBe("pending");
    expect(artifact.steps.map((step) => step.stepKey)).toEqual([
      "market_regime",
      "gap_scan",
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
        outcomeExplanation: "1 candidate(s) passed screening and were advanced into the analyzed ticker set.",
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "news_sources")?.inputs).toEqual(
      expect.objectContaining({
        searchWindow: "Breaking 24h plus broader 30-day company, sector, and macro search",
      })
    );
    expect(artifact.steps.find((step) => step.stepKey === "gpt5_reasoning")?.outputs).toEqual(
      expect.objectContaining({
        recommendationCount: 2,
        outputSummary: "Add AI infrastructure exposure while trimming overlapping software risk.",
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
});
