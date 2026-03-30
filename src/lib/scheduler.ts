/**
 * scheduler.ts
 * Core daily-run logic. Called identically by:
 *   - The cron process (headless, background)
 *   - The /api/cron/daily-check route (external scheduler call)
 *   - Manual "Run daily check now" button (debug trigger)
 * 
 * Trigger types: "scheduled" | "manual" | "debug"
 */

import { prisma } from "./prisma";
import { generatePortfolioReport } from "./analyzer";
import { compareRecommendations } from "./comparator";
import { evaluateAlert } from "./alerts";
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

  // Use the snapshot from the latest CONFIRMED report as ground truth
  const latestReport = await prisma.portfolioReport.findFirst({
    orderBy: { createdAt: "desc" },
    include: { snapshot: { include: { holdings: true } }, recommendations: true },
  });
  const snapshot = latestReport?.snapshot ?? await prisma.portfolioSnapshot.findFirst({
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
  });
  if (!snapshot) throw new Error("No portfolio snapshot found.");

  // Create the AnalysisRun audit record
  const run = await prisma.analysisRun.create({
    data: {
      userId: user.id,
      snapshotId: snapshot.id,
      triggerType,
      triggeredBy,
      status: "running",
      profileSnapshot: JSON.stringify(user.profile),
    },
  });

  try {
    const settingsObj = await prisma.appSettings.findFirst({ where: { key: "portfolio_config" } });
    const settings = settingsObj ? JSON.parse(settingsObj.value) : {};

    // Prevent analyzer from using stale or badly OCR'd prices by forcing a live fetch
    const { enrichPricesWithLLM } = await import("@/app/actions");
    const tickersToEnrich = snapshot.holdings.filter((h: any) => !h.isCash).map((h: any) => h.ticker);
    let topOfTheMinuteHoldings = snapshot.holdings;
    try {
      if (tickersToEnrich.length > 0) {
        onProgress?.(1); // Signify fetching market data
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

    // Run the full analysis (with live search + AI)
    const reportData = await generatePortfolioReport(
      topOfTheMinuteHoldings,
      user.profile,
      settings,
      onProgress,
      latestReport?.recommendations
    );

    // Store the report
    const seenTickers = new Set<string>();
    const deduped = reportData.recommendations.filter((r) => {
      if (seenTickers.has(r.ticker)) return false;
      seenTickers.add(r.ticker);
      return true;
    });

    const report = await prisma.portfolioReport.create({
      data: {
        userId: user.id,
        snapshotId: snapshot.id,
        analysisRunId: run.id,
        summary: reportData.summary,
        reasoning: reportData.reasoning,
        marketContext: JSON.stringify(reportData.marketContext ?? { shortTerm: [], mediumTerm: [], longTerm: [] }),
        recommendations: {
          create: deduped.map((r) => ({
            ticker: r.ticker,
            companyName: r.companyName,
            role: r.role,
            currentShares: r.currentShares,
            targetShares: r.targetShares,
            shareDelta: r.shareDelta,
            currentWeight: r.currentWeight,
            targetWeight: r.targetWeight,
            valueDelta: r.valueDelta,
            action: r.action,
            confidence: r.confidence,
            thesisSummary: r.thesisSummary,
            detailedReasoning: r.detailedReasoning,
            reasoningSources: JSON.stringify(r.reasoningSources ?? []),
          })),
        },
      },
      include: { recommendations: true },
    });

    // Compare with prior run
    const priorRecs = latestReport?.recommendations ?? [];
    const changes = compareRecommendations(priorRecs, report.recommendations);

    // Store change logs
    if (changes.length > 0) {
      await prisma.recommendationChangeLog.createMany({
        data: changes.map((c) => ({
          runId: run.id,
          ticker: c.ticker,
          companyName: c.companyName,
          priorAction: c.priorAction,
          newAction: c.newAction,
          priorTargetShares: c.priorTargetShares,
          newTargetShares: c.newTargetShares,
          sharesDelta: c.sharesDelta,
          priorWeight: c.priorWeight,
          newWeight: c.newWeight,
          changed: c.changed,
          changeReason: c.changeReason,
        })),
      });
    }

    // Evaluate alert level
    const alert = evaluateAlert(changes, report.recommendations, user.profile, null);

    // Update the run record
    await prisma.analysisRun.update({
      where: { id: run.id },
      data: {
        status: "complete",
        alertLevel: alert.level,
        alertReason: alert.reason,
        completedAt: new Date(),
      },
    });

    // Send email notifications if warranted
    if (alert.shouldEmailDaily) {
      const recipients = await prisma.notificationRecipient.findMany({
        where: { userId: user.id, active: true },
      });

      const today = new Date().toISOString().split("T")[0];
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

      for (const recipient of recipients) {
        const { subject, html } = renderDailyAlertEmail({
          alertLevel: alert.level as any,
          alertReason: alert.reason,
          changes,
          recommendations: report.recommendations,
          profile: user.profile,
          runDate: today,
          appUrl,
        });

        const result = await sendMail({ to: recipient.email, subject, html });

        await prisma.notificationEvent.create({
          data: {
            userId: user.id,
            runId: run.id,
            type: "daily_alert",
            channel: "email",
            recipient: recipient.email,
            subject,
            status: result.ok ? "sent" : "failed",
            errorMessage: result.error,
          },
        });
      }
    }

    return { runId: run.id, reportId: report.id, alertLevel: alert.level };
  } catch (err: any) {
    await prisma.analysisRun.update({
      where: { id: run.id },
      data: { status: "failed", errorMessage: err?.message, completedAt: new Date() },
    });
    throw err;
  }
}
