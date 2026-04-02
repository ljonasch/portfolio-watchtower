import { prisma } from "@/lib/prisma";
import { runFullAnalysis } from "@/lib/research/analysis-orchestrator";
import { renderDailyAlertEmail } from "@/lib/email-templates";
import { sendEmailNotification } from "./email-delivery-service";

export interface RunStreamAnalysisInput {
  snapshotId: string;
  customPrompt?: string;
  emit: (event: any) => void;
  triggerType?: "manual" | "scheduled" | "debug";
  triggeredBy?: string;
  existingRunId?: string;
}

export async function runStreamAnalysis(input: RunStreamAnalysisInput) {
  return runFullAnalysis(
    input.snapshotId,
    input.customPrompt,
    input.emit,
    input.triggerType ?? "manual",
    input.triggeredBy,
    input.existingRunId
  );
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

    const result = await runStreamAnalysis({
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

    const shouldEmailDaily = result.alertLevel === "red" || result.alertLevel === "yellow";
    if (shouldEmailDaily) {
      const recipients = await prisma.notificationRecipient.findMany({
        where: { userId: user.id, active: true },
      });

      const today = new Date().toISOString().split("T")[0];
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

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
