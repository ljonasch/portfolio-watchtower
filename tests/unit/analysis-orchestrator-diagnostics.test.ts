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
      candidates: [{ ticker: "AVGO", companyName: "Broadcom", reason: "AI infra gap" }],
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
        recommendations: [{ ticker: "AVGO" }, { ticker: "MSFT" }],
        watchlistIdeas: [{ ticker: "NVDA" }],
      },
      validationSummary: {
        hardErrorCount: 0,
        warningCount: 1,
        reasonCodes: ["thin_evidence"],
      },
      adjudicatorNotes: { AVGO: { confidence: "medium" } },
      perSectionChars: { news: 1200 },
      totalInputChars: 4200,
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
    }
    expect(artifact.steps.find((step) => step.stepKey === "gap_scan")?.inputs).toEqual(
      expect.objectContaining({
        note: "No explicit input telemetry was captured for this step in this run.",
      })
    );
  });
});
