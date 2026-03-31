import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Target, TrendingUp, AlertTriangle, ExternalLink,
  Zap, Clock, Landmark, Upload, ShieldCheck, ShieldAlert,
  BarChart3, Layers,
} from "lucide-react";
import { SortableHoldingsTable } from "@/components/SortableHoldingsTable";
import { SortableRecommendationsTable } from "@/components/SortableRecommendationsTable";
import type { MarketContext, Source } from "@/lib/analyzer";

function SourceChip({ source }: { source: Source }) {
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 text-blue-400 hover:text-blue-300 border border-slate-700 rounded-full px-2 py-0.5 transition-colors"
    >
      {source.title}
      <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
    </a>
  );
}

export default async function ReportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const [report, allConvictions] = await Promise.all([
    prisma.portfolioReport.findUnique({
      where: { id: params.id },
      include: {
        recommendations: { orderBy: { targetWeight: "desc" } },
        snapshot: { include: { holdings: true } },
        analysisRun: true,
      },
    }),
    prisma.userConviction.findMany({ where: { active: true } }),
  ]);

  if (!report) return notFound();

  const totalValue = report.snapshot.holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);

  const marketContext: MarketContext = (() => {
    try { return JSON.parse(report.marketContext ?? "{}"); }
    catch { return { shortTerm: [], mediumTerm: [], longTerm: [] }; }
  })();

  // Portfolio math summary (MVP 3)
  const portfolioMath = (() => {
    try { return JSON.parse((report.analysisRun as any)?.portfolioMathSummary ?? "{}"); }
    catch { return {}; }
  })();

  // Source quality summary (MVP 3)
  const sourceQuality = (() => {
    try { return JSON.parse((report.analysisRun as any)?.sourceQualitySummary ?? "{}"); }
    catch { return {}; }
  })();

  // Build holding value map for current weights
  const holdingValueByTicker = new Map<string, number>();
  for (const h of report.snapshot.holdings) {
    holdingValueByTicker.set(h.ticker, (holdingValueByTicker.get(h.ticker) || 0) + (h.currentValue || 0));
  }

  // Enrich recommendations with parsed sources + correct current weight
  const recsEnriched = report.recommendations.map(rec => {
    const holdingValue = holdingValueByTicker.get(rec.ticker) ?? 0;
    const computedCurrentWeight = totalValue > 0
      ? Number(((holdingValue / totalValue) * 100).toFixed(2))
      : 0;
    return {
      ...rec,
      currentWeight: computedCurrentWeight,
      parsedSources: (() => {
        try { return JSON.parse(rec.reasoningSources ?? "[]") as Source[]; }
        catch { return [] as Source[]; }
      })(),
    };
  });

  // Convictions indexed by ticker
  const convictionsByTicker = new Map(allConvictions.map(c => [c.ticker, c]));

  // Active convictions that apply to current recommendations
  const activeConvictionsForReport = recsEnriched
    .filter(r => convictionsByTicker.has(r.ticker))
    .map(r => ({
      ticker: r.ticker,
      rationale: convictionsByTicker.get(r.ticker)!.rationale,
    }));

  // Tickers that have changed this run
  const changedRecs = recsEnriched.filter(r =>
    r.shareDelta !== 0 || (r.action !== "Hold" && r.action !== "hold")
  );

  // Market context horizons config
  const horizons = [
    { key: "shortTerm" as keyof MarketContext, label: "Short-Term", sublabel: "Current events & policy", icon: Zap, color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/5" },
    { key: "mediumTerm" as keyof MarketContext, label: "Medium-Term", sublabel: "6–18 month outlook", icon: Clock, color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/5" },
    { key: "longTerm" as keyof MarketContext, label: "Long-Term", sublabel: "Structural & secular trends", icon: Landmark, color: "text-purple-400", border: "border-purple-500/20", bg: "bg-purple-500/5" },
  ];

  // Serialize conviction data for client component
  const convictionRows = allConvictions.map(c => ({
    ticker: c.ticker,
    rationale: c.rationale,
    id: c.id,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));

  return (
    <div className="space-y-10 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/" className="p-2 border border-slate-700 rounded-md hover:bg-slate-800 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">Portfolio Analysis Report</h1>
          <p className="text-slate-400 mt-1">Generated on {report.createdAt.toLocaleDateString()}</p>
        </div>
        {/* Source quality pill */}
        {sourceQuality.overallQuality && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium ${
            sourceQuality.overallQuality === "high"
              ? "bg-green-500/10 border-green-500/25 text-green-400"
              : sourceQuality.overallQuality === "medium"
              ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
              : "bg-red-500/10 border-red-500/25 text-red-400"
          }`}>
            <ShieldCheck className="w-3.5 h-3.5" />
            Source quality: {sourceQuality.overallQuality}
            {sourceQuality.high != null && (
              <span className="text-slate-500 ml-1">
                ({sourceQuality.high}H / {sourceQuality.medium}M / {sourceQuality.low}L)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Active Convictions Banner */}
      {activeConvictionsForReport.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-500/25 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldAlert className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-amber-300">
              {activeConvictionsForReport.length} Active Conviction Note{activeConvictionsForReport.length > 1 ? "s" : ""} — Injected into this analysis
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {activeConvictionsForReport.map(c => (
              <div key={c.ticker} className="flex items-start gap-2 bg-amber-950/20 border border-amber-500/15 rounded-lg px-3 py-2">
                <span className="font-bold text-amber-400 text-xs min-w-[40px]">{c.ticker}</span>
                <p className="text-xs text-slate-400 leading-relaxed italic">"{c.rationale}"</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            The AI acknowledged each conviction above and may have provided counterpoints in the recommendations below.
          </p>
        </div>
      )}

      {/* Summary + Reasoning */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 space-y-3">
          <h3 className="font-semibold text-lg flex items-center gap-2 text-slate-200">
            <Target className="w-5 h-5 text-blue-400" /> Executive Summary
          </h3>
          <p className="text-slate-300 leading-relaxed text-sm">{report.summary}</p>
        </div>
        <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 space-y-3">
          <h3 className="font-semibold text-lg flex items-center gap-2 text-slate-200">
            <TrendingUp className="w-5 h-5 text-indigo-400" /> Strategic Reasoning
          </h3>
          <p className="text-slate-300 leading-relaxed text-sm">{report.reasoning}</p>
        </div>
      </div>

      {/* Portfolio Risk Summary (MVP 3) */}
      {(portfolioMath.concentrationWarnings?.length > 0 || portfolioMath.overlapWarnings?.length > 0 || portfolioMath.speculativeExposurePct != null) && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold border-b border-slate-800 pb-2 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-orange-400" /> Portfolio Risk Summary
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {portfolioMath.speculativeExposurePct != null && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Speculative Exposure</p>
                <p className={`text-2xl font-bold ${portfolioMath.speculativeExposurePct > 20 ? "text-orange-400" : "text-slate-200"}`}>
                  {portfolioMath.speculativeExposurePct?.toFixed(1)}%
                </p>
              </div>
            )}
            {portfolioMath.cashPct != null && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Cash</p>
                <p className="text-2xl font-bold text-slate-200">{portfolioMath.cashPct?.toFixed(1)}%</p>
              </div>
            )}
            {portfolioMath.holdingCount != null && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Holdings</p>
                <p className="text-2xl font-bold text-slate-200">{portfolioMath.holdingCount}</p>
              </div>
            )}
            {portfolioMath.weightSumCheck != null && (
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">Weight Sum</p>
                <p className={`text-2xl font-bold ${Math.abs(portfolioMath.weightSumCheck - 100) < 1 ? "text-green-400" : "text-red-400"}`}>
                  {portfolioMath.weightSumCheck?.toFixed(1)}%
                </p>
              </div>
            )}
          </div>
          {/* Concentration warnings */}
          {portfolioMath.concentrationWarnings?.length > 0 && (
            <div className="space-y-2">
              {portfolioMath.concentrationWarnings.map((w: any, i: number) => (
                <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                  w.severity === "breach"
                    ? "bg-red-950/20 border-red-500/25 text-red-300"
                    : "bg-amber-950/20 border-amber-500/25 text-amber-300"
                }`}>
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {w.ticker} is at {w.currentWeight?.toFixed(1)}% — {w.severity === "breach" ? "exceeds" : "approaching"} the {w.cap}% cap
                </div>
              ))}
            </div>
          )}
          {/* Overlap warnings */}
          {portfolioMath.overlapWarnings?.length > 0 && (
            <div className="space-y-2">
              {portfolioMath.overlapWarnings.map((w: any, i: number) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-blue-950/20 border-blue-500/25 text-xs text-blue-300">
                  <Layers className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>Sector overlap: <strong>{w.theme}</strong> — {w.tickers.join(", ")} combined at {w.combinedWeight?.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Market Context */}
      {(marketContext.shortTerm?.length > 0 || marketContext.mediumTerm?.length > 0 || marketContext.longTerm?.length > 0) && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold border-b border-slate-800 pb-2">Market Context</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {horizons.map(({ key, label, sublabel, icon: Icon, color, border, bg }) => {
              const factors = marketContext[key] ?? [];
              return (
                <div key={key} className={`rounded-xl border ${border} ${bg} p-4 space-y-4`}>
                  <div className="flex items-center gap-2">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <div>
                      <p className={`text-sm font-semibold ${color}`}>{label}</p>
                      <p className="text-xs text-slate-500">{sublabel}</p>
                    </div>
                  </div>
                  {factors.length === 0 ? (
                    <p className="text-xs text-slate-600 italic">No factors identified.</p>
                  ) : (
                    <ul className="space-y-4">
                      {factors.map((f, i) => (
                        <li key={i} className="space-y-1.5">
                          <p className="text-sm font-medium text-slate-200">{f.factor}</p>
                          <p className="text-xs text-slate-400 leading-relaxed">{f.explanation}</p>
                          {f.sources?.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {f.sources.map((s, si) => <SourceChip key={si} source={s} />)}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Starting Portfolio */}
      {report.snapshot.holdings.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold border-b border-slate-800 pb-2">Starting Portfolio</h2>
          <SortableHoldingsTable holdings={report.snapshot.holdings} totalValue={totalValue} />
        </div>
      )}

      {/* Recommended Final Holdings — MVP 3 Table */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold border-b border-slate-800 pb-2">Recommended Final Holdings</h2>
        <SortableRecommendationsTable
          recommendations={recsEnriched.map(r => ({
            id: r.id,
            ticker: r.ticker,
            companyName: r.companyName,
            role: r.role,
            targetWeight: r.targetWeight,
            targetShares: r.targetShares,
            shareDelta: r.shareDelta,
            dollarDelta: (r as any).dollarDelta ?? null,
            currentWeight: r.currentWeight,
            currentShares: r.currentShares,
            acceptableRangeLow: (r as any).acceptableRangeLow ?? null,
            acceptableRangeHigh: (r as any).acceptableRangeHigh ?? null,
            action: r.action,
            confidence: r.confidence,
            positionStatus: (r as any).positionStatus ?? null,
            evidenceQuality: (r as any).evidenceQuality ?? null,
            whyChanged: (r as any).whyChanged ?? null,
            thesisSummary: r.thesisSummary,
            detailedReasoning: r.detailedReasoning,
            valueDelta: r.valueDelta,
          }))}
          convictions={convictionRows}
        />
      </div>

      {/* Required Changes */}
      {changedRecs.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold border-b border-slate-800 pb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> Required Changes
          </h2>
          <div className="bg-slate-900/20 border border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-900/50 text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Ticker</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium text-right">Δ Shares</th>
                  <th className="px-4 py-2 font-medium text-right">Δ Dollars</th>
                  <th className="px-4 py-2 font-medium">Reasoning & Sources</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {changedRecs.map(rec => (
                  <tr key={"change-" + rec.id} className="align-top">
                    <td className="px-4 py-3 font-bold">
                      {rec.ticker === "CASH" ? (
                        <span>{rec.ticker}</span>
                      ) : (
                        <a
                          href={`https://finance.yahoo.com/quote/${rec.ticker}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors group"
                        >
                          {rec.ticker}
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                      )}
                    </td>
                    <td className={`px-4 py-3 font-medium ${
                      rec.action === "Buy" || rec.action === "Add" ? "text-green-400"
                      : rec.action === "Hold" ? "text-slate-400" : "text-red-400"
                    }`}>
                      {rec.action}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${
                      rec.shareDelta > 0 ? "text-green-400" : rec.shareDelta < 0 ? "text-red-400" : "text-slate-500"
                    }`}>
                      {rec.shareDelta === 0 ? "—" : `${rec.shareDelta > 0 ? "+" : ""}${rec.shareDelta} shrs`}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${
                      ((rec as any).dollarDelta ?? 0) > 0 ? "text-green-400" : ((rec as any).dollarDelta ?? 0) < 0 ? "text-red-400" : "text-slate-500"
                    }`}>
                      {!(rec as any).dollarDelta || (rec as any).dollarDelta === 0 ? "—" : (
                        `${(rec as any).dollarDelta > 0 ? "+" : ""}$${Math.abs((rec as any).dollarDelta).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-400 leading-relaxed mb-1.5">{rec.detailedReasoning}</p>
                      {rec.parsedSources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {rec.parsedSources.map((s, i) => <SourceChip key={i} source={s} />)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upload Updated Screenshot */}
      <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
          <Upload className="w-5 h-5 text-blue-400" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-slate-100">Step 5 · Upload Updated Screenshot</p>
          <p className="text-sm text-slate-400 mt-0.5">
            After making your changes, upload a fresh screenshot to record your updated holdings for the next analysis cycle.
          </p>
        </div>
        <Link
          href="/upload?mode=update"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors flex-shrink-0"
        >
          <Upload className="w-4 h-4" /> Upload Update
        </Link>
      </div>
    </div>
  );
}
