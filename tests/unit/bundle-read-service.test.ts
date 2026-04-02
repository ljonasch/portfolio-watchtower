jest.mock("@/lib/prisma", () => ({
  prisma: {
    analysisBundle: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    analysisRun: {
      findFirst: jest.fn(),
    },
    portfolioReport: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  getBundleEmailPayload,
  getCurrentBundleRecord,
  getCurrentBundleReport,
  getExportPayload,
  getHistoryBundles,
} from "@/lib/read-models";

describe("bundle-read-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("report surface reads bundle snapshots first", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([
      {
        id: "bundle_1",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
        userProfileHash: "p1",
        convictionHash: "c1",
        bundleOutcome: "validated",
        finalizedAt: new Date("2026-04-02T00:00:00.000Z"),
        isSuperseded: false,
      },
    ]);
    (prisma.analysisRun.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      reportViewModelJson: JSON.stringify({
        bundleId: "bundle_1",
        bundleOutcome: "validated",
        renderState: "validated_actionable",
        createdAt: "2026-04-02T00:00:00.000Z",
        finalizedAt: "2026-04-02T00:00:00.000Z",
        summaryMessage: "Summary",
        reasoning: "Reasoning",
        reasonCodes: [],
        recommendations: [],
        deliveryStatus: "awaiting_ack",
        isActionable: true,
        isSuperseded: false,
        historicalValidatedContextBundleId: null,
      }),
    });

    const result = await getCurrentBundleReport("user_1");

    expect(result.source).toBe("bundle");
    expect(result.reportViewModel?.bundleId).toBe("bundle_1");
    expect(prisma.portfolioReport.findFirst).not.toHaveBeenCalled();
  });

  test("export fails closed when bundle payload is missing", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.analysisRun.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      exportPayloadJson: "",
    });

    await expect(getExportPayload("user_1", "bundle_1")).rejects.toThrow("exportPayloadJson is missing");
  });

  test("history uses legacy fallback only when no bundle-backed record exists", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([
      {
        id: "bundle_1",
        sourceRunId: "run_1",
        bundleOutcome: "validated",
        bundleScope: "PRIMARY_PORTFOLIO",
        finalizedAt: new Date("2026-04-02T00:00:00.000Z"),
        isSuperseded: false,
        deliveryStatus: "awaiting_ack",
      },
    ]);
    (prisma.portfolioReport.findMany as jest.Mock).mockResolvedValue([
      {
        id: "report_legacy",
        analysisRunId: "run_legacy",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);

    const result = await getHistoryBundles("user_1");

    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("bundle");
    expect(result[1].source).toBe("legacy");
  });

  test("bundle email payload reads from the bundle snapshot only", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      bundleOutcome: "validated",
      isSuperseded: false,
      acknowledgedAt: new Date("2026-04-02T00:00:00.000Z"),
      deliveryStatus: "acknowledged",
      emailPayloadJson: JSON.stringify({ subject: "Subject", html: "<p>Hello</p>" }),
    });

    const result = await getBundleEmailPayload("bundle_1");

    expect(result.emailPayload).toEqual({ subject: "Subject", html: "<p>Hello</p>" });
    expect(result.eligibility.isEligibleForInitialSend).toBe(true);
  });
});
