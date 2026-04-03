import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import type { ProgressEvent } from "@/lib/research/progress-events";
import type { DeliveryStatus } from "@/lib/contracts";
import {
  enrichConcurrentRunMessage,
  isConcurrentRunError,
  startOfToday,
  type ActiveRunSummary,
} from "./daily-check-concurrency";

export interface RunStreamAnalysisInput {
  snapshotId: string;
  customPrompt?: string;
  emit: (event: ProgressEvent) => void;
  triggerType?: "manual" | "scheduled" | "debug";
  triggeredBy?: string;
  existingRunId?: string;
}

export interface TerminalRecommendationInput {
  ticker: string;
  companyName: string;
  role: string | null;
  currentShares: number;
  currentPrice: number;
  targetShares: number;
  shareDelta: number;
  dollarDelta: number;
  currentWeight: number;
  targetWeight: number;
  acceptableRangeLow: number;
  acceptableRangeHigh: number;
  valueDelta: number;
  action: string;
  confidence: string;
  positionStatus: string;
  evidenceQuality: string;
  thesisSummary: string;
  detailedReasoning: string;
  whyChanged: string;
  systemNote?: string;
  reasoningSources: Array<Record<string, unknown>>;
}

export interface FinalizeAnalysisRunInput {
  runId: string;
  userId: string;
  snapshotId: string;
  bundleScope?: string;
  outcome: "validated" | "abstained" | "degraded" | "failed";
  completedAt?: Date;
  reportSummary?: string | null;
  reportReasoning?: string | null;
  reportMarketContext?: Record<string, unknown> | null;
  recommendations: TerminalRecommendationInput[];
  alertLevel?: string | null;
  alertReason?: string | null;
  errorMessage?: string | null;
  failureCode?: string | null;
  profileSnapshot: Record<string, unknown>;
  convictionsSnapshot: Array<Record<string, unknown>>;
  evidencePacket: Record<string, unknown>;
  evidenceHash: string;
  evidenceFreshness: Record<string, unknown>;
  sourceList: Array<Record<string, unknown>>;
  versions: {
    analysisPolicyVersion: string;
    schemaVersion: string;
    promptVersion: string;
    viewModelVersion: string;
    emailTemplateVersion: string;
    modelPolicyVersion: string;
  };
  llm: {
    primaryModel: string;
    structuredScore: Record<string, unknown>;
    responseHash?: string | null;
    usage: Record<string, unknown>;
  };
  deterministic: {
    factorLedger: Record<string, unknown>;
    recommendationDecision: Record<string, unknown>;
    positionSizing: Record<string, unknown>;
  };
  validationSummary: {
    hardErrorCount: number;
    warningCount: number;
    reasonCodes: string[];
    debugDetailsRef?: string | null;
  };
  abstainReasonCodes?: string[];
  degradedReasonCodes?: string[];
  reportViewModel: Record<string, unknown>;
  emailPayload?: Record<string, unknown> | null;
  exportPayload: Record<string, unknown>;
  qualityMeta?: Record<string, unknown>;
  changeLogs?: Array<Record<string, unknown>>;
}

interface FinalizeAnalysisRunResult {
  runId: string;
  bundleId: string | null;
  reportId: string | null;
  outcome: FinalizeAnalysisRunInput["outcome"];
}

export interface PersistBackfilledLegacyBundleInput {
  legacyArtifactId: string;
  artifactIdentityKey: string;
  userId: string;
  bundleScope: string;
  analysisRunId: string;
  snapshotId: string;
  createdAt: Date;
  finalizedAt: Date;
  summary: string;
  reasoning: string;
  marketContext: Record<string, unknown>;
  recommendations: Array<{
    id: string;
    ticker: string;
    companyName: string | null;
    role: string | null;
    currentShares: number;
    targetShares: number;
    shareDelta: number;
    currentWeight: number;
    targetWeight: number;
    valueDelta: number;
    dollarDelta: number | null;
    acceptableRangeLow: number | null;
    acceptableRangeHigh: number | null;
    action: string;
    confidence: string | null;
    positionStatus: string | null;
    evidenceQuality: string | null;
    thesisSummary: string | null;
    detailedReasoning: string | null;
    whyChanged: string | null;
    systemNote: string | null;
    reasoningSources: Array<Record<string, unknown>>;
  }>;
  profileSnapshot: Record<string, unknown>;
  convictionsSnapshot: Array<Record<string, unknown>>;
}

