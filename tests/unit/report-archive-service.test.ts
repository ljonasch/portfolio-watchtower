jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    analysisBundle: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    portfolioReport: {
      findFirst: jest.fn(),
    },
  },
}));

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  archiveBundleBackedReport,
  unarchiveBundleBackedReport,
} from "@/lib/services/report-archive-service";

describe("report-archive-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("persists archivedAt for a bundle id", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      userId: "user_1",
      archivedAt: null,
    });
    (prisma.analysisBundle.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await archiveBundleBackedReport({
      userId: "user_1",
      requestedId: "bundle_1",
    });

    expect(prisma.analysisBundle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "bundle_1",
          userId: "user_1",
          archivedAt: null,
        }),
        data: expect.objectContaining({
          archivedAt: expect.any(Date),
        }),
      })
    );
    expect(result.bundleId).toBe("bundle_1");
    expect(result.alreadyArchived).toBe(false);
    expect(result.resolution).toBe("bundle_id");
    expect(revalidatePath).toHaveBeenCalledWith("/history");
    expect(revalidatePath).toHaveBeenCalledWith("/report/bundle_1");
  });

  test("archives the backing bundle when invoked from a legacy report id", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.portfolioReport.findFirst as jest.Mock).mockResolvedValue({
      analysisRunId: "run_1",
    });
    (prisma.analysisBundle.findFirst as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      archivedAt: null,
    });
    (prisma.analysisBundle.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await archiveBundleBackedReport({
      userId: "user_1",
      requestedId: "legacy_report_1",
    });

    expect(prisma.analysisBundle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "user_1",
          sourceRunId: "run_1",
        },
      })
    );
    expect(prisma.analysisBundle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "bundle_1" }),
      })
    );
    expect(result.bundleId).toBe("bundle_1");
    expect(result.resolution).toBe("legacy_report_to_bundle");
    expect(revalidatePath).toHaveBeenCalledWith("/report/legacy_report_1");
    expect(revalidatePath).toHaveBeenCalledWith("/report/bundle_1");
  });

  test("does not support archiving legacy-only reports in phase 1", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.portfolioReport.findFirst as jest.Mock).mockResolvedValue({
      analysisRunId: null,
    });

    await expect(
      archiveBundleBackedReport({
        userId: "user_1",
        requestedId: "legacy_only_report",
      })
    ).rejects.toThrow("Archive is only available for bundle-backed reports in phase 1");
  });

  test("clears archivedAt for an archived bundle", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      userId: "user_1",
      archivedAt: new Date("2026-04-03T12:00:00.000Z"),
    });
    (prisma.analysisBundle.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await unarchiveBundleBackedReport({
      userId: "user_1",
      requestedId: "bundle_1",
    });

    expect(prisma.analysisBundle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "bundle_1",
          userId: "user_1",
        }),
        data: {
          archivedAt: null,
        },
      })
    );
    expect(result).toEqual({
      bundleId: "bundle_1",
      unarchived: true,
      resolution: "bundle_id",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/history");
    expect(revalidatePath).toHaveBeenCalledWith("/report/bundle_1");
  });
});
