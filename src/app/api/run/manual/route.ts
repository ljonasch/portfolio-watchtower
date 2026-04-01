import { prisma } from "@/lib/prisma";
import { runDailyCheck } from "@/lib/scheduler";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await prisma.user.findFirst({ include: { profile: true } });
  if (!user || !user.profile) {
    return NextResponse.json({ error: "No user profile found" }, { status: 404 });
  }

  // T4.2 — Duplicate run guard: reject if a run is already in progress
  const inFlightRun = await prisma.analysisRun.findFirst({
    where: { userId: user.id, status: "running" },
    orderBy: { startedAt: "desc" },
  });
  if (inFlightRun) {
    return NextResponse.json(
      { error: "An analysis run is already in progress", runId: inFlightRun.id },
      { status: 409 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const onProgress = (step: number) => send({ step });
        const result = await runDailyCheck({
          triggerType: "manual",
          triggeredBy: `${user.name ?? "User"} (manual debug trigger)`,
          onProgress,
        });
        send({ done: true, ...result });
      } catch (err: any) {
        send({ error: err.message ?? "Run failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
