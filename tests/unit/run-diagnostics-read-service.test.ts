jest.mock("@/lib/prisma", () => ({
  prisma: {
    analysisBundle: {
      findUnique: jest.fn(),
    },
    analysisRun: {
      findUnique: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getRunDiagnostics } from "@/lib/read-models";

describe("run diagnostics read service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("reads persisted diagnostics artifact from the bundle-owned evidence packet", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      sourceRunId: "run_1",
      bundleOutcome: "validated",
      finalizedAt: new Date("2026-04-02T00:00:00.000Z"),
      evidenceHash: "evidence_hash",
      schemaVersion: "v1",
      analysisPolicyVersion: "v1",
      viewModelVersion: "v1",
      primaryModel: "gpt-5.4",
      promptVersion: "prompt_hash",
      llmResponseHash: "response_hash",
      evidencePacketJson: JSON.stringify({
        diagnosticsArtifact: {
          bundleId: "bundle_1",
          runId: "run_1",
          outcome: "validated",
          generatedAt: "2026-04-02T00:00:00.000Z",
          evidencePacketId: "packet_1",
          steps: [
            {
              stepKey: "market_regime",
              stepName: "Market Regime",
              status: "ok",
              summary: "Risk-on.",
              inputs: {
                evidencePacketId: "packet_1",
              },
              outputs: {},
              metrics: [],
              sources: [],
              warnings: [],
              model: null,
              hashes: { evidenceHash: "evidence_hash", promptHash: "prompt_hash" },
              versions: { schemaVersion: "v1", analysisPolicyVersion: "v1", viewModelVersion: "v1" },
            },
          ],
        },
      }),
    });

    const result = await getRunDiagnostics("bundle_1");

    expect(result?.artifactMeta.bundleId).toBe("bundle_1");
    expect(result?.steps).toHaveLength(1);
    expect(result?.diagnosticsState).toEqual(
      expect.objectContaining({
        hasPersistedArtifact: true,
        artifactSource: "persisted",
        stepCount: 1,
      })
    );
    for (const step of result?.steps ?? []) {
      expect(Object.keys(step.inputs).length).toBeGreaterThan(0);
      expect(Object.keys(step.outputs).length).toBeGreaterThan(0);
    }
    expect(result?.steps[0]?.inputs).toEqual(
      expect.objectContaining({
        note: "This step reviewed the current macro regime using volatility, rates, and dollar context available for the run.",
      })
    );
    expect(result?.steps[0]?.outputs).toEqual(
      expect.objectContaining({
        note: "This step did not persist a detailed market-regime conclusion beyond the stored status summary.",
      })
    );
    expect(prisma.analysisRun.findUnique).not.toHaveBeenCalled();
  });

  test("synthesizes diagnostics from persisted backend fields when older bundles lack the artifact", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_legacy",
      sourceRunId: "run_legacy",
      bundleOutcome: "validated",
      finalizedAt: new Date("2026-04-02T00:00:00.000Z"),
      evidenceHash: "evidence_hash",
      schemaVersion: "v1",
      analysisPolicyVersion: "v1",
      viewModelVersion: "v1",
      primaryModel: "gpt-5.4",
      promptVersion: "prompt_hash",
      llmResponseHash: "response_hash",
      evidencePacketJson: JSON.stringify({
        evidencePacketId: "packet_1",
        promptHash: "prompt_hash",
      }),
      validationSummaryJson: JSON.stringify({
        hardErrorCount: 0,
        warningCount: 1,
        reasonCodes: ["low_source_density"],
      }),
      sourceListJson: JSON.stringify([
        { title: "News item", url: "https://example.com", source: "example", publishedAt: null },
      ]),
    });
    (prisma.analysisRun.findUnique as jest.Mock).mockResolvedValue({
      qualityMeta: JSON.stringify({
        promptHash: "prompt_hash",
        evidencePacketId: "packet_1",
        usingFallbackNews: true,
        adjudicatorTickers: ["MSFT"],
        totalInputChars: 1234,
        systemVerification: {
          marketRegime: { status: "risk_on", rationale: "Supportive setup" },
          gapAnalysis: { status: "2 gaps", rationale: "Two gaps" },
          candidateScreening: { status: "3 added", rationale: "Three candidates" },
          fastSearchResearch: { status: "5 sources", rationale: "" },
          finbertSentiment: { status: "4 scored", rationale: "" },
          gpt5Strategic: { status: "2 recs", rationale: "" },
          sentimentOverlay: { overlay: [{ ticker: "MSFT" }] },
        },
      }),
    });

    const result = await getRunDiagnostics("bundle_legacy");

    expect(result?.artifactMeta.bundleId).toBe("bundle_legacy");
    expect(result?.steps).toHaveLength(7);
    expect(result?.diagnosticsState).toEqual(
      expect.objectContaining({
        hasPersistedArtifact: false,
        artifactSource: "fallback",
        stepCount: 7,
      })
    );
    for (const step of result?.steps ?? []) {
      expect(Object.keys(step.inputs).length).toBeGreaterThan(0);
      expect(Object.keys(step.outputs).length).toBeGreaterThan(0);
      expect(Object.keys(step.inputs).some((key) => key !== "note")).toBe(true);
      expect(Object.keys(step.outputs).some((key) => key !== "note")).toBe(true);
    }
    expect(result?.steps.find((step) => step.stepKey === "gap_scan")?.inputs).toEqual(
      expect.objectContaining({
        portfolioReview: "Existing holdings were reviewed for concentration, redundancy, and missing themes.",
      })
    );
    expect(result?.steps.find((step) => step.stepKey === "candidate_screening")?.outputs).toEqual(
      expect.objectContaining({
        screeningResult: "3 added",
        rationale: "Three candidates",
      })
    );
    expect(result?.steps.find((step) => step.stepKey === "news_sources")?.outputs).toEqual(
      expect.objectContaining({
        sourceCoverage: "5 sources",
        topSourceTitles: ["News item"],
      })
    );
    expect(result?.steps.find((step) => step.stepKey === "news_sources")?.sources).toHaveLength(1);
    expect(result?.steps.find((step) => step.stepKey === "validation_finalization")?.warnings).toEqual([
      expect.objectContaining({ code: "low_source_density" }),
    ]);
  });
});
