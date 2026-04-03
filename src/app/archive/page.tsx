import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Archive, BarChart2, Calendar, ChevronRight, FileText, Package } from "lucide-react";

export const dynamic = "force-dynamic";

function fmt(d: Date | string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtVal(n: number) {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function parseReportViewModel(value: string) {
  try {
    return JSON.parse(value) as {
      summaryMessage?: string;
      recommendations?: Array<{ id?: string; ticker?: string; action?: string; thesisSummary?: string }>;
    };
  } catch {
    return { summaryMessage: null, recommendations: [] };
  }
}

export default async function ArchivePage() {
  const user = await (prisma as any).user.findFirst();
  if (!user) return <div>No user found.</div>;

  const archivedBundles = await prisma.analysisBundle.findMany({
    where: {
      userId: user.id,
      bundleScope: "PRIMARY_PORTFOLIO",
      archivedAt: { not: null },
    },
    orderBy: { archivedAt: "desc" },
    select: {
      id: true,
      archivedAt: true,
      finalizedAt: true,
      bundleOutcome: true,
      reportViewModelJson: true,
    },
  });

  const snapshots = await (prisma as any).portfolioSnapshot.findMany({
    where: { userId: user.id, archivedAt: { not: null } },
    orderBy: { archivedAt: "desc" },
    include: {
      holdings: { orderBy: { currentValue: "desc" } },
      reports: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { recommendations: { orderBy: { currentWeight: "desc" }, take: 8 } },
      },
    },
  });

  // Group snapshots into archive batches by archivedAt ISO timestamp
  const batchMap = new Map<string, typeof snapshots>();
  const batchMeta = new Map<string, { archivedAt: Date; label: string | null }>();
  for (const snap of snapshots) {
    const key = (snap.archivedAt as Date).toISOString();
    if (!batchMap.has(key)) {
      batchMap.set(key, []);
      batchMeta.set(key, { archivedAt: snap.archivedAt as Date, label: (snap as any).archiveLabel || null });
    }
    batchMap.get(key)!.push(snap);
  }

  const batches = Array.from(batchMap.entries()).map(([key, snaps]) => ({
    key,
    ...batchMeta.get(key)!,
    snapshots: snaps,
  }));

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Archive className="w-7 h-7 text-indigo-400" />
          Portfolio Archives
        </h1>
        <p className="text-slate-400 mt-2 text-sm">
          Preserved snapshots of your portfolio at specific points in time, along with their AI analysis reports.
        </p>
      </div>

      {archivedBundles.length > 0 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2 text-slate-100">
              <FileText className="w-5 h-5 text-indigo-400" />
              Archived Reports
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Bundle-backed reports archived from the report page remain available here for direct access.
            </p>
          </div>
          <div className="space-y-3">
            {archivedBundles.map((bundle) => {
              const reportViewModel = parseReportViewModel(bundle.reportViewModelJson);
              const topRecommendations = Array.isArray(reportViewModel.recommendations)
                ? reportViewModel.recommendations.slice(0, 3)
                : [];

              return (
                <Link
                  key={bundle.id}
                  href={`/report/${bundle.id}`}
                  className="block rounded-2xl border border-slate-800 bg-slate-900/30 p-5 transition-colors hover:border-slate-700 hover:bg-slate-900/50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full border border-slate-700 bg-slate-900/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                          {bundle.bundleOutcome}
                        </span>
                        <span className="text-xs text-slate-500">
                          Archived {bundle.archivedAt ? fmt(bundle.archivedAt) : "Unknown date"}
                        </span>
                      </div>
                      <p className="text-sm text-slate-300 leading-relaxed line-clamp-2">
                        {reportViewModel.summaryMessage || "Archived bundle-backed report"}
                      </p>
                      {topRecommendations.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {topRecommendations.map((rec, index) => (
                            <span
                              key={rec.id ?? `${bundle.id}-rec-${index}`}
                              className="rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-400"
                            >
                              {rec.ticker ?? "UNKNOWN"} {rec.action ?? ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-slate-500">Finalized</p>
                      <p className="text-sm font-semibold text-slate-200">{fmt(bundle.finalizedAt)}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {batches.length === 0 && archivedBundles.length === 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center space-y-3">
          <Package className="w-10 h-10 text-slate-600 mx-auto" />
          <p className="text-slate-400 font-medium">No archives yet</p>
          <p className="text-slate-600 text-sm">Use the <strong>Archive Current Portfolio</strong> button in Settings to preserve a snapshot.</p>
          <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 mt-2">
            Go to Settings <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {batches.map(batch => {
        // Compute totals across all snapshots in this batch
        const allHoldings = batch.snapshots.flatMap((s: any) => s.holdings);
        const totalValue = allHoldings.reduce((sum: number, h: any) => sum + (h.currentValue || 0), 0);
        const nonCash = allHoldings.filter((h: any) => !h.isCash);
        const latestReport = batch.snapshots.flatMap((s: any) => s.reports)[0] ?? null;

        return (
          <div key={batch.key} className="rounded-2xl border border-slate-800 bg-slate-900/30 overflow-hidden shadow-xl">
            {/* Batch header */}
            <div className="bg-gradient-to-r from-indigo-950/60 to-slate-900/60 border-b border-indigo-900/30 px-6 py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
                  <Archive className="w-4.5 h-4.5 text-indigo-400" />
                </div>
                <div>
                  <p className="font-semibold text-slate-100">
                    {batch.label ?? "Portfolio Snapshot"}
                  </p>
                  <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
                    <Calendar className="w-3 h-3" />
                    Archived {fmt(batch.archivedAt)}
                    <span className="text-slate-700">·</span>
                    {batch.snapshots.length} snapshot{batch.snapshots.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-lg font-bold text-slate-100">{fmtVal(totalValue)}</p>
                <p className="text-xs text-slate-500">{nonCash.length} position{nonCash.length !== 1 ? "s" : ""}</p>
              </div>
            </div>

            {/* Top holdings */}
            {nonCash.length > 0 && (
              <div className="px-6 py-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5" /> Holdings
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {nonCash.sort((a: any, b: any) => (b.currentValue || 0) - (a.currentValue || 0)).slice(0, 8).map((h: any) => {
                    const pct = totalValue > 0 ? ((h.currentValue || 0) / totalValue * 100) : 0;
                    return (
                      <div key={h.id} className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold text-sm text-slate-100">{h.ticker}</span>
                          <span className="text-xs text-slate-400 font-semibold">{pct.toFixed(1)}%</span>
                        </div>
                        <div className="h-1 bg-slate-700/60 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500/60 rounded-full" style={{ width: `${Math.min(pct * 3, 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">{fmtVal(h.currentValue || 0)}</p>
                      </div>
                    );
                  })}
                  {nonCash.length > 8 && (
                    <div className="bg-slate-800/20 border border-slate-700/30 rounded-xl px-3 py-2.5 flex items-center justify-center">
                      <span className="text-xs text-slate-500">+{nonCash.length - 8} more</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Top recommendations from last report */}
            {latestReport && latestReport.recommendations.length > 0 && (
              <div className="px-6 pb-4 border-t border-slate-800/60 pt-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Last Analysis · {fmt(latestReport.createdAt)}
                </p>
                <div className="space-y-1.5">
                  {latestReport.recommendations.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-slate-300 w-12 flex-shrink-0">{r.ticker}</span>
                      <span className={`px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${
                        r.action === "Buy"  ? "bg-emerald-900/40 text-emerald-400" :
                        r.action === "Sell" ? "bg-red-900/40 text-red-400" :
                        r.action === "Trim" ? "bg-amber-900/30 text-amber-400" :
                                              "bg-slate-800 text-slate-400"
                      }`}>{r.action}</span>
                      <span className="text-slate-500 flex-1 truncate">{r.thesisSummary?.slice(0, 80)}</span>
                      <Link
                        href={`/report/${latestReport.id}`}
                        className="flex-shrink-0 text-indigo-400 hover:text-indigo-300 underline"
                      >
                        Full report →
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
