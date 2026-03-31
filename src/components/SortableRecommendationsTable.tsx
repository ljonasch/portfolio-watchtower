"use client";

import { useState } from "react";
import {
  ArrowUpDown, ArrowUp, ArrowDown, ExternalLink,
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp,
} from "lucide-react";
import { ConvictionPanel, EvidenceBadge, PositionStatusBadge } from "./ConvictionPanel";

// ─── Action badge (exported for reuse) ───────────────────────────────────────

export function ActionBadge({ action }: { action: string }) {
  const isAdd = action === "Buy" || action === "Add";
  const isSell = action === "Sell" || action === "Exit" || action === "Trim";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
        isAdd
          ? "bg-green-900/40 text-green-400"
          : isSell
          ? "bg-red-900/40 text-red-400"
          : "bg-slate-800 text-slate-400"
      }`}
    >
      {isAdd ? (
        <TrendingUp className="w-3 h-3" />
      ) : isSell ? (
        <TrendingDown className="w-3 h-3" />
      ) : (
        <Minus className="w-3 h-3" />
      )}
      {action}
    </span>
  );
}

// ─── Role badge ───────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-slate-600 text-xs">—</span>;
  const cfg: Record<string, string> = {
    Core:       "bg-blue-500/15 text-blue-300 border-blue-500/25",
    Growth:     "bg-indigo-500/15 text-indigo-300 border-indigo-500/25",
    Tactical:   "bg-amber-500/15 text-amber-300 border-amber-500/25",
    Hedge:      "bg-teal-500/15 text-teal-300 border-teal-500/25",
    Speculative:"bg-red-500/15 text-red-300 border-red-500/25",
    Income:     "bg-green-500/15 text-green-300 border-green-500/25",
    Watchlist:  "bg-slate-500/15 text-slate-400 border-slate-500/25",
  };
  const cls = cfg[role] ?? "bg-slate-800 text-slate-400 border-slate-700";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border ${cls}`}>
      {role}
    </span>
  );
}

// ─── Confidence dot ───────────────────────────────────────────────────────────

