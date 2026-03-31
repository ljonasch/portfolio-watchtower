"use client";

import { useState } from "react";
import { updateAndConfirmSnapshot, enrichPricesWithLLM } from "@/app/actions";
import { Loader2, Plus, Trash2, Sparkles, AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";

type HoldingInput = {
  id: string;
  ticker: string;
  shares: number;
  currentPrice: number;
  currentValue: number;
  isCash: boolean;
  lastBoughtAt?: string | null;
  sharesChangedFromPrior?: boolean; // true = shares differ from last snapshot
};

export function ReviewForm({ snapshotId, initialHoldings, warnings }: { snapshotId: string; initialHoldings: HoldingInput[], warnings?: string[] }) {
  const [holdings, setHoldings] = useState<HoldingInput[]>(initialHoldings);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  const [priceError, setPriceError] = useState<string | null>(null);
  
  const [autoCorrectionsApplied, setAutoCorrectionsApplied] = useState(false);
  const [acceptedCorrections, setAcceptedCorrections] = useState(false);

  const missingPriceTickers = holdings
    .filter(h => !h.isCash && (!h.currentPrice || h.currentPrice <= 1))
    .map(h => h.ticker)
    .filter(Boolean);

  const getMathDiscrepancy = (h: HoldingInput) => {
    if (h.isCash) return false;
    // Prevent false positives on tiny rounding errors
    const expectedValue = h.shares * h.currentPrice;
    const discrepancy = Math.abs(expectedValue - h.currentValue);
    if (h.currentValue > 0 && discrepancy / h.currentValue > 0.05) return true;
    if (h.currentValue === 0 && expectedValue > 5) return true;
    return false;
  };

  const mathIssueTickers = holdings.filter(getMathDiscrepancy).map(h => h.ticker).filter(Boolean);
  const hasIssues = missingPriceTickers.length > 0 || mathIssueTickers.length > 0;

  const updateHolding = (index: number, field: keyof HoldingInput, value: string | number | boolean | null) => {
    const newHoldings = [...holdings];
    newHoldings[index] = { ...newHoldings[index], [field]: value };
    
    // Auto calculate value
    if (field === 'shares' || field === 'currentPrice') {
      const shares = Number(newHoldings[index].shares);
      const price = Number(newHoldings[index].currentPrice);
      if (!isNaN(shares) && !isNaN(price)) {
        newHoldings[index].currentValue = Number((shares * price).toFixed(2));
      }
    }
    
    setHoldings(newHoldings);
  };

  const removeHolding = (index: number) => {
    setHoldings(holdings.filter((_, i) => i !== index));
  };

  const addHolding = () => {
    setHoldings([...holdings, { id: Math.random().toString(), ticker: '', shares: 0, currentPrice: 0, currentValue: 0, isCash: false }]);
  };

  const handleFetchPrices = async () => {
    setIsFetchingPrices(true);
    setPriceError(null);
    try {
      const tickersToFetch = [...new Set([...missingPriceTickers, ...mathIssueTickers])];
      const prices = await enrichPricesWithLLM(tickersToFetch);
      
      let didUpdate = false;
      setHoldings(prev =>
        prev.map(h => {
          const fetchedPrice = prices[h.ticker.toUpperCase()];
          if (!h.isCash && fetchedPrice && (missingPriceTickers.includes(h.ticker) || mathIssueTickers.includes(h.ticker))) {
            didUpdate = true;
            const newPrice = fetchedPrice;
            const newValue = Number((h.shares * newPrice).toFixed(2));
            return { ...h, currentPrice: newPrice, currentValue: newValue };
          }
          return h;
        })
      );
      
      if (didUpdate) {
        setAutoCorrectionsApplied(true);
        setAcceptedCorrections(false);
      }
    } catch (e: any) {
      setPriceError(e.message || "Failed to fetch prices.");
    } finally {
      setIsFetchingPrices(false);
    }
  };

  const handleSubmit = async (isQueueOnly: boolean = false) => {
    setIsSubmitting(true);
    try {
      await updateAndConfirmSnapshot(snapshotId, holdings, isQueueOnly);
    } catch (e) {
      console.error(e);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {isSubmitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-slate-700 px-8 py-6 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] flex items-center gap-4 animate-in fade-in zoom-in duration-300">
            <Loader2 className="animate-spin text-blue-500 w-6 h-6 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-100">Saving holdings…</p>
              <p className="text-xs text-slate-400 mt-0.5">Redirecting to analysis</p>
            </div>
          </div>
        </div>
      )}

      {warnings && warnings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">Parser Warnings</p>
            <ul className="list-disc list-inside text-xs text-amber-400/80 mt-1 space-y-1">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}

      {hasIssues && !autoCorrectionsApplied && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-red-300">Issues detected in prices</p>
              <p className="text-xs text-red-400/80 mt-1 max-w-lg">
                The prices for <b>{[...new Set([...missingPriceTickers, ...mathIssueTickers])].join(', ')}</b> are missing or mathematically impossible (Shares × Price ≠ Value). They were likely misidentified as percentages.
              </p>
            </div>
          </div>
          <button
            onClick={handleFetchPrices}
            disabled={isFetchingPrices}
            className="inline-flex items-center gap-2 whitespace-nowrap text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
          >
            {isFetchingPrices ? <><Loader2 className="w-4 h-4 animate-spin" /> Fetching...</> : <><Sparkles className="w-4 h-4" /> Auto-Correct Prices</>}
          </button>
        </div>
      )}

      {autoCorrectionsApplied && !acceptedCorrections && (
         <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
           <div>
             <p className="text-sm font-medium text-blue-300">Live prices fetched & applied</p>
             <p className="text-xs text-blue-400/80 mt-1">Please review the updated rows to verify the fetched prices are accurate.</p>
           </div>
           <button
             onClick={() => setAcceptedCorrections(true)}
             className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 transition-colors"
           >
             <CheckCircle className="w-4 h-4" /> Accept Corrections
           </button>
         </div>
      )}

      {priceError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-sm text-red-400">
          ⚠️ {priceError}
        </div>
      )}

      <div className="bg-slate-900/50 rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left relative">
            <thead className="bg-slate-900 text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Ticker</th>
                <th className="px-4 py-3 font-medium">Shares</th>
                <th className="px-4 py-3 font-medium">Price ($)</th>
                <th className="px-4 py-3 font-medium">Value ($)</th>
                <th className="px-4 py-3 font-medium">Last Bought</th>
                <th className="px-4 py-3 font-medium text-center">Cash?</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/20">
              {holdings.map((h, i) => {
                const hasMathIssue = getMathDiscrepancy(h);
                const isMissingPrice = !h.isCash && (!h.currentPrice || h.currentPrice <= 1);
                const needsAttention = hasMathIssue || isMissingPrice;

                return (
                <tr key={h.id} className={`transition-colors ${needsAttention ? 'bg-red-900/10' : 'hover:bg-slate-800/20'}`}>
                  <td className="px-4 py-2">
                    <input type="text" value={h.ticker} onChange={e => updateHolding(i, 'ticker', e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-24 text-slate-200 uppercase" />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={h.shares} onChange={e => updateHolding(i, 'shares', parseFloat(e.target.value) || 0)} className="bg-slate-950 border border-slate-700 rounded px-2 py-1 w-24 text-slate-200" />
                  </td>
                  <td className="px-4 py-2 relative">
                    <input type="number" value={h.currentPrice} onChange={e => updateHolding(i, 'currentPrice', parseFloat(e.target.value) || 0)} className={`bg-slate-950 border rounded px-2 py-1 w-24 text-slate-200 ${needsAttention ? 'border-red-500 bg-red-950/30' : 'border-slate-700'}`} />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" value={h.currentValue} onChange={e => updateHolding(i, 'currentValue', parseFloat(e.target.value) || 0)} className={`bg-slate-950 border rounded px-2 py-1 w-28 text-slate-200 ${hasMathIssue ? 'border-amber-500 bg-amber-950/30' : 'border-slate-700'}`} />
                  </td>
                  <td className="px-4 py-2 relative">
                    <div className="flex flex-col gap-1">
                      <input 
                        type="date" 
                        value={h.lastBoughtAt ?? ""}
                        placeholder="yyyy-mm-dd"
                        onChange={e => updateHolding(i, 'lastBoughtAt', e.target.value || null)} 
                        className={`bg-slate-950 border rounded px-2 py-1 w-32 focus:text-slate-200 ${
                          h.sharesChangedFromPrior && !h.lastBoughtAt
                            ? 'border-amber-500 text-amber-400 placeholder-amber-700'
                            : 'border-slate-700 text-slate-400'
                        }`}
                      />
                      {h.sharesChangedFromPrior && !h.isCash && (
                        <span className="text-[10px] text-amber-500 font-medium">⚡ New/Changed</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input type="checkbox" checked={h.isCash} onChange={e => updateHolding(i, 'isCash', e.target.checked)} className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-blue-600" />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => removeHolding(i)} className="text-red-400 hover:text-red-300 transition-colors p-1" title="Remove"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
        <div className="p-4 bg-slate-900 border-t border-slate-800 flex justify-center">
          <button onClick={addHolding} className="text-sm font-medium text-blue-400 hover:text-blue-300 flex items-center transition-colors">
            <Plus className="w-4 h-4 mr-1" /> Add Empty Row
          </button>
        </div>
      </div>

      <div className="flex justify-end gap-3 flex-wrap">
        <button
          onClick={() => handleSubmit(true)}
          disabled={isSubmitting || (autoCorrectionsApplied && !acceptedCorrections)}
          className="inline-flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/50 hover:bg-slate-800 text-sm font-medium transition-colors text-slate-300 h-10 px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Save this snapshot but do not run the AI analysis yet. It will run automatically on the next daily schedule."
        >
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Save & Queue for Daily Run'}
        </button>
        <button
          onClick={() => handleSubmit(false)}
          disabled={isSubmitting || (autoCorrectionsApplied && !acceptedCorrections)}
          className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700 h-10 px-8 py-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(37,99,235,0.2)] hover:shadow-[0_0_25px_rgba(37,99,235,0.4)]"
          title={autoCorrectionsApplied && !acceptedCorrections ? "Please accept corrections first" : ""}
        >
          {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Save & Run Portfolio Check Now'}
        </button>
      </div>
    </div>
  );
}
