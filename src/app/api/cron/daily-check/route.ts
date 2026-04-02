import { prisma } from "@/lib/prisma";
import { runDailyCheck } from "@/lib/services";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export const maxDuration = 300;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Idempotency: skip if a run already completed successfully today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const alreadyRan = await prisma.analysisRun.findFirst({
    where: { triggerType: "scheduled", status: "complete", startedAt: { gte: today } },
  });
  if (alreadyRan) {
    return NextResponse.json({ skipped: true, reason: "Already ran today", runId: alreadyRan.id });
  }

  try {
    const result = await runDailyCheck({ triggerType: "scheduled", triggeredBy: "cron endpoint" });
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
