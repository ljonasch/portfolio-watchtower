import { prisma } from "@/lib/prisma";
import { ALERT_COLORS, ALERT_LABELS } from "@/lib/alerts";
import Link from "next/link";
import { ArrowLeft, Clock, Activity, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const reports = await prisma.portfolioReport.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      analysisRun: true,
      snapshot: {
        include: {
          holdings: true,
        },
      },
    },
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="inline-flex items-center text-sm text-slate-400 hover:text-slate-200 mb-2 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent">
            Report History
          </h1>
          <p className="text-slate-400 mt-1">A running ledger of all your past Portfolio Analysis runs.</p>
        </div>
      </div>

      <div className="space-y-4">
        {reports.length === 0 ? (
          <div className="text-center py-12 rounded-xl border border-dashed border-slate-800 bg-slate-900/50">
            <Clock className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-300">No history yet</h3>
            <p className="text-sm text-slate-500">Run an analysis to generate your first report.</p>
          </div>
        ) : (
          reports.map((report) => {
            const dateStr = report.createdAt.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            });
            const holdingsCount = report.snapshot?.holdings?.length ?? 0;
            const alertLevel = report.analysisRun?.alertLevel ?? "none";
            const color = ALERT_COLORS[alertLevel as keyof typeof ALERT_COLORS] || "#64748b";
            const label = ALERT_LABELS[alertLevel as keyof typeof ALERT_LABELS] || "Unknown";

            return (
              <Link
                href={`/report/${report.id}`}
                key={report.id}
                className="group block rounded-xl border border-slate-800 bg-slate-900/60 p-5 hover:bg-slate-800/80 hover:border-slate-700 transition-all"
              >
                <div className="flex flex-col sm:flex-row gap-4 justify-between items-start">
                  
                  {/* Left Side: Context */}
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
                        <Clock className="w-4 h-4 text-slate-500" />
                        {dateStr}
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700 hidden sm:inline-block">
                        {report.analysisRun?.triggerType || "manual"} check
                      </span>
                    </div>

                    <p className="text-sm text-slate-400 line-clamp-2 pr-4 leading-relaxed">
                      {report.summary || "No AI summary available for this legacy report."}
                    </p>
                    
                    <div className="flex items-center gap-4 text-xs font-medium mt-3">
                      <div className="flex items-center gap-1.5 text-slate-500">
                        <Activity className="w-3.5 h-3.5" />
                        {holdingsCount} Position{holdingsCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>

                  {/* Right Side: Alert status & Action */}
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between w-full sm:w-auto mt-2 sm:mt-0 gap-3">
                    <div 
                      className="px-2.5 py-1 rounded-full text-xs font-bold border whitespace-nowrap"
                      style={{ color, backgroundColor: `${color}15`, borderColor: `${color}40` }}
                    >
                      {label}
                    </div>
                    
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      View Report <ArrowLeft className="w-4 h-4 rotate-180" />
                    </div>
                  </div>
                  
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
