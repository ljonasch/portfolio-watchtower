jest.mock("@/lib/prisma", () => ({
  prisma: {
    analysisBundle: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    portfolioReport: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    holdingRecommendation: {
      createMany: jest.fn(),
    },
    analysisRun: {
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));

jest.mock("@/lib/research/analysis-orchestrator", () => ({
  runFullAnalysis: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { runFullAnalysis } from "@/lib/research/analysis-orchestrator";
import {
  finalizeAnalysisRun,
  persistBackfilledLegacyBundle,
  runStreamAnalysis,
  type FinalizeAnalysisRunInput,
} from "@/lib/services";

function buildValidatedInput(): FinalizeAnalysisRunInput {
  return {
    runId: "run_1",
    userId: "user_1",
    snapshotId: "snapshot_1",
    outcome: "validated",
    recommendations: [
      {
        ticker: "MSFT",
        companyName: "Microsoft",
        role: "Core",
        currentShares: 1,
        currentPrice: 100,
        targetShares: 2,
        shareDelta: 1,
        dollarDelta: 100,
        currentWeight: 10,
        targetWeight: 20,
        acceptableRangeLow: 18,
        acceptableRangeHigh: 22,
        valueDelta: 100,
        action: "Buy",
        confidence: "high",
        positionStatus: "underweight",
        evidenceQuality: "high",
        thesisSummary: "Strong thesis",
        detailedReasoning: "Detailed",
        whyChanged: "Changed",
        reasoningSources: [],
      },
    ],
    reportSummary: "Summary",
    reportReasoning: "Reasoning",
    reportMarketContext: {},
    alertLevel: "yellow",
    alertReason: "reason",
    profileSnapshot: { riskTolerance: "medium" },
    convictionsSnapshot: [],
    evidencePacket: { packetId: "packet_1" },
    evidenceHash: "hash_1",
    evidenceFreshness: { prices: "fresh" },
    sourceList: [],
    versions: {
      analysisPolicyVersion: "v1",
      schemaVersion: "v1",
      promptVersion: "p1",
      viewModelVersion: "v1",
      emailTemplateVersion: "v1",
      modelPolicyVersion: "v1",
    },
    llm: {
      primaryModel: "gpt-5.4",
      structuredScore: { ok: true },
      responseHash: "resp_hash",
      usage: {},
    },
    deterministic: {
      factorLedger: {},
      recommendationDecision: {},
      positionSizing: {},
    },
    validationSummary: {
      hardErrorCount: 0,
      warningCount: 0,
      reasonCodes: [],
    },
    reportViewModel: {
      bundleId: "pending",
      recommendations: [{ ticker: "MSFT" }],
    },
    emailPayload: {
      bundleId: "pending",
      recommendations: [{ ticker: "MSFT" }],
    },
    exportPayload: {},
  };
}

describe("analysis-lifecycle-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback: any) =>
      callback({
        analysisBundle: prisma.analysisBundle,
        portfolioReport: prisma.portfolioReport,
        holdingRecommendation: prisma.holdingRecommendation,
        analysisRun: prisma.analysisRun,
      })
    );
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.analysisBundle.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.analysisBundle.create as jest.Mock).mockResolvedValue({ id: "bundle_1" });
    (prisma.analysisBundle.update as jest.Mock).mockResolvedValue({ id: "bundle_1" });
    (prisma.portfolioReport.create as jest.Mock).mockResolvedValue({ id: "report_1" });
    (prisma.analysisRun.update as jest.Mock).mockResolvedValue({ id: "run_1" });
    (prisma.holdingRecommendation.createMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  test("delegates stream analysis through the lifecycle service boundary", async () => {
    const emit = jest.fn();
    (runFullAnalysis as jest.Mock).mockResolvedValue({ runId: "run_1" });

    await runStreamAnalysis({
      snapshotId: "snapshot_1",
      customPrompt: "focus on risk",
      emit,
      triggerType: "manual",
      triggeredBy: "user",
    });

    expect(runFullAnalysis).toHaveBeenCalledWith(
      "snapshot_1",
      "focus on risk",
      emit,
      "manual",
      "user",
      undefined
    );
  });

  test("links validated runs to a created bundle and legacy report in one finalization path", async () => {
    const result = await finalizeAnalysisRun(buildValidatedInput());

    expect(prisma.analysisBundle.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.analysisBundle.create).toHaveBeenCalledTimes(1);
    expect(prisma.portfolioReport.create).toHaveBeenCalledTimes(1);
    expect(prisma.holdingRecommendation.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run_1" },
        data: expect.objectContaining({
          status: "complete",
          stage: "finalized_validated",
        }),
      })
    );
    expect(result).toEqual({
      runId: "run_1",
      bundleId: "bundle_1",
      reportId: "report_1",
      outcome: "validated",
    });
  });

  test("returns an existing persisted backfilled bundle without re-running writes", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_existing",
    });

    const result = await persistBackfilledLegacyBundle({
      legacyArtifactId: "report_1",
      artifactIdentityKey: "artifact::user_1::PRIMARY_PORTFOLIO::run_1::snapshot_1",
      userId: "user_1",
      bundleScope: "PRIMARY_PORTFOLIO",
      analysisRunId: "run_1",
      snapshotId: "snapshot_1",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      finalizedAt: new Date("2026-04-01T00:00:00.000Z"),
      summary: "Legacy summary",
      reasoning: "Legacy reasoning",
      marketContext: {},
      recommendations: [
        {
          id: "rec_1",
          ticker: "MSFT",
          companyName: "Microsoft",
          role: "Core",
          currentShares: 1,
          targetShares: 2,
          shareDelta: 1,
          currentWeight: 10,
          targetWeight: 20,
          valueDelta: 100,
          dollarDelta: 100,
          acceptableRangeLow: 18,
          acceptableRangeHigh: 22,
          action: "Buy",
          confidence: "high",
          positionStatus: "underweight",
          evidenceQuality: "high",
          thesisSummary: "Strong thesis",
          detailedReasoning: "Detailed",
          whyChanged: "Changed",
          systemNote: null,
          reasoningSources: [],
        },
      ],
      profileSnapshot: { riskTolerance: "medium" },
      convictionsSnapshot: [],
    });

    expect(result).toEqual({
      bundleId: "bundle_existing",
      origin: "backfilled_legacy",
      artifactIdentityKey: "artifact::user_1::PRIMARY_PORTFOLIO::run_1::snapshot_1",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.analysisBundle.create).not.toHaveBeenCalled();
    expect(prisma.analysisBundle.updateMany).not.toHaveBeenCalled();
    expect(prisma.analysisBundle.update).not.toHaveBeenCalled();
    expect(prisma.holdingRecommendation.createMany).not.toHaveBeenCalled();
  });
});
