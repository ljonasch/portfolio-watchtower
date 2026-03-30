import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Target, TrendingUp, AlertTriangle, ExternalLink, Zap, Clock, Landmark, Upload } from "lucide-react";
import { SortableHoldingsTable } from "@/components/SortableHoldingsTable";
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
  const report = await prisma.portfolioReport.findUnique({
    where: { id: params.id },
    include: {
      recommendations: true,
      snapshot: {
        include: { holdings: true }
      }
    }
  });

  if (!report) return notFound();

  const totalValue = report.snapshot.holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);

  // Parse JSON fields safely
  const marketContext: MarketContext = (() => {
    try { return JSON.parse(report.marketContext ?? "{}"); }
    catch { return { shortTerm: [], mediumTerm: [], longTerm: [] }; }
  })();

  // Build a fast lookup of holding value by ticker from the actual snapshot
  const holdingValueByTicker = new Map<string, number>();
  for (const h of report.snapshot.holdings) {
    holdingValueByTicker.set(h.ticker, (holdingValueByTicker.get(h.ticker) || 0) + (h.currentValue || 0));
  }

  const recsWithSources = report.recommendations.map(rec => {
    // Always recompute currentWeight from real snapshot data — never trust the stored LLM value
    const holdingValue = holdingValueByTicker.get(rec.ticker) ?? 0;
    const computedCurrentWeight = totalValue > 0 ? Number(((holdingValue / totalValue) * 100).toFixed(2)) : 0;

    return {
      ...rec,
      currentWeight: computedCurrentWeight,
      parsedSources: (() => {
        try { return JSON.parse(rec.reasoningSources ?? "[]") as Source[]; }
        catch { return [] as Source[]; }
      })()
    };
  });

  const horizons = [
    {
      key: "shortTerm" as keyof MarketContext,
      label: "Short-Term",
      sublabel: "Current events & policy",
      icon: Zap,
      color: "text-amber-400",
      border: "border-amber-500/20",
      bg: "bg-amber-500/5",
    },
    {
      key: "mediumTerm" as keyof MarketContext,
      label: "Medium-Term",
      sublabel: "6–18 month outlook",
      icon: Clock,
      color: "text-blue-400",
      border: "border-blue-500/20",
      bg: "bg-blue-500/5",
    },
    {
      key: "longTerm" as keyof MarketContext,
      label: "Long-Term",
      sublabel: "Structural & secular trends",
      icon: Landmark,
      color: "text-purple-400",
      border: "border-purple-500/20",
      bg: "bg-purple-500/5",
    },
  ];

  return (
    <div className="space-y-10 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/" className="p-2 border border-slate-700 rounded-md hover:bg-slate-800 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Portfolio Analysis Report</h1>
          <p className="text-slate-400 mt-1">Generated on {report.createdAt.toLocaleDateString()}</p>
        </div>
      </div>

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

      {/* Market Context Section */}
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
                              {f.sources.map((s, si) => (
                                <SourceChip key={si} source={s} />
                              ))}
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

      {/* Current Holdings Table */}
      {report.snapshot.holdings.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold border-b border-slate-800 pb-2">Starting Portfolio</h2>
          <SortableHoldingsTable 
            holdings={report.snapshot.holdings} 
            totalValue={totalValue} 
          />
        </div>
      )}

      {/* Recommended Holdings Table */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold border-b border-slate-800 pb-2">Recommended Final Holdings</h2>
        <div className="rounded-md border border-slate-800 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Ticker</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium text-right">Curr Shrs</th>
                <th className="px-4 py-3 font-medium text-right">Target Shrs</th>
                <th className="px-4 py-3 font-medium text-right">Δ Shrs</th>
                <th className="px-4 py-3 font-medium text-right">Curr Wgt</th>
                <th className="px-4 py-3 font-medium text-right">Target Wgt</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Thesis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/20">
              {recsWithSources.map(rec => {
                const isNew = rec.currentShares === 0 && rec.action === 'Buy';
                return (
                <tr key={rec.id} className={`hover:bg-slate-800/20 transition-colors ${isNew ? 'bg-green-950/20' : ''}`}>
                  <td className="px-4 py-3 font-bold text-slate-200">
                    {rec.ticker === 'CASH' ? (
                      <span className="text-slate-400">CASH</span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <a
                          href={`https://finance.yahoo.com/quote/${rec.ticker}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors group"
                        >
                          {rec.ticker}
                          <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </a>
                        {isNew && (
                          <span className="text-[9px] font-bold uppercase tracking-wider bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full">NEW</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{rec.companyName}</td>
                  <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{rec.role}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{isNew ? '—' : rec.currentShares}</td>
                  <td className="px-4 py-3 text-right font-bold text-white">{rec.targetShares}</td>
                  <td className={`px-4 py-3 text-right font-medium ${rec.shareDelta > 0 ? 'text-green-400' : rec.shareDelta < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                    {rec.shareDelta > 0 ? '+' : ''}{rec.shareDelta !== 0 ? rec.shareDelta : '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-500">{isNew ? '—' : `${rec.currentWeight.toFixed(1)}%`}</td>
                  <td className="px-4 py-3 text-right font-semibold text-blue-300">{rec.targetWeight.toFixed(1)}%</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-slate-800 ${
                      rec.action === 'Buy' || rec.action === 'Add' ? 'text-green-400' :
                      rec.action === 'Sell' || rec.action === 'Exit' ? 'text-red-400' : 'text-slate-300'
                    }`}>
                      {rec.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 truncate max-w-xs" title={rec.thesisSummary || ''}>{rec.thesisSummary}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Required Changes */}
      <div className="space-y-4">
          <h2 className="text-xl font-bold border-b border-slate-800 pb-2 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500"/> Required Changes
          </h2>
          <div className="bg-slate-900/20 border border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-900/50 text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Ticker</th>
                  <th className="px-4 py-2 font-medium">Action</th>
                  <th className="px-4 py-2 font-medium text-right">Amount</th>
                  <th className="px-4 py-2 font-medium">Reason &amp; Sources</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {recsWithSources.filter(r => r.shareDelta !== 0).length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-4 text-center text-slate-500">No changes required</td></tr>
                ) : recsWithSources.filter(r => r.shareDelta !== 0).map(rec => (
                  <tr key={"change-"+rec.id} className="align-top">
                    <td className="px-4 py-3 font-bold">
                      {rec.ticker === 'CASH' ? (
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
                    <td className={`px-4 py-3 font-medium ${rec.action === 'Buy' || rec.action === 'Add' ? 'text-green-400' : rec.action === 'Hold' ? 'text-slate-400' : 'text-red-400'}`}>{rec.action}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{Math.abs(rec.shareDelta)} shrs</td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-400 leading-relaxed mb-1.5">{rec.detailedReasoning}</p>
                      {rec.parsedSources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {rec.parsedSources.map((s, i) => (
                            <SourceChip key={i} source={s} />
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </div>

      {/* Current vs Target Snapshot — full width below */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold border-b border-slate-800 pb-2">Current vs Target Snapshot</h2>
        <div className="bg-slate-900/20 border border-slate-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-900/50 text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Metric</th>
                  <th className="px-4 py-2 font-medium text-right">Current</th>
                  <th className="px-4 py-2 font-medium text-right">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                <tr>
                  <td className="px-4 py-3 font-medium text-slate-300">Total Value</td>
                  <td className="px-4 py-3 text-right">${totalValue.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-blue-300">${totalValue.toLocaleString()}</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-slate-300">Positions</td>
                  <td className="px-4 py-3 text-right">{report.snapshot.holdings.length}</td>
                  <td className="px-4 py-3 text-right">{recsWithSources.filter(r => r.targetShares > 0).length}</td>
                </tr>
              </tbody>
            </table>
          </div>
      </div>

      {/* Step 5: Upload updated screenshot */}
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

