import { prisma } from "@/lib/prisma";
import { generatePortfolioReport } from "@/lib/analyzer";

export const maxDuration = 120; // allow up to 2 minutes for long analyses

export async function POST(req: Request) {
  const { snapshotId, customPrompt } = await req.json();

  const snapshot = await prisma.portfolioSnapshot.findUnique({
    where: { id: snapshotId },
    include: { holdings: true },
  });
  if (!snapshot) {
    return new Response(JSON.stringify({ error: "Snapshot not found" }), { status: 404 });
  }

  const user = await prisma.user.findFirst({ include: { profile: true } });
  const profile = user?.profile;
  if (!profile) {
    return new Response(JSON.stringify({ error: "No profile found" }), { status: 404 });
  }

  const [settingsObj, convictions] = await Promise.all([
    prisma.appSettings.findFirst({ where: { key: "portfolio_config" } }),
    prisma.userConviction.findMany({
      where: { userId: user.id, active: true },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
  ]);
  const settings = settingsObj ? JSON.parse(settingsObj.value) : {};
  const convictionInputs = convictions.map(c => ({
    ticker: c.ticker,
    rationale: c.rationale,
    messages: c.messages.map(m => ({
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  }));

  // Load prior recommendations for convergence anchor
  const latestReport = await prisma.portfolioReport.findFirst({
    orderBy: { createdAt: "desc" },
    include: { recommendations: true },
  });

  // Stream SSE events so the client can advance steps as each phase actually completes
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const onProgress = (step: number) => send({ step });

        const reportData = await generatePortfolioReport(
          snapshot.holdings,
          profile,
          settings,
          onProgress,
          latestReport?.recommendations,
          customPrompt,
          convictionInputs
        );

        // Deduplicate by ticker
        const seenTickers = new Set<string>();
        const deduped = reportData.recommendations.filter(r => {
          if (seenTickers.has(r.ticker)) return false;
          seenTickers.add(r.ticker);
          return true;
        });

        // Extract metadata attached by analyzer
        const meta = (reportData as any)._meta ?? {};

        const report = await prisma.portfolioReport.create({
          data: {
            snapshotId: snapshot.id,
            userId: user.id,
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
                dollarDelta: r.dollarDelta,
                currentWeight: r.currentWeight,
                targetWeight: r.targetWeight,
                acceptableRangeLow: r.acceptableRangeLow,
                acceptableRangeHigh: r.acceptableRangeHigh,
                valueDelta: r.valueDelta,
                action: r.action,
                confidence: r.confidence,
                positionStatus: r.positionStatus,
                evidenceQuality: r.evidenceQuality,
                thesisSummary: r.thesisSummary,
                detailedReasoning: r.detailedReasoning,
                whyChanged: r.whyChanged,
                reasoningSources: JSON.stringify(r.reasoningSources ?? []),
              })),
            },
          },
        });

        // ── Write AI response messages for each active conviction ──────────────
        // For each ticker with a conviction, extract the AI's response from
        // detailedReasoning and persist it as a ConvictionMessage so it appears
        // in the dialogue thread on the report page.
        if (convictions.length > 0) {
          const recByTicker = new Map(deduped.map(r => [r.ticker, r]));
          await Promise.all(
            convictions.map(async (conviction) => {
              const rec = recByTicker.get(conviction.ticker);
              if (!rec?.detailedReasoning) return;
              await (prisma as any).convictionMessage.create({
                data: {
                  convictionId: conviction.id,
                  role: "ai",
                  content: rec.detailedReasoning,
                  analysisRunId: report.id,
                },
              });
            })
          );
        }

        send({ step: 4, reportId: report.id });

      } catch (err: any) {
        send({ error: err.message ?? "Analysis failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
