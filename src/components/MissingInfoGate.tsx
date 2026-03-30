"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

interface MissingInfoGateProps {
  missingFields: string[];
}

export function MissingInfoGate({ missingFields }: MissingInfoGateProps) {
  const [open, setOpen] = useState(missingFields.length > 0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-amber-500/40 rounded-2xl p-6 max-w-md w-full shadow-[0_0_60px_rgba(245,158,11,0.15)] space-y-4 animate-in fade-in zoom-in duration-300">
        <div className="flex items-start justify-between gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-xl">⚠️</span>
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-slate-100 text-base">Required Information Missing</h3>
            <p className="text-sm text-slate-400 mt-1">
              The following information is needed before notifications can be sent. You can update these anytime in{" "}
              <strong className="text-slate-200">Profile / Settings</strong>.
            </p>
          </div>
        </div>
        <ul className="space-y-1.5 pl-1">
          {missingFields.map((field) => (
            <li key={field} className="flex items-center gap-2 text-sm text-amber-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
              {field}
            </li>
          ))}
        </ul>
        <div className="flex gap-3 pt-1">
          <a
            href="/settings"
            className="flex-1 text-center text-sm font-semibold bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-lg px-4 py-2 transition-colors"
          >
            Go to Settings →
          </a>
          <button
            onClick={() => setOpen(false)}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 border border-slate-700 rounded-lg transition-colors"
          >
            OK, later
          </button>
        </div>
      </div>
    </div>
  );
}
