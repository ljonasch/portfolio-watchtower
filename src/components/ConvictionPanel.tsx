"use client";

import { useState, useTransition } from "react";
import { MessageSquareQuote, Pencil, X, Check, ChevronDown, ChevronUp, ShieldAlert } from "lucide-react";

type Conviction = {
  id: string;
  ticker: string;
  rationale: string;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  ticker: string;
  conviction: Conviction | null;
  /** Optional: AI counterpoint text (from detailedReasoning) */
  counterpoint?: string;
  /** Compact mode = just a small indicator badge */
  compact?: boolean;
};

// ─── Compact badge for use inside the table ───────────────────────────────────

function ConvictionBadge({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="You have a conviction note attached to this position"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors cursor-pointer"
    >
      <MessageSquareQuote className="w-2.5 h-2.5" />
      Conviction
    </button>
  );
}

// ─── Evidence quality badge ───────────────────────────────────────────────────

export function EvidenceBadge({ quality }: { quality: string | null }) {
  if (!quality) return null;
  const cfg: Record<string, { label: string; cls: string }> = {
    high:   { label: "Evidence: High",   cls: "bg-green-500/15 text-green-400 border-green-500/30" },
    medium: { label: "Evidence: Medium", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    low:    { label: "Evidence: Low",    cls: "bg-red-500/15 text-red-400 border-red-500/30" },
    mixed:  { label: "Evidence: Mixed",  cls: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  };
  const q = quality.toLowerCase();
  const c = cfg[q] ?? cfg["mixed"];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${c.cls} whitespace-nowrap`}>
      {c.label}
    </span>
  );
}

// ─── Position status badge ────────────────────────────────────────────────────

export function PositionStatusBadge({ status }: { status: string | null }) {
  if (!status || status === "on_target") return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border whitespace-nowrap ${
      status === "underweight"
        ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
        : "bg-orange-500/15 text-orange-400 border-orange-500/30"
    }`}>
      {status === "underweight" ? "↑ Underweight" : "↓ Overweight"}
    </span>
  );
}

// ─── Full conviction panel (used inside report rows) ─────────────────────────

export function ConvictionPanel({
  ticker,
  conviction,
  counterpoint,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(!conviction);
  const [text, setText] = useState(conviction?.rationale ?? "");
  const [saved, setSaved] = useState<Conviction | null>(conviction);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!text.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/convictions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker, rationale: text }),
        });
        if (!res.ok) throw new Error("Save failed");
        const data = await res.json();
        setSaved(data.conviction);
        setEditing(false);
      } catch (e: any) {
        setError(e.message);
      }
    });
  };

  const retire = () => {
    startTransition(async () => {
      await fetch(`/api/convictions/${ticker}`, { method: "DELETE" });
      setSaved(null);
      setText("");
      setEditing(false);
      setOpen(false);
    });
  };

  // Extract counterpoint from detailedReasoning if present
  const extractedCounterpoint = (() => {
    if (!counterpoint) return null;
    const idx = counterpoint.indexOf("COUNTERPOINT:");
    if (idx === -1) return null;
    return counterpoint.slice(idx + 13).split(/\n\n|ACKNOWLEDGMENT:/)[0].trim();
  })();

  if (compact && !open) {
    return saved ? (
      <ConvictionBadge onClick={() => setOpen(true)} />
    ) : (
      <button
        onClick={() => setOpen(true)}
        title="Add a conviction note for this position"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-600 hover:text-slate-400 hover:bg-slate-800 transition-colors border border-transparent hover:border-slate-700"
      >
        <Pencil className="w-2.5 h-2.5" />
        Note
      </button>
    );
  }

  return (
    <div className={`${compact ? "fixed inset-0 z-50 flex items-center justify-center bg-black/60" : ""}`}>
      {compact && (
        <div
          className="absolute inset-0"
          onClick={() => { setOpen(false); setEditing(!!saved ? false : false); }}
        />
      )}
      <div className={`${compact ? "relative z-10 w-full max-w-lg mx-4" : ""} bg-slate-900 border border-amber-500/30 rounded-xl p-4 space-y-3 shadow-2xl`}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquareQuote className="w-4 h-4 text-amber-400" />
            <span className="font-semibold text-slate-200 text-sm">
              Your Conviction — <span className="text-amber-400">{ticker}</span>
            </span>
            {saved && (
              <span className="text-[10px] text-slate-500 bg-slate-800 px-2 py-0.5 rounded-full">
                Active · re-injected every run
              </span>
            )}
          </div>
          {compact && (
            <button
              onClick={() => { setOpen(false); setEditing(false); }}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content */}
        {editing || !saved ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              Explain why you hold this position or why you disagree with the AI's recommendation.
              This note will be re-injected into every future analysis run. The AI will acknowledge
              your reasoning directly and provide counterpoints if it disagrees.
            </p>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={4}
              placeholder={`e.g. "I believe ${ticker} has a multi-year structural tailwind from AI infrastructure spending that justifies holding despite near-term volatility."`}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={!text.trim() || isPending}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
              >
                <Check className="w-3 h-3" />
                {isPending ? "Saving…" : "Save Conviction"}
              </button>
              {saved && (
                <button
                  onClick={() => setEditing(false)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <blockquote className="border-l-2 border-amber-500/50 pl-3 text-sm text-slate-300 italic leading-relaxed">
              "{saved.rationale}"
            </blockquote>
            <p className="text-[10px] text-slate-600">
              Saved {new Date(saved.updatedAt).toLocaleDateString()} · Active in every analysis run
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
              <button
                onClick={retire}
                disabled={isPending}
                className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-400 transition-colors disabled:opacity-50"
              >
                <X className="w-3 h-3" /> Retire
              </button>
            </div>
          </div>
        )}

        {/* AI Counterpoint */}
        {extractedCounterpoint && (
          <div className="bg-red-950/20 border border-red-500/20 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">AI Counterpoint</span>
            </div>
            <p className="text-xs text-red-200/80 leading-relaxed">{extractedCounterpoint}</p>
          </div>
        )}
      </div>
    </div>
  );
}
