import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Target, TrendingUp, AlertTriangle, ExternalLink,
  Zap, Clock, Landmark, Upload, ShieldCheck, ShieldAlert,
  BarChart3, Layers, CheckCircle2, XCircle
} from "lucide-react";
import { SortableHoldingsTable } from "@/components/SortableHoldingsTable";
import { SortableRecommendationsTable } from "@/components/SortableRecommendationsTable";
import { ConvictionThread } from "@/components/ConvictionThread";
import type { ConvictionThreadData } from "@/components/ConvictionThread";
import type { MarketContext } from "@/lib/analyzer";
import { projectRecommendation } from "@/lib/view-models";
import type { SourceViewModel } from "@/lib/view-models/types";
import type { DiagnosticsStepContract } from "@/lib/contracts";
import { getRequestedReportArtifact, getRunDiagnostics } from "@/lib/read-models";

function SourceChip({ source }: { source: SourceViewModel }) {
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

function VerRow({ label, value }: { label: string, value: any }) {
  if (value === undefined) {
    return (
      <details className="p-3 rounded-xl border transition-colors group cursor-pointer bg-slate-900/40 border-slate-800/30 hover:border-slate-700/50">
        <summary className="flex items-center justify-between list-none focus:outline-none">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</span>
            <div className="text-sm font-semibold text-slate-400">Not Available</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-500 opacity-0 transition-opacity hidden sm:block">Legacy Run</span>
          </div>
        </summary>
      </details>
    );
  }

  // Gracefully handle strings vs new objects containing {status, rationale, ...}
  const payload = typeof value === "object" && value !== null ? value : { status: typeof value === "string" ? value : false };
  
  let ok = payload.status !== false;
  let text = typeof payload.status === "string" ? payload.status : null;
  if (typeof payload.status === "string" && payload.status.startsWith("!")) {
    ok = false;
    text = payload.status.substring(1);
  }

  return (
    <details className={`p-3 rounded-xl border transition-colors group cursor-pointer ${
      ok 
        ? "bg-slate-900/40 border-emerald-900/30 hover:border-emerald-700/50" 
        : "bg-slate-900/40 border-red-900/30 hover:border-red-700/50"
    }`}>
      <summary className="flex items-center justify-between list-none focus:outline-none">
        <div className="flex flex-col gap-1">
          <span className={`text-[10px] uppercase tracking-wider font-semibold ${
            ok ? "text-slate-400" : "text-slate-500"
          }`}>
            {label}
          </span>
          <div className={`text-sm font-semibold ${ok ? "text-slate-200" : "text-red-400"}`}>
            {text ? text : (ok ? "Verified" : "Failed")}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block">Expand</span>
          {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />}
        </div>
      </summary>
      
      <div className="mt-3 pt-3 border-t border-slate-800/50 text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
        {payload.rationale || (typeof value === "object" ? JSON.stringify(value, null, 2) : "System step executed seamlessly. No extensive diagnostic logs generated.")}
      </div>
    </details>
  );
}

function formatDiagnosticValue(value: unknown): string {
  if (value === null || value === undefined) return "Not available";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function StepStatusPill({ status }: { status: DiagnosticsStepContract["status"] }) {
  const style = status === "ok"
    ? "bg-emerald-500/10 border-emerald-500/25 text-emerald-300"
    : status === "warning"
      ? "bg-amber-500/10 border-amber-500/25 text-amber-300"
      : status === "error"
        ? "bg-red-500/10 border-red-500/25 text-red-300"
        : "bg-slate-800/70 border-slate-700 text-slate-400";

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold ${style}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function DiagnosticDataBlock({ title, data }: { title: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <h5 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{title}</h5>
      <div className="grid grid-cols-1 gap-2">
        {entries.map(([key, value]) => (
          <div key={key} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">{key}</div>
            <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-300 font-mono">
              {formatDiagnosticValue(value)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function DiagnosticStepCard({ step }: { step: DiagnosticsStepContract }) {
  return (
    <details className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 group">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 focus:outline-none">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold text-slate-100">{step.stepName}</h4>
            <StepStatusPill status={step.status} />
          </div>
          <p className="text-xs leading-relaxed text-slate-400">{step.summary}</p>
        </div>
        <span className="hidden text-[10px] uppercase tracking-wider text-slate-500 group-hover:text-slate-400 sm:block">Expand</span>
      </summary>

      <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
        <DiagnosticDataBlock title="Key Inputs" data={step.inputs} />
        <DiagnosticDataBlock title="Key Outputs" data={step.outputs} />

        {step.metrics.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Metrics</h5>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {step.metrics.map((metric) => (
                <div key={metric.key} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{metric.label}</div>
                  <div className="mt-1 text-sm font-semibold text-slate-200">{formatDiagnosticValue(metric.value)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step.sources.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">
              Sources ({step.sources.length})
            </h5>
            <div className="space-y-2">
              {step.sources.map((source, index) => (
                <div key={`${source.url ?? source.title}-${index}`} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-300">
                  <div className="font-semibold text-slate-200">{source.title}</div>
                  <div className="mt-1 text-slate-400">
                    {[source.source, source.publishedAt].filter(Boolean).join(" · ") || "Metadata unavailable"}
                  </div>
                  {source.url && (
                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-blue-400 hover:text-blue-300">
                      {source.url}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(step.model || step.warnings.length > 0 || step.hashes.evidenceHash || step.hashes.promptHash) && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {step.model && (
              <DiagnosticDataBlock
                title="Model & Version"
                data={{
                  model: step.model.name,
                  promptVersion: step.model.promptVersion,
                  responseHash: step.model.responseHash,
                  schemaVersion: step.versions.schemaVersion,
                  analysisPolicyVersion: step.versions.analysisPolicyVersion,
                  viewModelVersion: step.versions.viewModelVersion,
                }}
              />
            )}
            <DiagnosticDataBlock
              title="Hashes"
              data={{
                evidenceHash: step.hashes.evidenceHash,
                promptHash: step.hashes.promptHash,
              }}
            />
          </div>
        )}

        {step.warnings.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Warnings & Reasons</h5>
            <div className="space-y-2">
              {step.warnings.map((warning) => (
                <div key={`${warning.code}-${warning.message}`} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                  <div className="font-semibold">{warning.code}</div>
                  <div className="mt-1">{warning.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

export default async function ReportPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await prisma.user.findFirst();
  if (!user) return notFound();

  const artifact = await getRequestedReportArtifact(user.id, params.id);
  if (!artifact) return notFound();

  if (artifact.source === "bundle") {
    const reportViewModel = artifact.reportViewModel;
    const bundle = artifact.bundle;
    const diagnostics = await getRunDiagnostics(bundle.id);

    return (
      <div className="space-y-10 max-w-6xl mx-auto">
        <div className="flex items-center gap-4">
          <Link href="/" className="p-2 border border-slate-700 rounded-md hover:bg-slate-800 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-bold">Portfolio Analysis Report</h1>
            <p className="text-slate-400 mt-1">Generated on {new Date(reportViewModel.finalizedAt).toLocaleDateString()}</p>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-xl font-bold border-b border-slate-800 pb-2 flex items-center gap-2 text-slate-200">
            <ShieldCheck className="w-5 h-5 text-emerald-400" /> Deep Analysis Verification
          </h3>
          {diagnostics ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Outcome</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">{diagnostics.artifactMeta.outcome}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Run ID</div>
                  <div className="mt-1 break-all text-sm font-semibold text-slate-100">{diagnostics.artifactMeta.runId}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Evidence Packet</div>
                  <div className="mt-1 break-all text-sm font-semibold text-slate-100">{diagnostics.artifactMeta.evidencePacketId ?? "Not available"}</div>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Generated</div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">
                    {new Date(diagnostics.artifactMeta.generatedAt).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {diagnostics.steps.map((step) => (
                  <DiagnosticStepCard key={step.stepKey} step={step} />
                ))}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-400">
              Diagnostics were not available for this run.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 space-y-3">
            <h3 className="font-semibold text-lg flex items-center gap-2 text-slate-200">
              <Target className="w-5 h-5 text-blue-400" /> Executive Summary
            </h3>
            <p className="text-slate-300 leading-relaxed text-sm">{reportViewModel.summaryMessage}</p>
          </div>
          <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-800 space-y-3">
            <h3 className="font-semibold text-lg flex items-center gap-2 text-slate-200">
              <TrendingUp className="w-5 h-5 text-indigo-400" /> Strategic Reasoning
            </h3>
            <p className="text-slate-300 leading-relaxed text-sm">{reportViewModel.reasoning}</p>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-bold border-b border-slate-800 pb-2">Recommended Final Holdings</h2>
          <SortableRecommendationsTable
            recommendations={reportViewModel.recommendations.map((rec) => ({
              ...rec,
              sources: rec.sources as SourceViewModel[],
            }))}
            convictions={[]}
          />
        </div>

        <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-6">
          <p className="text-sm text-slate-400">
            Bundle-backed report view. Outcome: <span className="text-slate-200 font-semibold">{bundle.bundleOutcome}</span>
          </p>
        </div>
      </div>
    );
  }

  const [report, allConvictions] = await Promise.all([
    Promise.resolve(artifact.report),
    (prisma as any).userConviction.findMany({
      where: { active: true },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  if (!report) return notFound();

  // Read antichurn threshold from AppSettings (defaults to 1.5% if not set)
  const antichurnSetting = await prisma.appSettings.findUnique({ where: { key: "antichurn_threshold_pct" } });
  const antichurnPct = antichurnSetting ? parseFloat(antichurnSetting.value) : 1.5;

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

  // System Verification (MVP 3)
  const sysVer = (() => {
    try { return JSON.parse((report.analysisRun as any)?.researchCoverage ?? "{}"); }
    catch { return {}; }
  })();

  // Build holding value map for current weights
  const holdingValueByTicker = new Map<string, number>();
  for (const h of report.snapshot.holdings) {
    holdingValueByTicker.set(h.ticker, (holdingValueByTicker.get(h.ticker) || 0) + (h.currentValue || 0));
  }

  // Project recommendations through view-model layer (Batch 4)
  // Raw DB rows never pass to components directly after this point.
  const recsEnriched = report.recommendations.map(rec => {
    // Correct currentWeight from live holdings (authoritative over DB-stored value)
    const holdingValue = holdingValueByTicker.get(rec.ticker) ?? 0;
    const computedCurrentWeight = totalValue > 0
      ? Number(((holdingValue / totalValue) * 100).toFixed(2))
      : 0;
    return projectRecommendation({ ...rec, currentWeight: computedCurrentWeight }, antichurnPct ?? 1.5);
  });

  // Convictions indexed by ticker
  const convictionsByTicker = new Map((allConvictions as any[]).map((c: any) => [c.ticker, c]));

  // Active convictions that apply to current recommendations
  const activeConvictionsForReport = recsEnriched
    .filter(r => convictionsByTicker.has(r.ticker))
    .map(r => ({
      ticker: r.ticker,
      rationale: convictionsByTicker.get(r.ticker)!.rationale,
    }));

  // Tickers that have changed this run (use actionBadgeVariant — never compare to lowercase "hold")
  const changedRecs = recsEnriched.filter(r =>
    r.shareDelta !== 0 || r.actionBadgeVariant !== "hold"
  );

  // Market context horizons config
  const horizons = [
    { key: "shortTerm" as keyof MarketContext, label: "Short-Term", sublabel: "Current events & policy", icon: Zap, color: "text-amber-400", border: "border-amber-500/20", bg: "bg-amber-500/5" },
    { key: "mediumTerm" as keyof MarketContext, label: "Medium-Term", sublabel: "6–18 month outlook", icon: Clock, color: "text-blue-400", border: "border-blue-500/20", bg: "bg-blue-500/5" },
    { key: "longTerm" as keyof MarketContext, label: "Long-Term", sublabel: "Structural & secular trends", icon: Landmark, color: "text-purple-400", border: "border-purple-500/20", bg: "bg-purple-500/5" },
  ];

  // Serialize conviction data (with full message threads) for client components
  const convictionThreads: ConvictionThreadData[] = allConvictions
    .filter((c: any) => convictionsByTicker.has(c.ticker))
    .map((c: any) => ({
      id: c.id,
      ticker: c.ticker,
      rationale: c.rationale,
      active: c.active,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messages: (c.messages ?? []).map((m: any) => ({
        id: m.id,
        role: m.role as "user" | "ai",
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        analysisRunId: m.analysisRunId ?? null,
      })),
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


      {/* System Verification Check */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold border-b border-slate-800 pb-2 flex items-center gap-2 text-slate-200">
          <ShieldCheck className="w-5 h-5 text-emerald-400" /> Deep Analysis Verification
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <VerRow label="Market Regime" value={sysVer.marketRegime} />
          <VerRow label="Portfolio Gap Scan" value={sysVer.gapAnalysis} />
          <VerRow label="Candidate Screening" value={sysVer.candidateScreening} />
          <VerRow label="News & Event Sources" value={sysVer.fastSearchResearch} />
          <VerRow label="FinBERT Sentiment" value={sysVer.finbertSentiment} />
          <VerRow label="GPT-5 Reasoning" value={sysVer.gpt5Strategic} />
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
          recommendations={recsEnriched}
          convictions={convictionThreads.map(c => ({ ticker: c.ticker, rationale: c.rationale, id: c.id, createdAt: c.createdAt, updatedAt: c.updatedAt }))}
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
                      rec.actionBadgeVariant === "buy" ? "text-green-400"
                      : rec.actionBadgeVariant === "hold" ? "text-slate-400" : "text-red-400"
                    }`}>
                      {rec.action}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${
                      rec.shareDelta > 0 ? "text-green-400" : rec.shareDelta < 0 ? "text-red-400" : "text-slate-500"
                    }`}>
                      {rec.shareDelta === 0 ? "—" : `${rec.shareDelta > 0 ? "+" : ""}${rec.shareDelta} shrs`}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium tabular-nums ${
                      rec.dollarDelta > 0 ? "text-green-400" : rec.dollarDelta < 0 ? "text-red-400" : "text-slate-500"
                    }`}>
                      {!rec.dollarDelta || rec.dollarDelta === 0 ? "—" : (
                        `${rec.dollarDelta > 0 ? "+" : ""}$${Math.abs(rec.dollarDelta).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-400 leading-relaxed mb-1.5">{rec.detailedReasoning}</p>
                      {rec.sources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {rec.sources.map((s: SourceViewModel, i: number) => <SourceChip key={i} source={s} />)}
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

      {/* Active Convictions Dialogue Threads */}
      {convictionThreads.length > 0 && (
        <div className="rounded-2xl border border-amber-500/40 overflow-hidden shadow-2xl shadow-amber-500/5">
          {/* Section header banner */}
          <div className="bg-gradient-to-r from-amber-950/60 via-amber-900/40 to-amber-950/60 border-b border-amber-500/30 px-5 py-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
                  <ShieldAlert className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-amber-200 leading-tight">
                    {convictionThreads.length} Active Conviction {convictionThreads.length > 1 ? "Notes" : "Note"} — Injected into this Analysis
                  </h2>
                  <p className="text-xs text-amber-500/70 mt-0.5">
                    Your thesis vs. AI counterpoint · Full conversation history tracked with dates · Reply to rebut
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {convictionThreads.map(c => {
                  const hasAiReply = c.messages.some(m => m.role === "ai");
                  return (
                    <div key={c.ticker} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                      hasAiReply
                        ? "bg-red-500/15 text-red-300 border-red-500/30"
                        : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                    }`}>
                      <span>{c.ticker}</span>
                      {hasAiReply
                        ? <span className="text-[10px] opacity-80">AI responded</span>
                        : <span className="text-[10px] opacity-80">awaiting reply</span>
                      }
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          {/* Thread list */}
          <div className="bg-slate-950/60 p-4 space-y-3">
            {convictionThreads.map(c => (
              <ConvictionThread key={c.ticker} conviction={c} />
            ))}
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
