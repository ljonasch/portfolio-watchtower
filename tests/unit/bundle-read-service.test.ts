jest.mock("@/lib/prisma", () => ({
  prisma: {
    analysisBundle: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
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
  getRequestedReportArtifact,
  isCurrentBundleId,
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

  test("requested report artifact resolves historical bundle by id", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_historical",
      userId: "user_1",
      reportViewModelJson: JSON.stringify({
        bundleId: "bundle_historical",
        bundleOutcome: "validated",
        renderState: "validated_actionable",
        createdAt: "2026-04-01T00:00:00.000Z",
        finalizedAt: "2026-04-01T00:00:00.000Z",
        summaryMessage: "Historical",
        reasoning: "Historical reasoning",
        reasonCodes: [],
        recommendations: [],
        deliveryStatus: "sent",
        isActionable: false,
        isSuperseded: true,
        historicalValidatedContextBundleId: null,
      }),
    });

    const result = await getRequestedReportArtifact("user_1", "bundle_historical");

    expect(result).toEqual(
      expect.objectContaining({
        source: "bundle",
        bundle: expect.objectContaining({ id: "bundle_historical" }),
      })
    );
  });

  test("requested report artifact ignores bundles owned by a different user", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_foreign",
      userId: "user_2",
      reportViewModelJson: JSON.stringify({
        bundleId: "bundle_foreign",
      }),
    });
    (prisma.portfolioReport.findFirst as jest.Mock).mockResolvedValue(null);

    const result = await getRequestedReportArtifact("user_1", "bundle_foreign");

    expect(result).toBeNull();
    expect(prisma.portfolioReport.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bundle_foreign", userId: "user_1" },
      })
    );
  });

  test("requested legacy report id resolves to the matching bundle when a bundle-backed artifact exists", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.portfolioReport.findFirst as jest.Mock).mockResolvedValue({
      id: "report_1",
      userId: "user_1",
      analysisRunId: "run_1",
      snapshotId: "snapshot_1",
      analysisRun: {},
      recommendations: [],
      snapshot: { holdings: [] },
    });
    (prisma.analysisBundle.findFirst as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      userId: "user_1",
      sourceRunId: "run_1",
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

    const result = await getRequestedReportArtifact("user_1", "report_1");

    expect(result).toEqual(
      expect.objectContaining({
        source: "bundle",
        resolution: "legacy_report_to_bundle",
        bundle: expect.objectContaining({ id: "bundle_1" }),
      })
    );
  });

  test("requested report artifact fails closed when bundle payload is invalid", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      userId: "user_1",
      reportViewModelJson: "",
    });

    await expect(getRequestedReportArtifact("user_1", "bundle_1")).rejects.toThrow("reportViewModelJson is missing");
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
        portfolioSnapshotId: "snapshot_1",
        finalizedAt: new Date("2026-04-02T00:00:00.000Z"),
        isSuperseded: false,
        deliveryStatus: "awaiting_ack",
      },
    ]);
    (prisma.portfolioReport.findMany as jest.Mock).mockResolvedValue([
      {
        id: "report_legacy",
        analysisRunId: "run_legacy",
        snapshotId: "snapshot_legacy",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
      },
    ]);

    const result = await getHistoryBundles("user_1");

    expect(result).toHaveLength(2);
    expect(result[0].source).toBe("bundle");
    expect(result[1].source).toBe("legacy");
  });

  test("history keeps bundle row and drops legacy duplicate for the same artifact", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([
      {
        id: "bundle_1",
        sourceRunId: "run_1",
        bundleOutcome: "validated",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
        finalizedAt: new Date("2026-04-02T00:00:00.000Z"),
        isSuperseded: false,
        deliveryStatus: "awaiting_ack",
      },
    ]);
    (prisma.portfolioReport.findMany as jest.Mock).mockResolvedValue([
      {
        id: "report_duplicate",
        analysisRunId: "run_1",
        snapshotId: "snapshot_1",
        createdAt: new Date("2026-04-02T00:00:00.000Z"),
      },
    ]);

    const result = await getHistoryBundles("user_1");

    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("bundle");
  });

  test("history keeps the bundle row over a matching newer legacy row", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([
      {
        id: "bundle_1",
        sourceRunId: "run_1",
        bundleOutcome: "validated",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
        finalizedAt: new Date("2026-04-02T00:00:00.000Z"),
        isSuperseded: false,
        deliveryStatus: "awaiting_ack",
      },
    ]);
    (prisma.portfolioReport.findMany as jest.Mock).mockResolvedValue([
      {
        id: "report_duplicate_newer",
        analysisRunId: "run_1",
        snapshotId: "snapshot_1",
        createdAt: new Date("2026-04-03T00:00:00.000Z"),
      },
    ]);

    const result = await getHistoryBundles("user_1");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        source: "bundle",
        bundle: expect.objectContaining({ id: "bundle_1" }),
      })
    );
  });

  test("history keeps the bundle row over a matching legacy row regardless of source order", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([
      {
        id: "bundle_1",
        sourceRunId: "run_1",
        bundleOutcome: "validated",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
        finalizedAt: new Date("2026-04-02T00:00:00.000Z"),
        isSuperseded: false,
        deliveryStatus: "awaiting_ack",
      },
    ]);
    (prisma.portfolioReport.findMany as jest.Mock).mockResolvedValue([
      {
        id: "report_duplicate_first",
        analysisRunId: "run_1",
        snapshotId: "snapshot_1",
        createdAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        id: "report_distinct",
        analysisRunId: "run_2",
        snapshotId: "snapshot_2",
        createdAt: new Date("2026-04-04T00:00:00.000Z"),
      },
    ]);

    const result = await getHistoryBundles("user_1");

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      expect.objectContaining({
        source: "legacy",
        report: expect.objectContaining({ id: "report_distinct" }),
      }),
      expect.objectContaining({
        source: "bundle",
        bundle: expect.objectContaining({ id: "bundle_1" }),
      }),
    ]);
  });

  test("history is globally ordered by effective timestamp", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([
      {
        id: "bundle_old",
        sourceRunId: "run_old",
        bundleOutcome: "validated",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
        finalizedAt: new Date("2026-04-01T00:00:00.000Z"),
        isSuperseded: false,
        deliveryStatus: "awaiting_ack",
      },
    ]);
    (prisma.portfolioReport.findMany as jest.Mock).mockResolvedValue([
      {
        id: "report_newer",
        analysisRunId: "run_newer",
        snapshotId: "snapshot_legacy",
        createdAt: new Date("2026-04-02T12:00:00.000Z"),
      },
    ]);

    const result = await getHistoryBundles("user_1");

    expect(result[0]).toEqual(expect.objectContaining({ source: "legacy" }));
    expect(result[1]).toEqual(expect.objectContaining({ source: "bundle" }));
  });

  test("bundle email payload reads from the bundle snapshot only", async () => {
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
      userId: "user_1",
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

  test("bundle email payload uses actual current-bundle selection", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([
      {
        id: "bundle_current",
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

    const isCurrent = await isCurrentBundleId("user_1", "bundle_current");
    expect(isCurrent).toBe(true);
  });
});
