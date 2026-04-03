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
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getHistoryBundles } from "@/lib/read-models";

describe("coexistence transition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("bundle-backed artifact suppresses matching legacy artifact and exposes provenance", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([
      {
        id: "bundle_1",
        userId: "user_1",
        sourceRunId: "run_1",
        bundleOutcome: "validated",
        bundleScope: "PRIMARY_PORTFOLIO",
        portfolioSnapshotId: "snapshot_1",
        finalizedAt: new Date("2026-04-02T00:00:00.000Z"),
        isSuperseded: false,
        deliveryStatus: "not_eligible",
        evidencePacketJson: JSON.stringify({ origin: "backfilled_legacy" }),
      },
    ]);
    (prisma.portfolioReport.findMany as jest.Mock).mockResolvedValue([
      {
        id: "report_1",
        analysisRunId: "run_1",
        snapshotId: "snapshot_1",
        createdAt: new Date("2026-04-02T00:00:00.000Z"),
      },
    ]);

    const result = await getHistoryBundles("user_1");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        source: "bundle",
        origin: "backfilled_legacy",
        artifactIdentityKey: "artifact::user_1::PRIMARY_PORTFOLIO::run_1::snapshot_1",
      })
    );
  });

  test("legacy-only artifact remains surfaced as legacy_read_only when no bundle exists", async () => {
    (prisma.analysisBundle.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.portfolioReport.findMany as jest.Mock).mockResolvedValue([
      {
        id: "report_legacy",
        analysisRunId: null,
        snapshotId: "snapshot_legacy",
        createdAt: new Date("2026-04-02T00:00:00.000Z"),
      },
    ]);

    const result = await getHistoryBundles("user_1");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        source: "legacy",
        classification: "legacy_read_only",
        artifactIdentityKey: null,
      })
    );
  });
});
