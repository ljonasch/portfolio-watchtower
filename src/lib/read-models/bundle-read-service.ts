import { prisma } from "@/lib/prisma";
import type {
  AnalysisBundleContract,
  CurrentBundleSelectionInput,
  HistoryItemViewModelContract,
  ReportViewModelContract,
} from "@/lib/contracts";
import {
  buildBundleArtifactIdentityKey,
  buildLegacyReportArtifactIdentityKey,
  classifyLegacyReadOnlyArtifact,
  extractBundleOrigin,
  resolveBundleLegacyCoexistence,
} from "@/lib/backfill";
import { buildDeliveryEligibility } from "./delivery-eligibility";
import { selectCurrentBundle } from "./current-bundle-selector";

function parseJsonField<T>(value: string | null | undefined, label: string): T {
  if (!value || !value.trim()) {
    throw new Error(`${label} is missing`);
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} is invalid`);
  }
}

async function getCurrentBundleSelectionInput(userId: string): Promise<CurrentBundleSelectionInput> {
  const [terminalBundles, latestRun] = await Promise.all([
    prisma.analysisBundle.findMany({
      where: { userId, bundleScope: "PRIMARY_PORTFOLIO" },
      orderBy: { finalizedAt: "desc" },
      select: {
        id: true,
        bundleScope: true,
        portfolioSnapshotId: true,
        userProfileHash: true,
        convictionHash: true,
        bundleOutcome: true,
        finalizedAt: true,
        isSuperseded: true,
      },
    }),
    prisma.analysisRun.findFirst({
      where: { userId, bundleScope: "PRIMARY_PORTFOLIO" },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        stage: true,
        failureCode: true,
        completedAt: true,
      },
    }),
  ]);

  const mostRecentBundle = terminalBundles[0] ?? null;

  return {
    partition: {
      userId,
      bundleScope: "PRIMARY_PORTFOLIO",
      portfolioSnapshotId: mostRecentBundle?.portfolioSnapshotId ?? null,
      profileHash: mostRecentBundle?.userProfileHash ?? null,
      convictionHash: mostRecentBundle?.convictionHash ?? null,
    },
    terminalBundles: terminalBundles.map((bundle) => ({
      bundleId: bundle.id,
      bundleScope: bundle.bundleScope as "PRIMARY_PORTFOLIO",
      portfolioSnapshotId: bundle.portfolioSnapshotId,
      profileHash: bundle.userProfileHash,
      convictionHash: bundle.convictionHash,
      bundleOutcome: bundle.bundleOutcome as AnalysisBundleContract["bundleOutcome"],
      finalizedAt: bundle.finalizedAt.toISOString(),
      isSuperseded: bundle.isSuperseded,
    })),
    latestRun: latestRun
      ? {
          runId: latestRun.id,
          stage: latestRun.stage as CurrentBundleSelectionInput["latestRun"] extends infer T
            ? T extends { stage: infer S }
              ? S
              : never
            : never,
          failureCode: latestRun.failureCode as any,
          completedAt: latestRun.completedAt?.toISOString() ?? null,
        }
      : null,
  };
}

export async function getCurrentBundleRecord(userId: string) {
  const selectionInput = await getCurrentBundleSelectionInput(userId);
  const selection = selectCurrentBundle(selectionInput);

  if (!selection.currentBundleId) {
    return {
      selection,
      currentBundle: null,
      historicalValidatedBundle: null,
      latestRun: selectionInput.latestRun,
    };
  }

  const [currentBundle, historicalValidatedBundle] = await Promise.all([
    prisma.analysisBundle.findUnique({ where: { id: selection.currentBundleId } }),
    selection.historicalValidatedContextBundleId
      ? prisma.analysisBundle.findUnique({ where: { id: selection.historicalValidatedContextBundleId } })
      : Promise.resolve(null),
  ]);

  return {
    selection,
    currentBundle,
    historicalValidatedBundle,
    latestRun: selectionInput.latestRun,
  };
}

export async function isCurrentBundleId(userId: string, bundleId: string): Promise<boolean> {
  const { selection } = await getCurrentBundleRecord(userId);
  return selection.currentBundleId === bundleId;
}

export async function getRequestedReportArtifact(userId: string, requestedId: string) {
  const bundle = await prisma.analysisBundle.findUnique({
    where: { id: requestedId },
  });

  if (bundle && bundle.userId === userId) {
    return {
      source: "bundle" as const,
      origin: extractBundleOrigin(bundle),
      bundle,
      reportViewModel: parseJsonField<ReportViewModelContract>(bundle.reportViewModelJson, "reportViewModelJson"),
    };
  }

  const legacyReport = await prisma.portfolioReport.findFirst({
    where: { id: requestedId, userId },
    include: {
      analysisRun: true,
      recommendations: { orderBy: { targetWeight: "desc" } },
      snapshot: { include: { holdings: true } },
    },
  });

  if (!legacyReport) {
    return null;
  }

  return {
    source: "legacy" as const,
    classification: classifyLegacyReadOnlyArtifact(),
    report: legacyReport,
  };
}

export async function getCurrentBundleReport(userId: string) {
  const bundleResult = await getCurrentBundleRecord(userId);
  if (bundleResult.currentBundle) {
    const reportViewModel = parseJsonField<ReportViewModelContract>(
      bundleResult.currentBundle.reportViewModelJson,
      "reportViewModelJson"
    );

    return {
      source: "bundle" as const,
      origin: extractBundleOrigin(bundleResult.currentBundle),
      selection: bundleResult.selection,
      reportViewModel,
      bundle: bundleResult.currentBundle,
      historicalValidatedBundle: bundleResult.historicalValidatedBundle,
      latestRun: bundleResult.latestRun,
    };
  }

  const legacyReport = await prisma.portfolioReport.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      analysisRun: true,
      recommendations: true,
      snapshot: { include: { holdings: true } },
    },
  });

  return {
    source: "legacy" as const,
    classification: classifyLegacyReadOnlyArtifact(),
    selection: bundleResult.selection,
    reportViewModel: null,
    bundle: null,
    historicalValidatedBundle: null,
    latestRun: bundleResult.latestRun,
    legacyReport,
  };
}

export async function getHistoryBundles(userId: string): Promise<Array<
  | { source: "bundle"; origin: "runtime" | "backfilled_legacy"; artifactIdentityKey: string; bundle: any; historyItem: HistoryItemViewModelContract }
  | { source: "legacy"; classification: "legacy_read_only"; artifactIdentityKey: string | null; report: any }
>> {
  const bundles = await prisma.analysisBundle.findMany({
    where: { userId, bundleScope: "PRIMARY_PORTFOLIO" },
    orderBy: { finalizedAt: "desc" },
  });

  const historyItems = bundles.map((bundle) => ({
    source: "bundle" as const,
    origin: extractBundleOrigin(bundle),
    artifactIdentityKey: buildBundleArtifactIdentityKey({
      userId: bundle.userId ?? userId,
      bundleScope: bundle.bundleScope,
      sourceRunId: bundle.sourceRunId,
      portfolioSnapshotId: bundle.portfolioSnapshotId,
    }),
    bundle,
    historyItem: {
      bundleId: bundle.id,
      outcome: bundle.bundleOutcome as HistoryItemViewModelContract["outcome"],
      isSuperseded: bundle.isSuperseded,
      deliveryStatus: bundle.deliveryStatus as HistoryItemViewModelContract["deliveryStatus"],
      finalizedAt: bundle.finalizedAt.toISOString(),
      isActionable: bundle.bundleOutcome === "validated" && !bundle.isSuperseded,
    },
  }));

  const bundleArtifactKeys = new Set(
    historyItems.map((item) => item.artifactIdentityKey)
  );
  const legacyReports = await prisma.portfolioReport.findMany({
    where: {
      userId,
    },
    orderBy: { createdAt: "desc" },
    include: {
      analysisRun: true,
      recommendations: true,
      snapshot: { include: { holdings: true } },
    },
  });

  const legacyItems = legacyReports
    .filter((report) => {
      const legacyArtifactIdentityKey = buildLegacyReportArtifactIdentityKey({
        userId,
        bundleScope: "PRIMARY_PORTFOLIO",
        analysisRunId: report.analysisRunId,
        portfolioSnapshotId: report.snapshotId,
      });
      const coexistence = resolveBundleLegacyCoexistence({
        bundleArtifactIdentityKey: legacyArtifactIdentityKey && bundleArtifactKeys.has(legacyArtifactIdentityKey)
          ? legacyArtifactIdentityKey
          : null,
        legacyArtifactIdentityKey,
      });

      return !coexistence.suppressLegacy;
    })
    .map((report) => ({
      source: "legacy" as const,
      classification: classifyLegacyReadOnlyArtifact(),
      artifactIdentityKey: buildLegacyReportArtifactIdentityKey({
        userId,
        bundleScope: "PRIMARY_PORTFOLIO",
        analysisRunId: report.analysisRunId,
        portfolioSnapshotId: report.snapshotId,
      }),
      report,
      effectiveTimestamp: report.createdAt.getTime(),
    }));

  return [
    ...historyItems.map((item) => ({
      ...item,
      effectiveTimestamp: item.bundle.finalizedAt.getTime(),
    })),
    ...legacyItems,
  ]
    .sort((a, b) => b.effectiveTimestamp - a.effectiveTimestamp)
    .map((item) => {
      if (item.source === "bundle") {
        const { effectiveTimestamp, ...rest } = item;
        return rest;
      }

      const { effectiveTimestamp, ...rest } = item;
      return rest;
    });
}

export async function getExportPayload(userId: string, bundleId?: string | null) {
  const bundle = bundleId
    ? await prisma.analysisBundle.findUnique({ where: { id: bundleId } })
    : (await getCurrentBundleRecord(userId)).currentBundle;

  if (bundle) {
    return {
      source: "bundle" as const,
      bundle,
      payload: parseJsonField<Record<string, unknown>>(bundle.exportPayloadJson, "exportPayloadJson"),
    };
  }

  return {
    source: "legacy" as const,
    bundle: null,
    payload: null,
  };
}

export async function getBundleEmailPayload(bundleId: string) {
  const bundle = await prisma.analysisBundle.findUnique({ where: { id: bundleId } });
  if (!bundle) {
    throw new Error("Bundle not found");
  }

  const isCurrentBundle = await isCurrentBundleId(bundle.userId, bundle.id);

  const eligibility = buildDeliveryEligibility({
    bundleId: bundle.id,
    bundleOutcome: bundle.bundleOutcome,
    isCurrentBundle,
    isSuperseded: bundle.isSuperseded,
    acknowledgedAt: bundle.acknowledgedAt,
    deliveryStatus: bundle.deliveryStatus as any,
    emailPayloadJson: bundle.emailPayloadJson,
  });

  const emailPayload = parseJsonField<Record<string, unknown>>(bundle.emailPayloadJson, "emailPayloadJson");

  return {
    bundle,
    emailPayload,
    eligibility,
  };
}
