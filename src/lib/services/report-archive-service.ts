import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

type ArchiveResolution = "bundle_id" | "legacy_report_to_bundle";

interface ResolvedArchiveTarget {
  bundleId: string;
  archivedAt: Date | null;
  resolution: ArchiveResolution;
}

export interface ArchiveBundleReportResult {
  bundleId: string;
  archivedAt: string;
  alreadyArchived: boolean;
  resolution: ArchiveResolution;
}

export interface UnarchiveBundleReportResult {
  bundleId: string;
  unarchived: boolean;
  resolution: ArchiveResolution;
}

async function resolveArchiveTarget(userId: string, requestedId: string): Promise<ResolvedArchiveTarget | null> {
  const directBundle = await prisma.analysisBundle.findUnique({
    where: { id: requestedId },
    select: {
      id: true,
      userId: true,
      archivedAt: true,
    },
  });

  if (directBundle && directBundle.userId === userId) {
    return {
      bundleId: directBundle.id,
      archivedAt: directBundle.archivedAt,
      resolution: "bundle_id",
    };
  }

  const legacyReport = await prisma.portfolioReport.findFirst({
    where: { id: requestedId, userId },
    select: {
      analysisRunId: true,
    },
  });

  if (!legacyReport?.analysisRunId) {
    return null;
  }

  const matchingBundle = await prisma.analysisBundle.findFirst({
    where: {
      userId,
      sourceRunId: legacyReport.analysisRunId,
    },
    select: {
      id: true,
      archivedAt: true,
    },
  });

  if (!matchingBundle) {
    return null;
  }

  return {
    bundleId: matchingBundle.id,
    archivedAt: matchingBundle.archivedAt,
    resolution: "legacy_report_to_bundle",
  };
}

export async function archiveBundleBackedReport(input: {
  userId: string;
  requestedId: string;
}): Promise<ArchiveBundleReportResult> {
  const requestedId = input.requestedId.trim();
  if (!requestedId) {
    throw new Error("Report id is required");
  }

  const target = await resolveArchiveTarget(input.userId, requestedId);
  if (!target) {
    throw new Error("Archive is only available for bundle-backed reports in phase 1");
  }

  if (target.archivedAt) {
    revalidatePath("/history");
    revalidatePath(`/report/${requestedId}`);
    if (requestedId !== target.bundleId) {
      revalidatePath(`/report/${target.bundleId}`);
    }

    return {
      bundleId: target.bundleId,
      archivedAt: target.archivedAt.toISOString(),
      alreadyArchived: true,
      resolution: target.resolution,
    };
  }

  const archivedAt = new Date();
  const updateResult = await prisma.analysisBundle.updateMany({
    where: {
      id: target.bundleId,
      userId: input.userId,
      archivedAt: null,
    },
    data: {
      archivedAt,
    },
  });

  const persistedArchivedAt = updateResult.count > 0
    ? archivedAt
    : (
        await prisma.analysisBundle.findUnique({
          where: { id: target.bundleId },
          select: { archivedAt: true },
        })
      )?.archivedAt;

  if (!persistedArchivedAt) {
    throw new Error("Failed to archive bundle-backed report");
  }

  revalidatePath("/history");
  revalidatePath(`/report/${requestedId}`);
  if (requestedId !== target.bundleId) {
    revalidatePath(`/report/${target.bundleId}`);
  }

  return {
    bundleId: target.bundleId,
    archivedAt: persistedArchivedAt.toISOString(),
    alreadyArchived: updateResult.count === 0,
    resolution: target.resolution,
  };
}

export async function unarchiveBundleBackedReport(input: {
  userId: string;
  requestedId: string;
}): Promise<UnarchiveBundleReportResult> {
  const requestedId = input.requestedId.trim();
  if (!requestedId) {
    throw new Error("Report id is required");
  }

  const target = await resolveArchiveTarget(input.userId, requestedId);
  if (!target) {
    throw new Error("Archive is only available for bundle-backed reports in phase 1");
  }

  if (!target.archivedAt) {
    revalidatePath("/history");
    revalidatePath(`/report/${requestedId}`);
    if (requestedId !== target.bundleId) {
      revalidatePath(`/report/${target.bundleId}`);
    }

    return {
      bundleId: target.bundleId,
      unarchived: false,
      resolution: target.resolution,
    };
  }

  await prisma.analysisBundle.updateMany({
    where: {
      id: target.bundleId,
      userId: input.userId,
    },
    data: {
      archivedAt: null,
    },
  });

  revalidatePath("/history");
  revalidatePath(`/report/${requestedId}`);
  if (requestedId !== target.bundleId) {
    revalidatePath(`/report/${target.bundleId}`);
  }

  return {
    bundleId: target.bundleId,
    unarchived: true,
    resolution: target.resolution,
  };
}
