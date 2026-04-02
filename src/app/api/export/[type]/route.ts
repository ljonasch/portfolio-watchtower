import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getExportPayload } from "@/lib/read-models";

export const dynamic = "force-dynamic";

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const head = headers.join(",");
  const body = rows.map((r) => headers.map((h) => escapeCSV(r[h])).join(",")).join("\n");
  return head + "\n" + body;
}

export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const user = await prisma.user.findFirst();
  if (!user) return NextResponse.json({ error: "No user" }, { status: 404 });
  const url = new URL(req.url);
  const bundleId = url.searchParams.get("bundleId");

  let csv = "";
  let filename = "";

  if (type === "runs") {
    const runs = await prisma.analysisRun.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "desc" },
    });
    filename = "analysis-run-history.csv";
    csv = toCSV(
      ["id", "triggerType", "triggeredBy", "status", "alertLevel", "alertReason", "startedAt", "completedAt"],
      runs.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? "" }))
    );
  } else if (type === "changes") {
    const changes = await prisma.recommendationChangeLog.findMany({
      where: { run: { userId: user.id } },
      orderBy: { createdAt: "desc" },
      include: { run: { select: { startedAt: true, triggerType: true } } },
    });
    filename = "recommendation-changes.csv";
    csv = toCSV(
      ["runDate", "ticker", "companyName", "priorAction", "newAction", "priorTargetShares", "newTargetShares", "sharesDelta", "priorWeight", "newWeight", "changed", "changeReason"],
      changes.map((c) => ({ ...c, runDate: c.run.startedAt.toISOString().split("T")[0], createdAt: undefined, run: undefined }))
    );
  } else if (type === "alerts") {
    const runs = await prisma.analysisRun.findMany({
      where: { userId: user.id, alertLevel: { not: null } },
      orderBy: { startedAt: "desc" },
    });
    filename = "alert-history.csv";
    csv = toCSV(
      ["date", "triggerType", "alertLevel", "alertReason", "status"],
      runs.map((r) => ({ date: r.startedAt.toISOString().split("T")[0], triggerType: r.triggerType, alertLevel: r.alertLevel, alertReason: r.alertReason, status: r.status }))
    );
  } else if (type === "notifications") {
    const events = await prisma.notificationEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    filename = "notification-history.csv";
    csv = toCSV(
      ["createdAt", "type", "channel", "recipient", "subject", "status", "isDebug", "errorMessage"],
      events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))
    );
  } else if (type === "holdings") {
    const snapshots = await prisma.portfolioSnapshot.findMany({
      where: { userId: user.id },
      include: { holdings: true },
      orderBy: { createdAt: "desc" },
    });
    filename = "holdings-history.csv";
    const rows = snapshots.flatMap((s) =>
      s.holdings.map((h) => ({
        snapshotDate: s.createdAt.toISOString().split("T")[0],
        snapshotId: s.id,
        ticker: h.ticker,
        companyName: h.companyName,
        shares: h.shares,
        currentPrice: h.currentPrice,
        currentValue: h.currentValue,
        isCash: h.isCash,
      }))
    );
    csv = toCSV(["snapshotDate", "snapshotId", "ticker", "companyName", "shares", "currentPrice", "currentValue", "isCash"], rows);
  } else if (type === "report") {
    const bundleExport = await getExportPayload(user.id, bundleId);
    if (bundleExport.source === "bundle") {
      filename = `bundle-${bundleExport.bundle.id}.json`;
      return NextResponse.json(bundleExport.payload, {
        headers: {
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json({ error: "No bundle export payload found" }, { status: 404 });
  } else {
    return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
