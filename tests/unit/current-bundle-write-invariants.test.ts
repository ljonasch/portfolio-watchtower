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

function buildInput(outcome: FinalizeAnalysisRunInput["outcome"], runId = "run_1"): FinalizeAnalysisRunInput {
  return {
    runId,
    userId: "user_1",
    snapshotId: "snapshot_1",
    outcome,
    recommendations: outcome === "validated" ? [{
      ticker: "NVDA",
      companyName: "NVIDIA",
      role: "Growth",
      currentShares: 1,
      currentPrice: 100,
      targetShares: 3,
      shareDelta: 2,
      dollarDelta: 200,
      currentWeight: 10,
      targetWeight: 30,
      acceptableRangeLow: 28,
      acceptableRangeHigh: 32,
      valueDelta: 200,
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
    reportViewModel: {
      bundleId: "pending",
      recommendations: outcome === "validated" ? [{ ticker: "NVDA" }] : [],
    },
    emailPayload: outcome === "validated" ? { bundleId: "pending", recommendations: [] } : null,
    exportPayload: {},
  };
}

describe("current bundle write invariants", () => {
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
    (prisma.analysisBundle.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
    (prisma.analysisBundle.create as jest.Mock).mockResolvedValue({ id: "bundle_1" });
    (prisma.analysisBundle.update as jest.Mock).mockResolvedValue({ id: "bundle_1" });
    (prisma.portfolioReport.create as jest.Mock).mockResolvedValue({ id: "report_1" });
    (prisma.analysisRun.update as jest.Mock).mockResolvedValue({ id: "run_1" });
    (prisma.holdingRecommendation.createMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  test.each(["validated", "abstained", "degraded"] as const)("supersedes prior bundles for %s terminal finalization", async (outcome) => {
    await finalizeAnalysisRun(buildInput(outcome));

    expect(prisma.analysisBundle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user_1",
          bundleScope: "PRIMARY_PORTFOLIO",
          isSuperseded: false,
        }),
      })
    );
  });

  test("failed finalization preserves prior current bundle by skipping supersession", async () => {
    await finalizeAnalysisRun(buildInput("failed"));

    expect(prisma.analysisBundle.updateMany).not.toHaveBeenCalled();
    expect(prisma.analysisBundle.create).not.toHaveBeenCalled();
  });

  test("repeated finalization for the same run is idempotent", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "bundle_1", holdingRecommendations: [{ id: "rec_1" }] });
    (prisma.portfolioReport.findFirst as jest.Mock).mockResolvedValue({ id: "report_1" });

    await finalizeAnalysisRun(buildInput("validated", "run_repeat"));
    await finalizeAnalysisRun(buildInput("validated", "run_repeat"));

    expect(prisma.analysisBundle.create).toHaveBeenCalledTimes(1);
    expect(prisma.holdingRecommendation.createMany).toHaveBeenCalledTimes(1);
  });
});
