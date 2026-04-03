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

import { prisma } from "@/lib/prisma";
import { finalizeAnalysisRun, type FinalizeAnalysisRunInput } from "@/lib/services";

function buildBaseInput(outcome: FinalizeAnalysisRunInput["outcome"]): FinalizeAnalysisRunInput {
  return {
    runId: "run_1",
    userId: "user_1",
    snapshotId: "snapshot_1",
    outcome,
    recommendations: outcome === "validated" ? [{
      ticker: "AAPL",
      companyName: "Apple",
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
      thesisSummary: "Thesis",
      detailedReasoning: "Detailed",
      whyChanged: "Changed",
      reasoningSources: [],
    }] : [],
    reportSummary: "Summary",
    reportReasoning: "Reasoning",
    reportMarketContext: {},
    profileSnapshot: { riskTolerance: "medium" },
    convictionsSnapshot: [],
    evidencePacket: {},
    evidenceHash: "hash_1",
    evidenceFreshness: {},
    sourceList: [],
    versions: {
      analysisPolicyVersion: "v1",
      schemaVersion: "v1",
      promptVersion: "v1",
      viewModelVersion: "v1",
      emailTemplateVersion: "v1",
      modelPolicyVersion: "v1",
    },
    llm: {
      primaryModel: "gpt-5.4",
      structuredScore: {},
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
    abstainReasonCodes: outcome === "abstained" ? ["MISSING_CITATIONS"] : [],
    degradedReasonCodes: outcome === "degraded" ? ["PRICE_DATA_STALE"] : [],
    reportViewModel: {
      bundleId: "pending",
      recommendations: outcome === "validated" ? [{ ticker: "AAPL" }] : [],
    },
    emailPayload: outcome === "validated" ? { bundleId: "pending", recommendations: [] } : null,
    exportPayload: {},
  };
}

describe("analysis outcome finalization", () => {
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

  test("validated creates bundle and recommendation rows", async () => {
    const result = await finalizeAnalysisRun(buildBaseInput("validated"));

    expect(prisma.analysisBundle.create).toHaveBeenCalledTimes(1);
    expect(prisma.portfolioReport.create).toHaveBeenCalledTimes(1);
    expect(prisma.holdingRecommendation.createMany).toHaveBeenCalledTimes(1);
    expect(result.bundleId).toBe("bundle_1");
    expect(result.reportId).toBe("report_1");
  });

  test("validated persists already-trimmed hold rows without re-expanding suppressed changes", async () => {
    const input = buildBaseInput("validated");
    input.recommendations = [
      {
        ...input.recommendations[0],
        ticker: "MSFT",
        action: "Hold",
        targetShares: 1,
        shareDelta: 0,
        dollarDelta: 0,
        currentWeight: 10,
        targetWeight: 10,
        valueDelta: 0,
        whyChanged: "Low-churn policy deferred this action.",
      },
    ];
    input.reportViewModel = {
      bundleId: "pending",
      recommendations: [{ ticker: "MSFT", action: "Hold", shareDelta: 0 }],
    };

    await finalizeAnalysisRun(input);

    expect(prisma.holdingRecommendation.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            ticker: "MSFT",
            action: "Hold",
            shareDelta: 0,
            dollarDelta: 0,
            whyChanged: "Low-churn policy deferred this action.",
          }),
        ],
      })
    );
  });

  test("abstained creates a bundle and no recommendation rows", async () => {
    await finalizeAnalysisRun(buildBaseInput("abstained"));

    expect(prisma.analysisBundle.create).toHaveBeenCalledTimes(1);
    expect(prisma.portfolioReport.create).not.toHaveBeenCalled();
    expect(prisma.holdingRecommendation.createMany).not.toHaveBeenCalled();
  });

  test("degraded creates a bundle and no recommendation rows", async () => {
    await finalizeAnalysisRun(buildBaseInput("degraded"));

    expect(prisma.analysisBundle.create).toHaveBeenCalledTimes(1);
    expect(prisma.portfolioReport.create).not.toHaveBeenCalled();
    expect(prisma.holdingRecommendation.createMany).not.toHaveBeenCalled();
  });

  test("failed writes no bundle and no recommendation rows", async () => {
    await finalizeAnalysisRun(buildBaseInput("failed"));

    expect(prisma.analysisBundle.create).not.toHaveBeenCalled();
    expect(prisma.portfolioReport.create).not.toHaveBeenCalled();
    expect(prisma.holdingRecommendation.createMany).not.toHaveBeenCalled();
    expect(prisma.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          stage: "failed",
        }),
      })
    );
  });
});
