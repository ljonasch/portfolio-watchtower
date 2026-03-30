"use client";

import { useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink } from "lucide-react";

type RecommendationInfo = {
  id: string;
  ticker: string;
  role: string | null;
  targetWeight: number;
  targetShares: number;
  currentWeight: number;
  currentShares: number;
  valueDelta: number;
  action: string;
};

type SortKey = "ticker" | "role" | "targetWeight" | "targetShares" | "currentWeight" | "action";

export function SortableRecommendationsTable({ 
  recommendations,
  ActionBadge
}: { 
  recommendations: RecommendationInfo[];
  ActionBadge: React.FC<{ action: string }>;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("targetWeight");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortedRecs = [...recommendations].sort((a, b) => {
    let aVal: any = 0;
    let bVal: any = 0;

    if (sortKey === "ticker") {
      aVal = a.ticker;
      bVal = b.ticker;
    } else if (sortKey === "role") {
      aVal = a.role || "";
      bVal = b.role || "";
    } else if (sortKey === "targetWeight") {
      aVal = a.targetWeight;
      bVal = b.targetWeight;
    } else if (sortKey === "targetShares") {
      aVal = a.targetShares;
      bVal = b.targetShares;
    } else if (sortKey === "currentWeight") {
      aVal = a.currentWeight;
      bVal = b.currentWeight;
    } else if (sortKey === "action") {
      aVal = a.action;
      bVal = b.action;
    }

    if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="w-3 h-3 inline-block ml-1 opacity-40 group-hover:opacity-100" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 inline-block ml-1 text-blue-400" /> : <ArrowDown className="w-3 h-3 inline-block ml-1 text-blue-400" />;
  };

  return (
    <div className="rounded-lg border border-slate-800 overflow-x-auto">
      <table className="w-full text-sm text-left">
        <thead className="bg-slate-900 text-slate-400 text-xs uppercase tracking-wide">
          <tr>
            <th className="px-4 py-3 font-medium cursor-pointer group whitespace-nowrap" onClick={() => handleSort("ticker")}>
              Ticker <SortIcon columnKey="ticker" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group whitespace-nowrap" onClick={() => handleSort("role")}>
              Role <SortIcon columnKey="role" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group text-right whitespace-nowrap" onClick={() => handleSort("currentWeight")}>
              Current Wgt <SortIcon columnKey="currentWeight" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group text-right whitespace-nowrap" onClick={() => handleSort("targetWeight")}>
              Target Wgt <SortIcon columnKey="targetWeight" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group text-right whitespace-nowrap" onClick={() => handleSort("targetShares")}>
              Target Shares <SortIcon columnKey="targetShares" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group whitespace-nowrap" onClick={() => handleSort("action")}>
              Action <SortIcon columnKey="action" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 bg-slate-900/20">
          {sortedRecs.map(rec => {
            const isNew = rec.currentShares === 0 && rec.action === 'Buy';
            return (
              <tr key={rec.id} className={`hover:bg-slate-800/40 transition-colors ${isNew ? 'bg-green-950/20' : ''}`}>
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
                <td className="px-4 py-3 text-slate-400 text-xs">{rec.role}</td>
                <td className="px-4 py-3 text-right text-slate-400">{rec.currentWeight.toFixed(1)}%</td>
                <td className="px-4 py-3 text-right">{rec.targetWeight.toFixed(1)}%</td>
                <td className="px-4 py-3 text-right">{rec.targetShares}</td>
                <td className="px-4 py-3">
                  <ActionBadge action={rec.action} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
