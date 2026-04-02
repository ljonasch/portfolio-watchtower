"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity, AlertTriangle, Archive, BarChart2, Brain, CheckCircle2,
  ChevronRight, Globe, Loader2, Search, Sparkles, TrendingDown, TrendingUp,
  Minus, Zap, Eye, Target, ShieldAlert
} from "lucide-react";
import type { ProgressEvent } from "@/lib/research/progress-events";

// ── Types ──────────────────────────────────────────────────────────────────────

interface LiveTicker {
  ticker: string;
  sentiment?: { direction: "buy" | "hold" | "sell"; magnitude: number; confidence: number };
  gpt5?: { action: string; confidence: string };
  finalAction?: string;
  isCandidate?: boolean;
  eliminated?: boolean;
  eliminatedReason?: string;
}

interface LiveLog {
  id: number;
  message: string;
  level: "info" | "warn" | "error";
  ts: number;
}

interface Gap {
  description: string;
  severity: "critical" | "opportunity" | "redundancy" | "mismatch";
}

interface Regime {
  riskMode: string;
  rateTrend: string;
  dollarTrend: string;
  vix: string;
  summary: string;
}

interface TerminalAbstainState {
  reason: string;
  stage: string;
  message: string;
}

// ── Pipeline stages definition ─────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { id: "regime",       icon: Globe,      label: "Market Regime",           color: "text-amber-400",  bgColor: "bg-amber-500/10 border-amber-800/30" },
  { id: "gap",          icon: Target,     label: "Gap Analysis",             color: "text-orange-400", bgColor: "bg-orange-500/10 border-orange-800/30" },
  { id: "candidates",   icon: Search,     label: "Candidate Screening",      color: "text-purple-400", bgColor: "bg-purple-500/10 border-purple-800/30" },
  { id: "stage1",       icon: Globe,      label: "News & Price Research",    color: "text-blue-400",   bgColor: "bg-blue-500/10 border-blue-800/30" },
  { id: "sentiment",    icon: Activity,   label: "Sentiment Scoring",        color: "text-cyan-400",   bgColor: "bg-cyan-500/10 border-cyan-800/30" },
  { id: "stage3",       icon: Brain,      label: "Primary AI Reasoning",     color: "text-indigo-400", bgColor: "bg-indigo-500/10 border-indigo-800/30" },
  { id: "stage5",       icon: Archive,    label: "Saving Results",           color: "text-slate-400",  bgColor: "bg-slate-500/10 border-slate-700/30" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action?: string }) {
  if (!action) return null;
  const cls =
    action === "Buy"  ? "bg-emerald-900/50 text-emerald-400 border-emerald-800/50" :
    action === "Sell" ? "bg-red-900/50 text-red-400 border-red-800/50" :
    action === "Trim" ? "bg-amber-900/50 text-amber-400 border-amber-800/50" :
                        "bg-slate-800/50 text-slate-400 border-slate-700/50";
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>{action}</span>;
}

function DirectionIcon({ direction }: { direction?: "buy" | "hold" | "sell" }) {
  if (direction === "buy")  return <TrendingUp className="w-3 h-3 text-emerald-400" />;
  if (direction === "sell") return <TrendingDown className="w-3 h-3 text-red-400" />;
  return <Minus className="w-3 h-3 text-slate-500" />;
}

