import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { renderTestEmail, renderDailyAlertEmail, renderWeeklySummaryEmail } from "@/lib/email-templates";
import { NextResponse } from "next/server";
import { evaluateAlert, AlertLevel } from "@/lib/alerts";
import { compareRecommendations } from "@/lib/comparator";

export async function POST(req: Request) {
  const body = await req.json();
  const { type, recipientIds } = body as {
    type: "test" | "daily_alert" | "weekly_summary";
    recipientIds?: string[];
  };

  const user = await prisma.user.findFirst({ include: { profile: true } });
  if (!user || !user.profile) {
    return NextResponse.json({ error: "No user profile found" }, { status: 404 });
  }

  // Resolve recipients
  const allRecipients = await prisma.notificationRecipient.findMany({
    where: { userId: user.id, active: true, ...(recipientIds?.length ? { id: { in: recipientIds } } : {}) },
  });
  if (allRecipients.length === 0) {
    return NextResponse.json({ error: "No active notification recipients found" }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const results: { email: string; ok: boolean; error?: string }[] = [];

  for (const recipient of allRecipients) {
    let subject: string;
    let html: string;

    if (type === "test") {
      ({ subject, html } = renderTestEmail(appUrl));
    } else if (type === "daily_alert") {
      const latestReport = await prisma.portfolioReport.findFirst({
        orderBy: { createdAt: "desc" },
        include: { recommendations: true, analysisRun: { include: { changeLogs: true } } },
      });
      if (!latestReport) return NextResponse.json({ error: "No report found" }, { status: 404 });

      let alertLevel = (latestReport.analysisRun?.alertLevel ?? "none") as AlertLevel;
      if (!latestReport.analysisRun) {
        const priorReport = await prisma.portfolioReport.findFirst({
          where: { userId: user.id, id: { not: latestReport.id } },
          orderBy: { createdAt: "desc" },
          include: { recommendations: true },
        });
        const changes = compareRecommendations(priorReport?.recommendations || [], latestReport.recommendations);
        const alert = evaluateAlert(changes, latestReport.recommendations, user.profile, null);
        alertLevel = alert.level;
      }

      ({ subject, html } = renderDailyAlertEmail({
        reportId: latestReport.id,
        alertLevel,
        alertReason: latestReport.analysisRun?.alertReason ?? "Manual send",
        changes: (latestReport.analysisRun?.changeLogs ?? []).map((c) => ({
          ticker: c.ticker,
          companyName: c.companyName,
          priorAction: c.priorAction,
          newAction: c.newAction,
          priorRole: (c as any).priorRole ?? null,
          newRole: (c as any).newRole ?? null,
          priorTargetShares: c.priorTargetShares,
          newTargetShares: c.newTargetShares,
          sharesDelta: c.sharesDelta,
          dollarDelta: (c as any).dollarDelta ?? 0,
          priorWeight: c.priorWeight,
          newWeight: c.newWeight,
          positionStatus: (c as any).positionStatus ?? "on_target",
          changed: c.changed,
          evidenceDriven: (c as any).evidenceDriven ?? false,
          changeReason: c.changeReason,
          whyChanged: (c as any).whyChanged ?? null,
        })),
        recommendations: latestReport.recommendations,
        profile: user.profile!,
        runDate: latestReport.createdAt.toISOString().split("T")[0],
        reportSummary: latestReport.summary ?? undefined,
        reportReasoning: latestReport.reasoning ?? undefined,
        appUrl,
      }));
    } else {
      // weekly_summary
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentRuns = await prisma.analysisRun.findMany({
        where: { userId: user.id, status: "complete", startedAt: { gte: sevenDaysAgo } },
        include: { changeLogs: true },
        orderBy: { startedAt: "asc" },
      });
      const latestReport = await prisma.portfolioReport.findFirst({
        orderBy: { createdAt: "desc" },
        include: { recommendations: true },
      });

      const allChanges = recentRuns.flatMap((r) => r.changeLogs).filter((c) => c.changed);

      ({ subject, html } = renderWeeklySummaryEmail({
        weekEnding: new Date().toISOString().split("T")[0],
        runs: recentRuns.map((r) => ({
          date: r.startedAt.toISOString().split("T")[0],
          alertLevel: (r.alertLevel ?? "none") as any,
          alertReason: r.alertReason ?? "",
        })),
        topChanges: allChanges.map((c) => ({
          ticker: c.ticker, companyName: c.companyName, priorAction: c.priorAction,
          newAction: c.newAction, priorRole: (c as any).priorRole ?? null, newRole: (c as any).newRole ?? null,
          priorTargetShares: c.priorTargetShares, newTargetShares: c.newTargetShares,
          sharesDelta: c.sharesDelta, dollarDelta: (c as any).dollarDelta ?? 0,
          priorWeight: c.priorWeight, newWeight: c.newWeight,
          positionStatus: (c as any).positionStatus ?? "on_target",
          changed: c.changed, evidenceDriven: (c as any).evidenceDriven ?? false,
          changeReason: c.changeReason, whyChanged: (c as any).whyChanged ?? null,
        })),
        recommendations: latestReport?.recommendations ?? [],
        profile: user.profile!,
        appUrl,
      }));
    }

    const result = await sendMail({ to: recipient.email, subject, html });
    results.push({ email: recipient.email, ...result });

    await prisma.notificationEvent.create({
      data: {
        userId: user.id,
        type,
        channel: "email",
        recipient: recipient.email,
        subject,
        status: result.ok ? "sent" : "failed",
        errorMessage: result.error,
        isDebug: true,
      },
    });
  }

  return NextResponse.json({ results });
}