function buildBackfilledLegacyBundlePayload(input: PersistBackfilledLegacyBundleInput) {
  const provenance = {
    origin: "backfilled_legacy" as const,
    legacyArtifactId: input.legacyArtifactId,
    artifactIdentityKey: input.artifactIdentityKey,
    backfilledAt: new Date().toISOString(),
  };

  return {
    bundleScope: input.bundleScope,
    portfolioSnapshotHash: hashJson({
      legacyArtifactId: input.legacyArtifactId,
      snapshotId: input.snapshotId,
    }),
    userProfileSnapshotJson: JSON.stringify(input.profileSnapshot),
    userProfileHash: hashJson(input.profileSnapshot),
    convictionSnapshotJson: JSON.stringify(input.convictionsSnapshot),
    convictionHash: hashJson(input.convictionsSnapshot),
    analysisPolicyVersion: "legacy-backfill-v1",
    schemaVersion: "legacy-backfill-v1",
    promptVersion: "legacy-backfill-v1",
    viewModelVersion: "legacy-backfill-v1",
    emailTemplateVersion: "legacy-backfill-v1",
    modelPolicyVersion: "legacy-backfill-v1",
    evidencePacketJson: JSON.stringify(provenance),
    evidenceHash: hashJson(provenance),
    evidenceFreshnessJson: JSON.stringify({
      source: "legacy_persisted",
      finalizedAt: input.finalizedAt.toISOString(),
      backfilledAt: provenance.backfilledAt,
    }),
    sourceListJson: JSON.stringify([]),
    primaryModel: "legacy_backfill",
    llmStructuredScoreJson: JSON.stringify({ origin: provenance.origin }),
    llmResponseHash: null,
    llmUsageJson: JSON.stringify({}),
    factorLedgerJson: JSON.stringify({
      legacyArtifactId: input.legacyArtifactId,
      artifactIdentityKey: input.artifactIdentityKey,
    }),
    recommendationDecisionJson: JSON.stringify({
      recommendationsCount: input.recommendations.length,
    }),
    positionSizingJson: JSON.stringify({
      recommendations: input.recommendations.map((row) => ({
        ticker: row.ticker,
        targetShares: row.targetShares,
        targetWeight: row.targetWeight,
      })),
    }),
    bundleOutcome: "validated",
    validationSummaryJson: JSON.stringify({
      hardErrorCount: 0,
      warningCount: 0,
      reasonCodes: [],
      debugDetailsRef: input.legacyArtifactId,
    }),
    abstainReasonCodesJson: JSON.stringify([]),
    degradedReasonCodesJson: JSON.stringify([]),
    reportViewModelJson: JSON.stringify({
      bundleId: "pending",
      bundleOutcome: "validated",
      renderState: "validated_actionable",
      createdAt: input.createdAt.toISOString(),
      finalizedAt: input.finalizedAt.toISOString(),
      summaryMessage: input.summary,
      reasoning: input.reasoning,
      reasonCodes: [],
      recommendations: input.recommendations.map((row) => ({
        id: row.id,
        ticker: row.ticker,
        companyName: row.companyName ?? row.ticker,
        role: row.role ?? "legacy",
        currentShares: row.currentShares,
        targetShares: row.targetShares,
        shareDelta: row.shareDelta,
        currentWeight: row.currentWeight,
        targetWeight: row.targetWeight,
        acceptableRangeLow: row.acceptableRangeLow,
        acceptableRangeHigh: row.acceptableRangeHigh,
        dollarDelta: row.dollarDelta ?? 0,
        action: row.action,
        actionLabel: row.action,
        actionBadgeVariant: String(row.action).toLowerCase() as "buy" | "hold" | "trim" | "sell" | "exit",
        sortPriority: 0,
        confidence: row.confidence ?? "medium",
        positionStatus: row.positionStatus ?? "on_target",
        evidenceQuality: row.evidenceQuality ?? "medium",
        thesisSummary: row.thesisSummary ?? "",
        detailedReasoning: row.detailedReasoning ?? "",
        whyChanged: row.whyChanged,
        systemNote: row.systemNote ?? null,
        sources: row.reasoningSources ?? [],
        isNewPosition: row.currentShares === 0 && row.targetShares > 0,
        isExiting: row.targetShares === 0,
        hasStcgWarning: false,
        isFractionalRebalance: false,
      })),
      deliveryStatus: "not_eligible",
      isActionable: true,
      isSuperseded: false,
      historicalValidatedContextBundleId: null,
    }),
    emailPayloadJson: JSON.stringify({
      bundleId: "pending",
      generatedAt: input.finalizedAt.toISOString(),
      subject: `Backfilled portfolio update`,
      summary: input.summary,
      html: "",
      recommendations: input.recommendations.map((row) => ({
        ticker: row.ticker,
        companyName: row.companyName ?? row.ticker,
        action: row.action,
        targetShares: row.targetShares,
        targetWeight: row.targetWeight,
        thesisSummary: row.thesisSummary ?? "",
      })),
    }),
    exportPayloadJson: JSON.stringify({
      summary: input.summary,
      reasoning: input.reasoning,
      alertLevel: null,
      alertReason: null,
      recommendations: input.recommendations,
      marketContext: input.marketContext,
      origin: provenance.origin,
    }),
    deliveryStatus: "not_eligible" as const,
    finalizedAt: input.finalizedAt,
    createdAt: input.createdAt,
  };
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function toDeliveryStatus(outcome: FinalizeAnalysisRunInput["outcome"]): DeliveryStatus {
  if (outcome === "validated") return "awaiting_ack";
  return "not_eligible";
}

function buildBundlePayload(input: FinalizeAnalysisRunInput, completedAt: Date) {
  const profileSnapshotJson = JSON.stringify(input.profileSnapshot);
  const convictionSnapshotJson = JSON.stringify(input.convictionsSnapshot);
  const reportViewModelJson = JSON.stringify(input.reportViewModel);
  const exportPayloadJson = JSON.stringify(input.exportPayload);
  const emailPayloadJson = input.outcome === "validated" ? JSON.stringify(input.emailPayload ?? null) : null;
  const recommendationRows = input.outcome === "validated" ? input.recommendations : [];

  return {
    bundleScope: input.bundleScope ?? "PRIMARY_PORTFOLIO",
    portfolioSnapshotHash: hashJson({
      snapshotId: input.snapshotId,
      recommendations: recommendationRows.map((row) => ({
        ticker: row.ticker,
        targetShares: row.targetShares,
        action: row.action,
      })),
    }),
    userProfileSnapshotJson: profileSnapshotJson,
    userProfileHash: hashJson(input.profileSnapshot),
    convictionSnapshotJson,
    convictionHash: hashJson(input.convictionsSnapshot),
    analysisPolicyVersion: input.versions.analysisPolicyVersion,
    schemaVersion: input.versions.schemaVersion,
    promptVersion: input.versions.promptVersion,
    viewModelVersion: input.versions.viewModelVersion,
    emailTemplateVersion: input.versions.emailTemplateVersion,
    modelPolicyVersion: input.versions.modelPolicyVersion,
    evidencePacketJson: JSON.stringify(input.evidencePacket),
    evidenceHash: input.evidenceHash,
    evidenceFreshnessJson: JSON.stringify(input.evidenceFreshness),
    sourceListJson: JSON.stringify(input.sourceList),
    primaryModel: input.llm.primaryModel,
    llmStructuredScoreJson: JSON.stringify(input.llm.structuredScore),
    llmResponseHash: input.llm.responseHash ?? null,
    llmUsageJson: JSON.stringify(input.llm.usage),
    factorLedgerJson: JSON.stringify(input.deterministic.factorLedger),
    recommendationDecisionJson: JSON.stringify(input.deterministic.recommendationDecision),
    positionSizingJson: JSON.stringify(input.deterministic.positionSizing),
    bundleOutcome: input.outcome === "failed" ? "abstained" : input.outcome,
    validationSummaryJson: JSON.stringify(input.validationSummary),
    abstainReasonCodesJson: JSON.stringify(input.abstainReasonCodes ?? []),
    degradedReasonCodesJson: JSON.stringify(input.degradedReasonCodes ?? []),
    reportViewModelJson,
    emailPayloadJson,
    exportPayloadJson,
    deliveryStatus: toDeliveryStatus(input.outcome),
    finalizedAt: completedAt,
  };
}

function withPersistedBundleId<T extends Record<string, unknown> | null | undefined>(payload: T, bundleId: string): T {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  return {
    ...payload,
    bundleId,
  } as T;
}

function withPersistedEvidenceBundleId(
  evidencePacket: Record<string, unknown>,
  bundleId: string
): Record<string, unknown> {
  const diagnosticsArtifact = evidencePacket.diagnosticsArtifact;

  if (!diagnosticsArtifact || typeof diagnosticsArtifact !== "object" || Array.isArray(diagnosticsArtifact)) {
    return evidencePacket;
  }

  return {
    ...evidencePacket,
    diagnosticsArtifact: {
      ...diagnosticsArtifact,
      bundleId,
    },
  };
}

function buildLegacyRecommendationRows(recommendations: TerminalRecommendationInput[], analysisBundleId: string, reportId: string) {
  return recommendations.map((row) => ({
    reportId,
    analysisBundleId,
    ticker: row.ticker,
    companyName: row.companyName,
    role: row.role,
    currentShares: row.currentShares,
    targetShares: row.targetShares,
    shareDelta: row.shareDelta,
    currentWeight: row.currentWeight,
    targetWeight: row.targetWeight,
    valueDelta: row.valueDelta ?? 0,
    dollarDelta: row.dollarDelta ?? null,
    acceptableRangeLow: row.acceptableRangeLow ?? null,
    acceptableRangeHigh: row.acceptableRangeHigh ?? null,
    action: row.action,
    confidence: row.confidence ?? null,
    positionStatus: row.positionStatus ?? null,
    evidenceQuality: row.evidenceQuality ?? null,
    thesisSummary: row.thesisSummary ?? null,
    detailedReasoning: row.detailedReasoning ?? null,
    whyChanged: row.whyChanged ?? null,
    systemNote: row.systemNote ?? null,
    reasoningSources: JSON.stringify(row.reasoningSources ?? []),
  }));
}

export async function finalizeAnalysisRun(input: FinalizeAnalysisRunInput): Promise<FinalizeAnalysisRunResult> {
  const existingBundle = await prisma.analysisBundle.findUnique({
    where: { sourceRunId: input.runId },
    include: { holdingRecommendations: { select: { id: true } } },
  });

  if (existingBundle) {
    const existingReport = await prisma.portfolioReport.findFirst({
      where: { analysisRunId: input.runId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });

    return {
      runId: input.runId,
      bundleId: existingBundle.id,
      reportId: existingReport?.id ?? null,
      outcome: input.outcome,
    };
  }

  if (input.outcome === "failed") {
    await prisma.analysisRun.update({
      where: { id: input.runId },
      data: {
        status: "failed",
        stage: "failed",
        failureCode: input.failureCode ?? "UNHANDLED_EXCEPTION",
        errorMessage: input.errorMessage ?? "Analysis failed before terminal bundle creation",
        completedAt: input.completedAt ?? new Date(),
        qualityMeta: input.qualityMeta ? JSON.stringify(input.qualityMeta) : undefined,
      },
    });

    return {
      runId: input.runId,
      bundleId: null,
      reportId: null,
      outcome: input.outcome,
    };
  }

  const completedAt = input.completedAt ?? new Date();
  const bundlePayload = buildBundlePayload(input, completedAt);

  return prisma.$transaction(async (tx) => {
    await tx.analysisBundle.updateMany({
      where: {
        userId: input.userId,
        bundleScope: bundlePayload.bundleScope,
        isSuperseded: false,
      },
      data: {
        isSuperseded: true,
        supersededAt: completedAt,
      },
    });

    const bundle = await tx.analysisBundle.create({
      data: {
        userId: input.userId,
        sourceRunId: input.runId,
        portfolioSnapshotId: input.snapshotId,
        ...bundlePayload,
        evidencePacketJson: JSON.stringify(withPersistedEvidenceBundleId(input.evidencePacket, "pending")),
        reportViewModelJson: JSON.stringify(withPersistedBundleId(input.reportViewModel, "pending")),
        emailPayloadJson: input.outcome === "validated"
          ? JSON.stringify(withPersistedBundleId(input.emailPayload ?? null, "pending"))
          : null,
      },
    });

    await tx.analysisBundle.update({
      where: { id: bundle.id },
      data: {
        evidencePacketJson: JSON.stringify(withPersistedEvidenceBundleId(input.evidencePacket, bundle.id)),
        reportViewModelJson: JSON.stringify(withPersistedBundleId(input.reportViewModel, bundle.id)),
        emailPayloadJson: input.outcome === "validated"
          ? JSON.stringify(withPersistedBundleId(input.emailPayload ?? null, bundle.id))
          : null,
      },
    });

    let reportId: string | null = null;
    if (input.outcome === "validated") {
      const report = await tx.portfolioReport.create({
        data: {
          userId: input.userId,
          snapshotId: input.snapshotId,
          analysisRunId: input.runId,
          summary: input.reportSummary ?? null,
          reasoning: input.reportReasoning ?? null,
          marketContext: JSON.stringify(input.reportMarketContext ?? {}),
        },
      });
      reportId = report.id;

      if (input.recommendations.length > 0) {
        await tx.holdingRecommendation.createMany({
          data: buildLegacyRecommendationRows(input.recommendations, bundle.id, report.id),
        });
      }
    }

    await tx.analysisRun.update({
      where: { id: input.runId },
      data: {
        status: input.outcome === "validated" ? "complete" : input.outcome,
        stage: input.outcome === "validated" ? "finalized_validated" : input.outcome === "abstained" ? "finalized_abstained" : "finalized_degraded",
        completedAt,
        alertLevel: input.alertLevel ?? null,
        alertReason: input.alertReason ?? null,
        errorMessage: input.errorMessage ?? null,
        failureCode: null,
        profileSnapshot: JSON.stringify(input.profileSnapshot),
        qualityMeta: input.qualityMeta ? JSON.stringify(input.qualityMeta) : undefined,
        createdBundle: {
          connect: { id: bundle.id },
        },
        changeLogs: input.outcome === "validated" && input.changeLogs && input.changeLogs.length > 0
          ? { create: input.changeLogs as any[] }
          : undefined,
      },
    });

    return {
      runId: input.runId,
      bundleId: bundle.id,
      reportId,
      outcome: input.outcome,
    };
  });
}

export async function persistBackfilledLegacyBundle(input: PersistBackfilledLegacyBundleInput) {
  const existingBundle = await prisma.analysisBundle.findUnique({
    where: { sourceRunId: input.analysisRunId },
    select: { id: true },
  });

  if (existingBundle) {
    return {
      bundleId: existingBundle.id,
      origin: "backfilled_legacy" as const,
      artifactIdentityKey: input.artifactIdentityKey,
    };
  }

  const payload = buildBackfilledLegacyBundlePayload(input);

  return prisma.$transaction(async (tx) => {
    const currentBundle = await tx.analysisBundle.findFirst({
      where: {
        userId: input.userId,
        bundleScope: input.bundleScope,
        isSuperseded: false,
      },
      orderBy: { finalizedAt: "desc" },
      select: {
        id: true,
        finalizedAt: true,
      },
    });

    const bundle = await tx.analysisBundle.create({
      data: {
        userId: input.userId,
        sourceRunId: input.analysisRunId,
        portfolioSnapshotId: input.snapshotId,
        ...payload,
        isSuperseded: !!currentBundle && currentBundle.finalizedAt >= input.finalizedAt,
        supersededAt: currentBundle && currentBundle.finalizedAt >= input.finalizedAt
          ? currentBundle.finalizedAt
          : null,
      },
    });

    await tx.analysisBundle.update({
      where: { id: bundle.id },
      data: {
        reportViewModelJson: JSON.stringify({
          ...JSON.parse(payload.reportViewModelJson),
          bundleId: bundle.id,
        }),
        emailPayloadJson: JSON.stringify({
          ...JSON.parse(payload.emailPayloadJson!),
          bundleId: bundle.id,
        }),
      },
    });

    if (input.recommendations.length > 0) {
      await tx.holdingRecommendation.updateMany({
        where: {
          id: {
            in: input.recommendations.map((row) => row.id),
          },
        },
        data: {
          analysisBundleId: bundle.id,
        },
      });
    }

    return {
      bundleId: bundle.id,
      origin: "backfilled_legacy" as const,
      artifactIdentityKey: input.artifactIdentityKey,
    };
  });
}

export async function runStreamAnalysis(input: RunStreamAnalysisInput) {
  const { runFullAnalysis } = await import("@/lib/research/analysis-orchestrator");

  return runFullAnalysis(
    input.snapshotId,
    input.customPrompt,
    input.emit,
    input.triggerType ?? "manual",
    input.triggeredBy,
    input.existingRunId
  );
}

async function findLatestActiveRun(userId: string): Promise<ActiveRunSummary | null> {
  const activeRun = await prisma.analysisRun.findFirst({
    where: { userId, status: "running" },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      triggerType: true,
      stage: true,
      startedAt: true,
    },
  });

  if (!activeRun) {
    return null;
  }

  return {
    id: activeRun.id,
    triggerType: activeRun.triggerType,
    stage: activeRun.stage,
    startedAt: activeRun.startedAt,
  };
}

export async function runDailyCheck(opts: {
  triggerType?: "scheduled" | "manual" | "debug";
  triggeredBy?: string;
  onProgress?: (step: number) => void;
} = {}): Promise<{ runId: string; reportId: string; alertLevel: string }> {
  const { triggerType = "scheduled", triggeredBy = "cron", onProgress } = opts;

  const user = await prisma.user.findFirst({ include: { profile: true } });
  if (!user || !user.profile) throw new Error("No user profile found.");

  const zombieThreshold = new Date(Date.now() - 15 * 60 * 1000);
  const zombieCount = await prisma.analysisRun.updateMany({
    where: { userId: user.id, status: "running", startedAt: { lt: zombieThreshold } },
    data: { status: "failed", errorMessage: "Auto-failed: stuck in running state for >15 minutes", completedAt: new Date() },
  });
  if (zombieCount.count > 0) {
    console.warn(`[analysis-lifecycle-service] Cleaned up ${zombieCount.count} zombie run(s).`);
  }

  const snapshot = await prisma.portfolioSnapshot.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
  });
  if (!snapshot) throw new Error("No portfolio snapshot found.");

  try {
    const settingsObj = await prisma.appSettings.findFirst({ where: { key: "portfolio_config" } });
    const settings = settingsObj ? JSON.parse(settingsObj.value) : {};
    void settings;

    const { enrichPricesWithLLM } = await import("@/app/actions");
    const tickersToEnrich = snapshot.holdings.filter((h: any) => !h.isCash).map((h: any) => h.ticker);
    let topOfTheMinuteHoldings = snapshot.holdings;
    try {
      if (tickersToEnrich.length > 0) {
        onProgress?.(1);
        const livePrices: Record<string, number> = await Promise.race([
          enrichPricesWithLLM(tickersToEnrich),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Yahoo Finance timeout")), 10000)),
        ]) as Record<string, number>;
        topOfTheMinuteHoldings = snapshot.holdings.map((h: any) => {
          if (h.isCash) return h;
          const freshPrice = livePrices[h.ticker.toUpperCase()];
          if (freshPrice) {
            return { ...h, currentPrice: freshPrice, currentValue: Number((h.shares * freshPrice).toFixed(2)) };
          }
          return h;
        });

        await prisma.$transaction(topOfTheMinuteHoldings.map((h: any) => prisma.holding.update({
          where: { id: h.id },
          data: { currentPrice: h.currentPrice, currentValue: h.currentValue },
        })));
      }
    } catch (e) {
      console.warn("Pricing live-fetch failed during scheduled run, falling back to db values.", e);
    }

    let result;
    try {
      result = await runStreamAnalysis({
        snapshotId: snapshot.id,
        emit: (event: any) => {
          if (event.type === "log") {
            console.log(`[scheduler-ai] ${event.message}`);
          } else if (event.type === "stage_start") {
            console.log(`[scheduler-ai] >>> Starting Stage: ${event.label} - ${event.detail}`);
          }
        },
        triggerType: triggerType as any,
        triggeredBy,
      });
    } catch (err: any) {
      if (!isConcurrentRunError(err)) {
        throw err;
      }

      const activeRun = await findLatestActiveRun(user.id);
      throw new Error(enrichConcurrentRunMessage(err.message, activeRun), { cause: err });
    }

    const shouldEmailDaily = result.alertLevel === "red" || result.alertLevel === "yellow";
    if (shouldEmailDaily) {
      const recipients = await prisma.notificationRecipient.findMany({
        where: { userId: user.id, active: true },
      });

      const today = startOfToday().toISOString().split("T")[0];
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const { renderDailyAlertEmail } = await import("@/lib/email-templates");
      const { sendEmailNotification } = await import("./email-delivery-service");

      for (const recipient of recipients) {
        const alreadySent = await prisma.notificationEvent.findFirst({
          where: {
            userId: user.id,
            runId: result.runId,
            recipient: recipient.email,
            type: "daily_alert",
            status: "sent",
          },
        });
        if (alreadySent) {
          console.log(`[analysis-lifecycle-service] Skipping duplicate email to ${recipient.email} for run ${result.runId}`);
          continue;
        }

        const { subject, html } = renderDailyAlertEmail({
          reportId: result.reportId,
          alertLevel: result.alertLevel as any,
          alertReason: result.alertReason ?? "",
          changes: result.changes,
          recommendations: result.report.recommendations,
          profile: user.profile,
          runDate: today,
          reportSummary: result.report.summary ?? undefined,
          reportReasoning: result.report.reasoning ?? undefined,
          appUrl,
        });

        await sendEmailNotification({
          userId: user.id,
          runId: result.runId,
          reportId: result.reportId,
          type: "daily_alert",
          recipient: recipient.email,
          subject,
          html,
        });
      }
    }

    return { runId: result.runId, reportId: result.reportId, alertLevel: result.alertLevel };
  } catch (err: any) {
    console.error(`[analysis-lifecycle-service] runDailyCheck failed: ${err?.message}`);
    throw err;
  }
}