function SeverityBadge({ severity }: { severity: Gap["severity"] }) {
  const cfg = {
    critical:    { cls: "bg-red-900/40 text-red-300 border-red-800/40",     label: "Critical" },
    opportunity: { cls: "bg-emerald-900/40 text-emerald-300 border-emerald-800/40", label: "Opportunity" },
    redundancy:  { cls: "bg-amber-900/40 text-amber-300 border-amber-800/40", label: "Redundancy" },
    mismatch:    { cls: "bg-orange-900/40 text-orange-300 border-orange-800/40", label: "Mismatch" },
  }[severity];
  return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${cfg.cls}`}>{cfg.label}</span>;
}

// ── Main Component ─────────────────────────────────────────────────────────────────

export function AnalysisProgress({ snapshotId, customPrompt }: { snapshotId: string; customPrompt?: string }) {
  const router = useRouter();
  const logRef = useRef<HTMLDivElement>(null);
  const logCounter = useRef(0);

  const [activeStage, setActiveStage]       = useState<string | null>(null);
  const [completedStages, setCompletedStages] = useState<Set<string>>(new Set());
  const [stageDetails, setStageDetails]     = useState<Record<string, string>>({});
  const [regime, setRegime]                 = useState<Regime | null>(null);
  const [gaps, setGaps]                     = useState<Gap[]>([]);
  const [tickers, setTickers]               = useState<Map<string, LiveTicker>>(new Map());
  const [logs, setLogs]                     = useState<LiveLog[]>([]);
  const [error, setError]                   = useState<string | null>(null);
  const [terminalAbstain, setTerminalAbstain] = useState<TerminalAbstainState | null>(null);
  const [done, setDone]                     = useState(false);
  const [startTs]                           = useState(Date.now());
  const [elapsed, setElapsed]               = useState(0);

  // Elapsed timer
  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTs) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startTs]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Navigation guard to prevent accidental cancellation
  useEffect(() => {
    if (done || error || terminalAbstain) return;

    // 1. Warn on tab close or page reload
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Analysis is still running. If you leave, the run will be cancelled. Are you sure?";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // 2. Intercept internal Next.js <Link> routing
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      // Only intercept local links
      if (anchor && anchor.href && !anchor.hasAttribute("target") && anchor.host === window.location.host) {
        if (!window.confirm("Analysis is currently running. If you navigate away, this run will be cancelled. Are you sure you want to leave?")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    document.addEventListener("click", handleClick, true); // capture phase

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
    };
  }, [done, error, terminalAbstain]);

  // Stream connection
  useEffect(() => {
    const ctrl = new AbortController();

    async function run() {
      try {
        const res = await fetch("/api/analyze/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshotId, customPrompt }),
          signal: ctrl.signal,
        });

        if (!res.body) { setError("No response stream."); return; }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";

        while (true) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";

          for (const part of parts) {
            if (!part.startsWith("data: ")) continue;
            let ev: ProgressEvent;
            try { ev = JSON.parse(part.slice(6)); } catch { continue; }
            handleEvent(ev);
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") setError(err.message ?? "Stream error");
      }
    }

    run();
    return () => ctrl.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotId]);

  function addLog(message: string, level: LiveLog["level"] = "info") {
    const entry: LiveLog = { id: ++logCounter.current, message, level, ts: Date.now() };
    setLogs(prev => [...prev.slice(-80), entry]); // keep last 80
  }

  function updateTicker(ticker: string, patch: Partial<LiveTicker>) {
    setTickers(prev => {
      const next = new Map(prev);
      next.set(ticker, { ...(next.get(ticker) ?? { ticker }), ...patch });
      return next;
    });
  }

  function handleEvent(ev: ProgressEvent) {
    switch (ev.type) {
      case "stage_start":
        setActiveStage(ev.stage);
        setStageDetails(prev => ({ ...prev, [ev.stage]: ev.detail }));
        addLog(`▶ ${ev.label}: ${ev.detail}`);
        break;

      case "stage_complete":
        setCompletedStages(prev => new Set([...prev, ev.stage]));
        if (ev.stage === activeStage) setActiveStage(null);
        addLog(`✓ Stage complete (${(ev.durationMs / 1000).toFixed(1)}s)`);
        break;

      case "regime":
        setRegime(ev);
        addLog(`🌐 Market regime: ${ev.riskMode} | rates ${ev.rateTrend} | VIX ${ev.vix}`);
        break;

      case "gap_found":
        setGaps(prev => [...prev, { description: ev.description, severity: ev.severity }]);
        const icon = ev.severity === "critical" ? "⚠️" : ev.severity === "opportunity" ? "🟢" : ev.severity === "redundancy" ? "🔁" : "🔀";
        addLog(`${icon} Gap: ${ev.description}`, ev.severity === "critical" ? "warn" : "info");
        break;

      case "candidate_found":
        updateTicker(ev.ticker, { ticker: ev.ticker, isCandidate: true });
        addLog(`🔍 Candidate: ${ev.ticker} (${ev.companyName}) — ${ev.reason}${ev.catalyst ? ` | Catalyst: ${ev.catalyst}` : ""}`);
        break;

      case "candidate_eliminated":
        updateTicker(ev.ticker, { eliminated: true, eliminatedReason: ev.reason });
        addLog(`✗ Eliminated: ${ev.ticker} — ${ev.reason}`, "warn");
        break;

      case "sentiment_score":
        updateTicker(ev.ticker, {
          sentiment: { direction: ev.direction, magnitude: ev.magnitude, confidence: ev.confidence },
        });
        const sIcon = ev.direction === "buy" ? "↑" : ev.direction === "sell" ? "↓" : "–";
        addLog(`${sIcon} Sentiment ${ev.ticker}: ${ev.direction} (magnitude ${ev.magnitude.toFixed(2)})${ev.drivingArticle ? ` · "${ev.drivingArticle.slice(0, 60)}"` : ""}`);
        break;

      case "price_reaction":
        addLog(`📈 ${ev.ticker} price: ${ev.verdict.replace(/_/g, " ")} — ${ev.note}`, ev.verdict === "pre_event_stale" || ev.verdict === "overreaction_faded" ? "warn" : "info");
        break;

      case "model_verdict":
        // Only gpt5 model verdicts are emitted in the new single-LLM pipeline
        if (ev.model === "gpt5") updateTicker(ev.ticker, { gpt5: { action: ev.action, confidence: ev.confidence } });
        addLog(`🤖 GPT-5.4 ${ev.ticker}: ${ev.action} (${ev.confidence}) — ${ev.keyReason.slice(0, 80)}`);
        break;

      case "adjudicator_note":
        // Gated adjudicator fired for low-conf/low-evidence tickers — diagnostic only
        addLog(`🔍 Adjudicator notes for [${ev.tickers.join(", ")}]: diagnostic only, no action change`, "info");
        break;

      case "log":
        addLog(ev.message, ev.level ?? "info");
        break;

      case "complete":
        setDone(true);
        addLog(`✅ Analysis complete in ${(ev.totalMs / 1000).toFixed(0)}s. Redirecting...`);
        setTimeout(() => router.push(`/report/${ev.reportId}`), 1200);
        break;

      case "abstain":
        setTerminalAbstain({
          reason: ev.reason,
          stage: ev.stage,
          message: ev.message,
        });
        addLog(`ABSTAIN: ${ev.reason} at ${ev.stage} â€” ${ev.message}`, "warn");
        break;

      case "error":
        setError(ev.message);
        addLog(`ERROR: ${ev.message}`, "error");
        break;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const allTickers = Array.from(tickers.values());
  const heldTickers = allTickers.filter(t => !t.isCandidate && !t.eliminated);
  const candidateList = allTickers.filter(t => t.isCandidate && !t.eliminated);
  const eliminatedList = allTickers.filter(t => t.eliminated);

  if (terminalAbstain) {
    const isValidationAbort = terminalAbstain.reason === "VALIDATION_HARD_ERROR";
    const title = isValidationAbort ? "Analysis Blocked by Validation" : "Analysis Abstained";
    const detail = isValidationAbort
      ? "The analysis stopped safely because validation blocked an unreliable output before it could be saved."
      : "The analysis stopped safely before producing a report because the primary reasoning stage could not complete reliably.";

    return (
      <div className="max-w-2xl mx-auto mt-8 rounded-2xl border border-amber-900/40 bg-amber-950/10 p-6 text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto" />
        <p className="text-amber-300 font-semibold">{title}</p>
        <p className="text-sm text-amber-200">{detail}</p>
        <p className="text-xs text-amber-500 uppercase tracking-[0.18em]">Stage: {terminalAbstain.stage}</p>
        <p className="text-sm text-amber-400">{terminalAbstain.message}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto mt-8 rounded-2xl border border-red-900/40 bg-red-950/10 p-6 text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
        <p className="text-red-300 font-semibold">Analysis Failed</p>
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-4 pb-12">

      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            {done
              ? <CheckCircle2 className="w-5 h-5 text-green-400" />
              : <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
            {done ? "Analysis Complete ✓" : "Analysis In Progress"}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Elapsed: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Left column: Pipeline + Regime + Gaps */}
        <div className="space-y-3">

          {/* Pipeline stages */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 space-y-1">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Pipeline</p>
            {PIPELINE_STAGES.map(stage => {
              const isDone   = completedStages.has(stage.id);
              const isActive = activeStage === stage.id;
              const Icon = stage.icon;
              return (
                <div key={stage.id} className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all ${isActive ? `${stage.bgColor} border` : isDone ? "opacity-60" : "opacity-25"}`}>
                  {isDone
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                    : isActive
                      ? <Loader2 className={`w-3.5 h-3.5 flex-shrink-0 ${stage.color} animate-spin`} />
                      : <Icon className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
                  }
                  <span className={`text-xs font-medium flex-1 ${isActive ? "text-slate-100" : isDone ? "text-slate-400" : "text-slate-600"}`}>
                    {stage.label}
                  </span>
                  {isActive && stageDetails[stage.id] && (
                    <span className="text-[10px] text-slate-500 truncate max-w-[80px]">{stageDetails[stage.id].split("—")[0]}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Market Regime */}
          {regime && (
            <div className={`rounded-xl border p-3 space-y-1.5 ${
              regime.riskMode === "risk-off" ? "border-red-900/40 bg-red-950/10" :
              regime.riskMode === "risk-on"  ? "border-green-900/40 bg-green-950/10" :
                                               "border-slate-800 bg-slate-900/30"
            }`}>
              <p className="text-xs font-semibold text-slate-400 flex items-center gap-1.5"><Globe className="w-3 h-3" /> Market Regime</p>
              <div className="grid grid-cols-2 gap-1 text-[10px]">
                <span className={`font-bold ${regime.riskMode === "risk-off" ? "text-red-400" : regime.riskMode === "risk-on" ? "text-green-400" : "text-slate-300"}`}>
                  {regime.riskMode}
                </span>
                <span className="text-slate-400">Rates: {regime.rateTrend}</span>
                <span className="text-slate-400">Dollar: {regime.dollarTrend}</span>
                <span className="text-slate-400">VIX: {regime.vix}</span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">{regime.summary.slice(0, 120)}</p>
            </div>
          )}

          {/* Gaps */}
          {gaps.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-slate-400 flex items-center gap-1.5"><Target className="w-3 h-3" /> Portfolio Gaps</p>
              <div className="space-y-1.5">
                {gaps.map((g, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <SeverityBadge severity={g.severity} />
                    <p className="text-[10px] text-slate-400 leading-relaxed flex-1">{g.description.slice(0, 100)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Middle column: Live ticker scores */}
        <div className="space-y-3">

          {/* Held positions */}
          {heldTickers.length > 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Held Positions ({heldTickers.length})
              </p>
              <div className="space-y-1">
                {heldTickers.map(t => (
                  <div key={t.ticker} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800/30">
                    <span className="font-bold text-slate-200 w-12 flex-shrink-0">{t.ticker}</span>
                    {t.sentiment && <DirectionIcon direction={t.sentiment.direction} />}
                    {t.gpt5 && <ActionBadge action={t.gpt5.action} />}
                    {t.finalAction && !t.gpt5 && <ActionBadge action={t.finalAction} />}
                    {t.sentiment && (
                      <div className="ml-auto flex items-center gap-1">
                        <div className="w-10 h-1 rounded-full bg-slate-700 overflow-hidden">
                          <div className={`h-full rounded-full ${t.sentiment.direction === "buy" ? "bg-emerald-500" : t.sentiment.direction === "sell" ? "bg-red-500" : "bg-slate-500"}`}
                            style={{ width: `${t.sentiment.magnitude * 100}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Candidates */}
          {candidateList.length > 0 && (
            <div className="rounded-2xl border border-purple-900/30 bg-purple-950/10 p-3">
              <p className="text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" /> Candidates ({candidateList.length})
              </p>
              <div className="space-y-1">
                {candidateList.map(t => (
                  <div key={t.ticker} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs bg-slate-800/20">
                    <span className="font-bold text-purple-300 w-12 flex-shrink-0">{t.ticker}</span>
                    <span className="text-[9px] text-purple-600 flex-shrink-0">NEW</span>
                    {t.sentiment && <DirectionIcon direction={t.sentiment.direction} />}
                    {t.gpt5 && <ActionBadge action={t.gpt5.action} />}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Eliminated */}
          {eliminatedList.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/20 p-3 opacity-50">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1.5">
                Eliminated ({eliminatedList.length})
              </p>
              {eliminatedList.map(t => (
                <div key={t.ticker} className="text-[10px] text-slate-600 truncate">
                  {t.ticker} — {t.eliminatedReason?.slice(0, 60)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column: Live log */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden flex flex-col" style={{ maxHeight: "520px" }}>
          <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 flex-shrink-0">
            <Eye className="w-3.5 h-3.5 text-slate-500" />
            <p className="text-xs font-semibold text-slate-500">Live Log</p>
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-2 space-y-0.5 font-mono">
            {logs.map(l => (
              <div key={l.id} className={`text-[10px] leading-relaxed break-words ${
                l.level === "error" ? "text-red-400" :
                l.level === "warn"  ? "text-amber-400/80" :
                "text-slate-500"
              }`}>
                {l.message}
              </div>
            ))}
            {!done && <div className="text-[10px] text-slate-700 animate-pulse">▋</div>}
          </div>
        </div>
      </div>

    </div>
  );
}
