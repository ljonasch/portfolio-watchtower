"use client";

import { useState } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

type HoldingInfo = {
  id: string;
  ticker: string;
  shares: number;
  currentPrice: number | null;
  currentValue: number | null;
  dailyChangePct: number | null;
  lastBoughtAt: Date | null;
  isCash: boolean;
};

type SortKey = "ticker" | "shares" | "price" | "value" | "weight" | "dailyChange" | "lastBoughtAt";

export function SortableHoldingsTable({ 
  holdings, 
  totalValue 
}: { 
  holdings: HoldingInfo[];
  totalValue: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const getWeight = (h: HoldingInfo) => {
    const val = h.currentValue || (h.shares * (h.currentPrice || 0));
    return totalValue > 0 ? (val / totalValue) * 100 : 0;
  };

  const sortedHoldings = [...holdings].sort((a, b) => {
    let aVal: any = 0;
    let bVal: any = 0;

    if (sortKey === "ticker") {
      aVal = a.ticker;
      bVal = b.ticker;
    } else if (sortKey === "shares") {
      aVal = a.shares;
      bVal = b.shares;
    } else if (sortKey === "price") {
      aVal = a.currentPrice || 0;
      bVal = b.currentPrice || 0;
    } else if (sortKey === "value") {
      aVal = a.currentValue || (a.shares * (a.currentPrice || 0));
      bVal = b.currentValue || (b.shares * (b.currentPrice || 0));
    } else if (sortKey === "weight") {
      aVal = getWeight(a);
      bVal = getWeight(b);
    } else if (sortKey === "dailyChange") {
      aVal = a.dailyChangePct ?? -99999;
      bVal = b.dailyChangePct ?? -99999;
    } else if (sortKey === "lastBoughtAt") {
      aVal = a.lastBoughtAt ? new Date(a.lastBoughtAt).getTime() : 0;
      bVal = b.lastBoughtAt ? new Date(b.lastBoughtAt).getTime() : 0;
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
            <th className="px-4 py-3 font-medium cursor-pointer group text-right whitespace-nowrap" onClick={() => handleSort("shares")}>
              Shares <SortIcon columnKey="shares" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group text-right whitespace-nowrap" onClick={() => handleSort("price")}>
              Price <SortIcon columnKey="price" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group text-right whitespace-nowrap" onClick={() => handleSort("value")}>
              Total Value <SortIcon columnKey="value" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group text-right whitespace-nowrap" onClick={() => handleSort("weight")}>
              Weight <SortIcon columnKey="weight" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group text-right whitespace-nowrap" onClick={() => handleSort("dailyChange")}>
              1D Change <SortIcon columnKey="dailyChange" />
            </th>
            <th className="px-4 py-3 font-medium cursor-pointer group text-right whitespace-nowrap" onClick={() => handleSort("lastBoughtAt")}>
              Last Bought <SortIcon columnKey="lastBoughtAt" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800 bg-slate-900/20">
          {sortedHoldings.map((h) => {
            const rawVal = h.currentValue || (h.shares * (h.currentPrice || 0));
            const weight = getWeight(h);
            return (
              <tr key={h.id} className="hover:bg-slate-800/40 transition-colors">
                <td className="px-4 py-3 font-bold text-slate-200">{h.ticker}</td>
                <td className="px-4 py-3 text-right">{h.shares}</td>
                <td className="px-4 py-3 text-right">{h.currentPrice ? '$' + h.currentPrice.toFixed(2) : '—'}</td>
                <td className="px-4 py-3 text-right font-medium">${rawVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-3 text-right text-slate-400">{weight.toFixed(1)}%</td>
                <td className="px-4 py-3 text-right">
                  {h.dailyChangePct != null ? (
                    <span className={h.dailyChangePct > 0 ? "text-green-400" : h.dailyChangePct < 0 ? "text-red-400" : "text-slate-400"}>
                      {h.dailyChangePct > 0 ? '+' : ''}{h.dailyChangePct.toFixed(2)}%
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-slate-400 text-xs">
                  {h.lastBoughtAt ? new Date(h.lastBoughtAt).toLocaleDateString() : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
