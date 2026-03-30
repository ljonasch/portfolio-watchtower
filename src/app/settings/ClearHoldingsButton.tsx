"use client";

import { useState } from "react";
import { Trash2, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

export function ClearHoldingsButton() {
  const [stage, setStage] = useState<"idle" | "confirm" | "clearing" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleConfirm = async () => {
    setStage("clearing");
    try {
      const res = await fetch("/api/data/clear-holdings", { method: "DELETE" });
      const data = await res.json();
      if (data.ok) {
        setMessage(`Deleted ${data.deleted} snapshot${data.deleted !== 1 ? "s" : ""} and all associated holdings, reports, and recommendations.`);
        setStage("done");
      } else {
        setMessage(data.error ?? "Something went wrong.");
        setStage("error");
      }
    } catch (e: any) {
      setMessage(e.message ?? "Unknown error");
      setStage("error");
    }
  };

  return (
    <div className="rounded-xl border border-red-900/40 bg-red-950/10 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-400" />
        <h3 className="text-sm font-semibold text-red-300">Danger Zone</h3>
      </div>

      {/* Row */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-semibold text-slate-200">Delete History</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Permanently deletes all portfolio snapshots, holdings, analysis reports, and recommendations.
            <br />
            <span className="text-slate-600">Your profile and notification settings are not affected.</span>
          </p>
        </div>

        {stage === "idle" && (
          <button
            onClick={() => setStage("confirm")}
            className="flex-shrink-0 inline-flex items-center gap-2 text-sm font-medium text-red-400 border border-red-800/50 hover:bg-red-900/20 rounded-lg px-3 py-2 transition-colors whitespace-nowrap"
          >
            <Trash2 className="w-4 h-4" />
            Delete History
          </button>
        )}

        {stage === "clearing" && (
          <span className="flex-shrink-0 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Deleting…
          </span>
        )}
      </div>

      {/* Confirmation prompt */}
      {stage === "confirm" && (
        <div className="rounded-lg border border-red-700/50 bg-red-900/20 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-200 font-medium">
              Are you sure? This cannot be undone.
            </p>
          </div>
          <p className="text-xs text-slate-400 pl-6">
            All portfolio snapshots, holdings, reports, and AI recommendations will be permanently deleted. You will need to re-upload your holdings to run a new analysis.
          </p>
          <div className="flex gap-2 pl-6">
            <button
              onClick={() => setStage("idle")}
              className="text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-slate-100 hover:border-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Yes, delete everything
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {(stage === "done" || stage === "error") && (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${stage === "done" ? "bg-green-900/20 border border-green-800/40 text-green-300" : "bg-red-900/20 border border-red-800/40 text-red-300"}`}>
          {stage === "done"
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          {message}
        </div>
      )}
    </div>
  );
}
