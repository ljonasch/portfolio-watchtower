import type { DiagnosticsStepContract } from "@/lib/contracts";
import { estimateAnalysisCost } from "@/lib/report-cost-estimator";

describe("report cost estimator", () => {
  test("estimates total analysis cost from stored token usage plus research-stage heuristic", () => {
    const diagnostics: { steps: DiagnosticsStepContract[] } = {
      steps: [
        {
          stepKey: "market_regime",
          stepName: "Market Regime",
          status: "ok",
          summary: "ok",
          inputs: {},
          outputs: {},
          metrics: [],
          sources: [],
          warnings: [],
          model: null,
          hashes: { evidenceHash: null, promptHash: null },
          versions: { schemaVersion: null, analysisPolicyVersion: null, viewModelVersion: null },
        },
        {
          stepKey: "gap_scan",
          stepName: "Gap Scan",
          status: "ok",
          summary: "ok",
          inputs: {},
          outputs: {},
          metrics: [],
          sources: [],
          warnings: [],
          model: null,
          hashes: { evidenceHash: null, promptHash: null },
          versions: { schemaVersion: null, analysisPolicyVersion: null, viewModelVersion: null },
        },
        {
          stepKey: "macro_news_collection",
          stepName: "Macro",
          status: "ok",
          summary: "ok",
          inputs: {},
          outputs: {},
          metrics: [],
          sources: [],
          warnings: [],
          model: null,
          hashes: { evidenceHash: null, promptHash: null },
          versions: { schemaVersion: null, analysisPolicyVersion: null, viewModelVersion: null },
        },
        {
          stepKey: "candidate_screening",
          stepName: "Candidates",
          status: "ok",
          summary: "ok",
          inputs: { macroLaneCount: 2 },
          outputs: {},
          metrics: [],
          sources: [],
          warnings: [],
          model: null,
          hashes: { evidenceHash: null, promptHash: null },
          versions: { schemaVersion: null, analysisPolicyVersion: null, viewModelVersion: null },
        },
        {
          stepKey: "news_sources",
          stepName: "News",
          status: "ok",
          summary: "ok",
          inputs: {},
          outputs: {},
          metrics: [],
          sources: [],
          warnings: [],
          model: null,
          hashes: { evidenceHash: null, promptHash: null },
          versions: { schemaVersion: null, analysisPolicyVersion: null, viewModelVersion: null },
        },
      ],
    };

    const result = estimateAnalysisCost({
      primaryModel: "gpt-5.4",
      llmUsage: {
        inputTokens: 20000,
        outputTokens: 4000,
      },
      diagnostics,
    });

    expect(result.inputTokens).toBe(20000);
    expect(result.outputTokens).toBe(4000);
    expect(result.primaryModelCostUsd).toBeCloseTo(0.11, 2);
    expect(result.estimatedResearchCalls).toBe(15);
    expect(result.estimatedResearchCostUsd).toBeCloseTo(0.15, 5);
    expect(result.estimatedTotalCostUsd).toBeCloseTo(0.26, 2);
  });
});
