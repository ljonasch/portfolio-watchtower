"use client";

import { useState } from "react";
import { Archive, Loader2, AlertTriangle, CheckCircle2, Tag } from "lucide-react";

export function ArchivePortfolioButton() {
  const [stage, setStage] = useState<"idle" | "confirm" | "archiving" | "done" | "error">("idle");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState("");

  const handleArchive = async () => {
    setStage("archiving");
    try {
      const res = await fetch("/api/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || null }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage(
          `Archived ${data.archived} snapshot${data.archived !== 1 ? "s" : ""}` +
          (data.label ? ` as "${data.label}"` : "") +
          `. Accessible in Portfolio Archives.`
        );
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
    <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/10 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Archive className="w-4 h-4 text-indigo-400" />
        <h3 className="text-sm font-semibold text-indigo-300">Portfolio Archive</h3>
      </div>

      {/* Row */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <p className="text-sm font-semibold text-slate-200">Archive Current Portfolio</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Preserves all current snapshots, holdings, analysis reports, and recommendations in a searchable archive.
            <br />
            <span className="text-slate-600">Your active portfolio is cleared for a fresh start. Nothing is permanently deleted.</span>
          </p>
        </div>

        {stage === "idle" && (
          <button
            onClick={() => setStage("confirm")}
            className="flex-shrink-0 inline-flex items-center gap-2 text-sm font-medium text-indigo-400 border border-indigo-800/50 hover:bg-indigo-900/20 rounded-lg px-3 py-2 transition-colors whitespace-nowrap"
          >
            <Archive className="w-4 h-4" />
            Archive Portfolio
          </button>
        )}

        {stage === "archiving" && (
          <span className="flex-shrink-0 flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Archiving…
          </span>
        )}
      </div>

      {/* Confirmation */}
      {stage === "confirm" && (
        <div className="rounded-lg border border-indigo-700/40 bg-indigo-900/15 p-4 space-y-3">
          <p className="text-sm text-indigo-200 font-medium">
            Archive your current portfolio?
          </p>
          <p className="text-xs text-slate-400">
            Your snapshots, holdings, reports, and AI recommendations will be preserved in the archive
            and accessible from the <strong className="text-slate-300">Archives</strong> page.
            Your active portfolio will be cleared so you can upload a new one.
          </p>

          {/* Optional label */}
          <div className="flex items-center gap-2">
            <Tag className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Optional label, e.g. Q1 2026 snapshot"
              className="flex-1 text-xs bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/60"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStage("idle")}
              className="text-sm px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:text-slate-100 hover:border-slate-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleArchive}
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              <Archive className="w-4 h-4" />
              Archive & Clear Active
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {(stage === "done" || stage === "error") && (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${
          stage === "done"
            ? "bg-green-900/20 border border-green-800/40 text-green-300"
            : "bg-red-900/20 border border-red-800/40 text-red-300"
        }`}>
          {stage === "done"
            ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            : <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
          <span>{message}</span>
          {stage === "done" && (
            <a href="/archive" className="ml-auto underline text-indigo-400 hover:text-indigo-300 whitespace-nowrap">
              View Archives →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
