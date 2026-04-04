"use client";

import { useState } from "react";
import { Brain } from "lucide-react";
import { AnalysisProgress } from "./AnalysisProgress";

export function AutoRunner({ snapshotId }: { snapshotId: string }) {
  const [started, setStarted] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [useLiteCandidateScreening, setUseLiteCandidateScreening] = useState(false);

  if (!started) {
    return (
      <div className="flex flex-col gap-6 w-full max-w-lg mx-auto mt-4 px-4 sm:px-0">
        <div className="space-y-3">
          <label htmlFor="custom-instructions" className="text-sm font-semibold text-slate-300">
            Custom Analysis Instructions (Optional)
          </label>
          <textarea
            id="custom-instructions"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g. 'Sell from my entire portfolio by 20%' or 'Keep TSLA at exactly its current allocation, do not sell'."
            className="w-full bg-slate-900/60 border border-slate-700/80 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/80 transition-all resize-none h-28"
          />
          <p className="text-xs text-slate-500 leading-relaxed px-1">
            Anything entered here will be treated as an absolute constraint by the AI during portfolio analysis.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-slate-700/80 bg-slate-900/40 px-4 py-3 text-left">
          <input
            type="checkbox"
            checked={useLiteCandidateScreening}
            onChange={(e) => setUseLiteCandidateScreening(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500 focus:ring-blue-500/50"
          />
          <span className="space-y-1">
            <span className="block text-sm font-semibold text-slate-200">
              Use Lite candidate screening
            </span>
            <span className="block text-xs leading-relaxed text-slate-500">
              Normal candidate screening is the default. Lite reuses more prior screening context and narrows macro-lane breadth for this manual run only.
            </span>
          </span>
        </label>

        <button
          onClick={() => setStarted(true)}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold rounded-xl py-3.5 shadow-[0_0_20px_rgba(59,130,246,0.2)] hover:shadow-[0_0_25px_rgba(59,130,246,0.3)] transition-all flex items-center justify-center gap-2"
        >
          <Brain className="w-5 h-5" />
          Start Deep Analysis
        </button>
      </div>
    );
  }

  return (
    <AnalysisProgress
      snapshotId={snapshotId}
      customPrompt={customPrompt.trim() || undefined}
      candidateScreeningMode={useLiteCandidateScreening ? "lite" : "normal"}
    />
  );
}