function ConfidenceDot({ confidence }: { confidence: string | null }) {
  const map: Record<string, string> = {
    high: "bg-green-400",
    medium: "bg-amber-400",
    low: "bg-red-400",
  };
  const dot = map[(confidence ?? "").toLowerCase()] ?? "bg-slate-600";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${dot} flex-shrink-0`} />
      <span className="text-xs text-slate-400 capitalize">{confidence ?? "—"}</span>
    </span>
  );
}

// ─── Expandable "Why Changed" cell ───────────────────────────────────────────

function WhyChangedCell({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text || text.toLowerCase().startsWith("no prior")) {
    return <span className="text-xs text-slate-600 italic">First run</span>;
  }
  const short = text.length > 90 ? text.slice(0, 90) + "…" : text;
  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-400 leading-relaxed">
        {expanded ? text : short}
      </p>
      {text.length > 90 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="inline-flex items-center gap-0.5 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type RecommendationRow = {
  id: string;
  ticker: string;
  companyName: string | null;
  role: string | null;
  targetWeight: number;
  targetShares: number;
  shareDelta: number;
  dollarDelta?: number | null;
  currentWeight: number;
  currentShares: number;
  acceptableRangeLow?: number | null;
  acceptableRangeHigh?: number | null;
  action: string;
  confidence?: string | null;
  positionStatus?: string | null;
  evidenceQuality?: string | null;
  whyChanged?: string | null;
  thesisSummary?: string | null;
  detailedReasoning?: string | null;
  valueDelta: number;
};

export type ConvictionRow = {
  ticker: string;
  rationale: string;
  id: string;
  createdAt: string;
  updatedAt: string;
};

type SortKey =
  | "ticker" | "role" | "targetWeight" | "targetShares"
  | "shareDelta" | "currentWeight" | "action" | "confidence" | "dollarDelta";

// ─── Main component ───────────────────────────────────────────────────────────

export function SortableRecommendationsTable({
  recommendations,
  convictions: initialConvictions = [],
}: {
  recommendations: RecommendationRow[];
  convictions?: ConvictionRow[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("targetWeight");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [convictions, setConvictions] = useState<ConvictionRow[]>(initialConvictions);
  const [openConvictionTicker, setOpenConvictionTicker] = useState<string | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(v => (v === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedRecs = [...recommendations].sort((a, b) => {
    const vals: Record<SortKey, [any, any]> = {
      ticker:        [a.ticker, b.ticker],
      role:          [a.role ?? "", b.role ?? ""],
      targetWeight:  [a.targetWeight, b.targetWeight],
      targetShares:  [a.targetShares, b.targetShares],
      shareDelta:    [a.shareDelta, b.shareDelta],
      dollarDelta:   [a.dollarDelta ?? 0, b.dollarDelta ?? 0],
      currentWeight: [a.currentWeight, b.currentWeight],
      action:        [a.action, b.action],
      confidence:    [a.confidence ?? "", b.confidence ?? ""],
    };
    const [aVal, bVal] = vals[sortKey];
    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const convictionMap = new Map(convictions.map(c => [c.ticker, c]));

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey !== col ? (
      <ArrowUpDown className="w-3 h-3 inline-block ml-1 opacity-30 group-hover:opacity-80" />
    ) : sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 inline-block ml-1 text-blue-400" />
    ) : (
      <ArrowDown className="w-3 h-3 inline-block ml-1 text-blue-400" />
    );

  const Th = ({
    col, align = "left", children,
  }: { col: SortKey; align?: "left" | "right"; children: React.ReactNode }) => (
    <th
      className={`px-3 py-3 font-medium cursor-pointer group whitespace-nowrap select-none text-${align}`}
      onClick={() => handleSort(col)}
    >
      {children}
      <SortIcon col={col} />
    </th>
  );

  return (
    <>
      {/* Conviction modal overlay */}
      {openConvictionTicker && (
        <ConvictionPanel
          ticker={openConvictionTicker}
          conviction={convictionMap.get(openConvictionTicker) ?? null}
          counterpoint={
            recommendations.find(r => r.ticker === openConvictionTicker)?.detailedReasoning ?? undefined
          }
          compact
        />
      )}

      <div className="rounded-lg border border-slate-800 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-900 text-slate-400 text-xs uppercase tracking-wide">
            <tr>
              <Th col="ticker">Ticker</Th>
              <Th col="role">Role</Th>
              <Th col="action">Action</Th>
              <Th col="confidence">Conf.</Th>
              <Th col="currentWeight" align="right">Curr Wgt</Th>
              <Th col="targetWeight" align="right">Target Wgt</Th>
              <th className="px-3 py-3 font-medium text-right whitespace-nowrap">Range</th>
              <Th col="shareDelta" align="right">Δ Shares</Th>
              <Th col="dollarDelta" align="right">Δ Dollars</Th>
              <th className="px-3 py-3 font-medium whitespace-nowrap">Why Changed</th>
              <th className="px-3 py-3 font-medium whitespace-nowrap">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80 bg-slate-900/20">
            {sortedRecs.map(rec => {
              const isNew = rec.currentShares === 0 && rec.action === "Buy";
              const hasConviction = convictionMap.has(rec.ticker);
              const isSell = rec.action === "Sell" || rec.action === "Exit" || rec.action === "Trim";

              return (
                <tr
                  key={rec.id}
                  className={`hover:bg-slate-800/30 transition-colors align-top ${
                    isNew ? "bg-green-950/10" : isSell ? "bg-red-950/10" : ""
                  } ${hasConviction ? "border-l-2 border-l-amber-500/40" : ""}`}
                >
                  {/* Ticker */}
                  <td className="px-3 py-3">
                    <div className="flex flex-col gap-1">
                      {rec.ticker === "CASH" ? (
                        <span className="font-bold text-slate-400">CASH</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <a
                            href={`https://finance.yahoo.com/quote/${rec.ticker}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-bold text-blue-400 hover:text-blue-300 transition-colors group"
                          >
                            {rec.ticker}
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </a>
                          {isNew && (
                            <span className="text-[9px] font-bold uppercase tracking-wider bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded-full">
                              NEW
                            </span>
                          )}
                        </span>
                      )}
                      {rec.companyName && (
                        <span className="text-[10px] text-slate-600 leading-tight">{rec.companyName}</span>
                      )}
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        <EvidenceBadge quality={rec.evidenceQuality ?? null} />
                        <PositionStatusBadge status={rec.positionStatus ?? null} />
                      </div>
                    </div>
                  </td>

                  {/* Role */}
                  <td className="px-3 py-3">
                    <RoleBadge role={rec.role} />
                  </td>

                  {/* Action */}
                  <td className="px-3 py-3">
                    <ActionBadge action={rec.action} />
                  </td>

                  {/* Confidence */}
                  <td className="px-3 py-3">
                    <ConfidenceDot confidence={rec.confidence ?? null} />
                  </td>

                  {/* Current Weight */}
                  <td className="px-3 py-3 text-right text-slate-500 tabular-nums">
                    {isNew ? "—" : `${rec.currentWeight.toFixed(1)}%`}
                  </td>

                  {/* Target Weight */}
                  <td className="px-3 py-3 text-right tabular-nums">
                    <span className="font-semibold text-blue-300">{rec.targetWeight.toFixed(1)}%</span>
                  </td>

                  {/* Acceptable Range */}
                  <td className="px-3 py-3 text-right tabular-nums">
                    {rec.acceptableRangeLow != null && rec.acceptableRangeHigh != null ? (
                      <span className="text-xs text-slate-500">
                        {rec.acceptableRangeLow.toFixed(1)}–{rec.acceptableRangeHigh.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-700">—</span>
                    )}
                  </td>

                  {/* Δ Shares */}
                  <td className={`px-3 py-3 text-right tabular-nums font-medium ${
                    rec.shareDelta > 0 ? "text-green-400" : rec.shareDelta < 0 ? "text-red-400" : "text-slate-600"
                  }`}>
                    {rec.shareDelta === 0 ? "—" : `${rec.shareDelta > 0 ? "+" : ""}${rec.shareDelta}`}
                  </td>

                  {/* Δ Dollars */}
                  <td className={`px-3 py-3 text-right tabular-nums font-medium ${
                    (rec.dollarDelta ?? 0) > 0 ? "text-green-400" : (rec.dollarDelta ?? 0) < 0 ? "text-red-400" : "text-slate-600"
                  }`}>
                    {!rec.dollarDelta || rec.dollarDelta === 0 ? "—" : (
                      `${rec.dollarDelta > 0 ? "+" : ""}$${Math.abs(rec.dollarDelta).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    )}
                  </td>

                  {/* Why Changed */}
                  <td className="px-3 py-3 max-w-[220px]">
                    <WhyChangedCell text={rec.whyChanged ?? null} />
                  </td>

                  {/* Conviction note button */}
                  <td className="px-3 py-3">
                    {rec.ticker !== "CASH" && (
                      <ConvictionPanel
                        ticker={rec.ticker}
                        conviction={convictionMap.get(rec.ticker) ?? null}
                        counterpoint={rec.detailedReasoning ?? undefined}
                        compact
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
