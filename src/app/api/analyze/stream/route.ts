/**
 * POST /api/analyze/stream
 * Server-Sent Events (SSE) endpoint for the orchestrated analysis pipeline.
 * Emits real-time progress events while the single primary-model path runs.
 */

import { runFullAnalysis } from "@/lib/research/analysis-orchestrator";
import type { ProgressEvent } from "@/lib/research/progress-events";

export const maxDuration = 300; // 5-minute Vercel timeout

export async function POST(req: Request): Promise<Response> {
  const { snapshotId, customPrompt } = await req.json().catch(() => ({ snapshotId: "", customPrompt: "" }));
  if (!snapshotId) {
    return new Response(JSON.stringify({ error: "Missing snapshotId" }), { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (event: ProgressEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch { /* stream may be closed */ }
      };

      try {
        await runFullAnalysis(snapshotId, customPrompt, enqueue);
      } catch (err: any) {
        enqueue({ type: "error", message: err?.message ?? "Unknown error" });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
