/**
 * scheduler.ts
 * Core daily-run logic. Called identically by:
 *   - The cron process (headless, background)
 *   - The /api/cron/daily-check route (external scheduler call)
 *   - Manual "Run daily check now" button (debug trigger)
 * 
 * Trigger types: "scheduled" | "manual" | "debug"
 *
 * Batch 7 fixes:
 *   - Removed duplicate staging AnalysisRun.create (Batch 5 orchestrator owns it)
 *   - Email runId now tied to result.runId (confirmed run, not a pre-created stub)
 *   - Idempotency check: skips email if NotificationEvent already exists for (runId, recipient, type)
 *   - latestReport and snapshot scoped to user.id (cross-user data leak prevention)
 */

import { prisma } from "./prisma";
import { runFullAnalysis } from "./research/analysis-orchestrator";
import { sendMail } from "./mailer";
import { renderDailyAlertEmail } from "./email-templates";

export async function runDailyCheck(opts: {
  triggerType?: "scheduled" | "manual" | "debug";
  triggeredBy?: string;
  onProgress?: (step: number) => void;
} = {}): Promise<{ runId: string; reportId: string; alertLevel: string }> {
  const { triggerType = "scheduled", triggeredBy = "cron", onProgress } = opts;

  const user = await prisma.user.findFirst({ include: { profile: true } });
  if (!user || !user.profile) throw new Error("No user profile found.");

  // T4.1 — Zombie run cleanup: force-fail any run stuck in "running" for >15 minutes
  const zombieThreshold = new Date(Date.now() - 15 * 60 * 1000);
  const zombieCount = await prisma.analysisRun.updateMany({
    where: { userId: user.id, status: "running", startedAt: { lt: zombieThreshold } },
    data: { status: "failed", errorMessage: "Auto-failed: stuck in running state for >15 minutes", completedAt: new Date() },
  });
  if (zombieCount.count > 0) {
    console.warn(`[scheduler] Cleaned up ${zombieCount.count} zombie run(s).`);
  }

  // Batch 7: scope snapshot and latestReport to current user
  const snapshot = await prisma.portfolioSnapshot.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
  });
  if (!snapshot) throw new Error("No portfolio snapshot found.");

  // Batch 5+7: DO NOT pre-create an AnalysisRun here.
  // The orchestrator (runFullAnalysis) creates its own staging run before the LLM call.
  // Passing existingRunId caused a double-run record; the orchestrator now owns the run lifecycle.

  try {
    const settingsObj = await prisma.appSettings.findFirst({ where: { key: "portfolio_config" } });
    const settings = settingsObj ? JSON.parse(settingsObj.value) : {};

    // Prevent analyzer from using stale or badly OCR'd prices by forcing a live fetch
    const { enrichPricesWithLLM } = await import("@/app/actions");
    const tickersToEnrich = snapshot.holdings.filter((h: any) => !h.isCash).map((h: any) => h.ticker);
    let topOfTheMinuteHoldings = snapshot.holdings;
    try {
      if (tickersToEnrich.length > 0) {
        onProgress?.(1);
        const livePrices: Record<string, number> = await Promise.race([
          enrichPricesWithLLM(tickersToEnrich),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Yahoo Finance timeout")), 10000))
        ]) as Record<string, number>;
        topOfTheMinuteHoldings = snapshot.holdings.map((h: any) => {
          if (h.isCash) return h;
          const freshPrice = livePrices[h.ticker.toUpperCase()];
          if (freshPrice) {
            return { ...h, currentPrice: freshPrice, currentValue: Number((h.shares * freshPrice).toFixed(2)) };
          }
          return h;
        });

        // Persist strictly corrected prices to DB so UI is globally synced
        await prisma.$transaction(topOfTheMinuteHoldings.map((h: any) => prisma.holding.update({
          where: { id: h.id },
          data: { currentPrice: h.currentPrice, currentValue: h.currentValue }
        })));
      }
    } catch (e) {
      console.warn("Pricing live-fetch failed during scheduled run, falling back to db values.", e);
    }

    // Batch 7: do NOT pass existingRunId — orchestrator creates and owns its staging run
    const result = await runFullAnalysis(
      snapshot.id,
      undefined,
      (event: any) => {
        if (event.type === "log") {
          console.log(`[scheduler-ai] ${event.message}`);
        } else if (event.type === "stage_start") {
          console.log(`[scheduler-ai] >>> Starting Stage: ${event.label} - ${event.detail}`);
        }
      },
      triggerType as any,
      triggeredBy,
      // no existingRunId
    );

    // Send email notifications if warranted
    const shouldEmailDaily = result.alertLevel === "red" || result.alertLevel === "yellow";
    if (shouldEmailDaily) {
      const recipients = await prisma.notificationRecipient.findMany({
        where: { userId: user.id, active: true },
      });

      const today = new Date().toISOString().split("T")[0];
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

      for (const recipient of recipients) {
        // Batch 7: Idempotency check — skip if already sent for this run + recipient + type
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
          console.log(`[scheduler] Skipping duplicate email to ${recipient.email} for run ${result.runId}`);
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

        const mailRes = await sendMail({ to: recipient.email, subject, html });

        await prisma.notificationEvent.create({
          data: {
            userId: user.id,
            runId: result.runId,       // Batch 7: confirmed run (not pre-created stub)
            reportId: result.reportId, // Batch 7: wire reportId
            type: "daily_alert",
            channel: "email",
            recipient: recipient.email,
            subject,
            status: mailRes.ok ? "sent" : "failed",
            errorMessage: mailRes.error,
          },
        });
      }
    }

    return { runId: result.runId, reportId: result.reportId, alertLevel: result.alertLevel };
  } catch (err: any) {
    // Batch 7: orchestrator owns its own staging run error state.
    // Log here but do not double-update — orchestrator already marks status="failed"/"abstained".
    console.error(`[scheduler] runDailyCheck failed: ${err?.message}`);
    throw err;
  }
}
