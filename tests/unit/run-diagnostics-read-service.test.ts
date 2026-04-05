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
    (prisma.analysisRun.findUnique as jest.Mock).mockResolvedValue({
      startedAt: new Date("2026-04-01T23:55:00.000Z"),
      completedAt: new Date("2026-04-02T00:00:00.000Z"),
    });

    const result = await getRunDiagnostics("bundle_1");

    expect(result?.artifactMeta.bundleId).toBe("bundle_1");
    expect(result?.artifactMeta.startedAt).toBe("2026-04-01T23:55:00.000Z");
    expect(result?.artifactMeta.completedAt).toBe("2026-04-02T00:00:00.000Z");
    expect(result?.artifactMeta.elapsedMs).toBe(300000);
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
      for (const warning of step.warnings) {
        expect(warning.warningId).toBeTruthy();
      }
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
    expect(prisma.analysisRun.findUnique).toHaveBeenCalledWith({
      where: { id: "run_1" },
      select: {
        startedAt: true,
        completedAt: true,
      },
    });
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
      startedAt: new Date("2026-04-01T23:45:00.000Z"),
      completedAt: new Date("2026-04-02T00:00:00.000Z"),
      qualityMeta: JSON.stringify({
        promptHash: "prompt_hash",
        evidencePacketId: "packet_1",
        usingFallbackNews: true,
        newsAvailabilityStatus: "fallback_success",
        newsStatusSummary: "Yahoo Finance fallback headlines were used because primary live-news coverage was unavailable for this run.",
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
    expect(result?.artifactMeta.startedAt).toBe("2026-04-01T23:45:00.000Z");
    expect(result?.artifactMeta.completedAt).toBe("2026-04-02T00:00:00.000Z");
    expect(result?.artifactMeta.elapsedMs).toBe(900000);
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
      for (const warning of step.warnings) {
        expect(warning.warningId).toBeTruthy();
      }
    }
    expect(result?.steps.find((step) => step.stepKey === "gap_scan")?.inputs).toEqual(
      expect.objectContaining({
        portfolioReview: "Existing holdings were reviewed for concentration, redundancy, and missing themes.",
      })
    );
    expect(result?.steps.find((step) => step.stepKey === "gap_scan")?.outputs).toEqual(
      expect.objectContaining({
        gapAssessment: "2 gaps",
        outcomeExplanation: "Two gaps",
      })
    );
    expect(result?.steps.find((step) => step.stepKey === "candidate_screening")?.outputs).toEqual(
      expect.objectContaining({
        screeningResult: "3 added",
        outcomeExplanation: "Three candidates",
        rationale: "Three candidates",
      })
    );
    expect(result?.steps.find((step) => step.stepKey === "news_sources")?.outputs).toEqual(
      expect.objectContaining({
        sourceCoverage: "5 sources",
        statusSummary: "Yahoo Finance fallback headlines were used because primary live-news coverage was unavailable for this run.",
        topSourceTitles: ["News item"],
      })
    );
    expect(result?.steps.find((step) => step.stepKey === "news_sources")?.sources).toHaveLength(1);
    expect(result?.steps.find((step) => step.stepKey === "validation_finalization")?.warnings).toEqual([
      expect.objectContaining({ code: "low_source_density" }),
    ]);
    expect(result?.steps.find((step) => step.stepKey === "news_sources")?.warnings).toEqual([
      expect.objectContaining({
        code: "fallback_news",
        message: "Yahoo Finance fallback headlines were used because primary live-news coverage was unavailable for this run.",
        warningId: expect.stringContaining("news_sources:fallback_news:"),
      }),
    ]);
  });

  test("fallback diagnostics clearly explain an older bundle with zero gaps and zero candidates", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_legacy_empty",
      sourceRunId: "run_legacy_empty",
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
        warningCount: 0,
        reasonCodes: [],
      }),
      sourceListJson: JSON.stringify([]),
    });
    (prisma.analysisRun.findUnique as jest.Mock).mockResolvedValue({
      startedAt: new Date("2026-04-01T23:40:00.000Z"),
      completedAt: new Date("2026-04-02T00:00:00.000Z"),
      qualityMeta: JSON.stringify({
        promptHash: "prompt_hash",
        systemVerification: {
          gapAnalysis: { status: "!0 gaps", rationale: "No gaps identified based on holdings." },
          candidateScreening: { status: "!0 added", rationale: "No candidates found." },
        },
      }),
    });

    const result = await getRunDiagnostics("bundle_legacy_empty");

    expect(result?.artifactMeta.startedAt).toBe("2026-04-01T23:40:00.000Z");
    expect(result?.artifactMeta.completedAt).toBe("2026-04-02T00:00:00.000Z");
    expect(result?.artifactMeta.elapsedMs).toBe(1200000);
    expect(result?.steps.find((step) => step.stepKey === "gap_scan")).toEqual(
      expect.objectContaining({
        outputs: expect.objectContaining({
          outcomeExplanation: "The portfolio gap scan ran and found no material gaps worth surfacing in this run.",
          emptyResultReason: "The older bundle indicates the gap scan ran but found no material gaps worth surfacing.",
        }),
      })
    );
    expect(result?.steps.find((step) => step.stepKey === "candidate_screening")).toEqual(
      expect.objectContaining({
        outputs: expect.objectContaining({
          outcomeExplanation: "Candidate screening ran and no external candidates passed the screen for this run.",
          emptyResultReason: "Legacy fallback indicates the screening step ran but no candidates passed.",
        }),
      })
    );
  });

  test("persisted diagnostics normalize repeated rate-limit warnings into an aggregated warning with stable ids", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_dup_warn",
      sourceRunId: "run_dup_warn",
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
          bundleId: "bundle_dup_warn",
          runId: "run_dup_warn",
          outcome: "validated",
          generatedAt: "2026-04-02T00:00:00.000Z",
          evidencePacketId: "packet_1",
          steps: [
            {
              stepKey: "news_sources",
              stepName: "News & Event Sources",
              status: "warning",
              summary: "Fallback used.",
              inputs: { searchWindow: "Yahoo fallback" },
              outputs: { outcomeExplanation: "Fallback used." },
              metrics: [],
              sources: [],
              warnings: [
                { code: "primary_rate_limited", message: "Rate limit (429) hit for model gpt-5-search-api. Waiting 65 seconds before retrying.", severity: "warning" },
                { code: "primary_rate_limited", message: "Rate limit (429) hit for model gpt-5-search-api. Waiting 65 seconds before retrying.", severity: "warning" },
                { code: "fallback_used", message: "Yahoo Finance fallback headlines supplied usable coverage for this run.", severity: "info" },
              ],
              model: null,
              hashes: { evidenceHash: "evidence_hash", promptHash: "prompt_hash" },
              versions: { schemaVersion: "v1", analysisPolicyVersion: "v1", viewModelVersion: "v1" },
            },
          ],
        },
      }),
    });

    const result = await getRunDiagnostics("bundle_dup_warn");
    const newsStep = result?.steps.find((step) => step.stepKey === "news_sources");

    expect(newsStep?.warnings).toHaveLength(2);
    expect(newsStep?.warnings[0]).toEqual(
      expect.objectContaining({
        code: "primary_rate_limited",
        message: "Primary live-news search was rate-limited 2 time(s) during this run. Yahoo Finance fallback headlines were used afterward.",
        warningId: expect.stringContaining("news_sources:primary_rate_limited:"),
      })
    );
    expect(newsStep?.warnings[1]).toEqual(
      expect.objectContaining({
        code: "fallback_used",
        warningId: expect.stringContaining("news_sources:fallback_used:"),
      })
    );
  });
});
