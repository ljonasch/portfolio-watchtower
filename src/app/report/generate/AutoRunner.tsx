"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Globe, Brain, BarChart2, FileText, CheckCircle2 } from "lucide-react";

const STEPS = [
  {
    icon: Globe,
    label: "Macro & geopolitical search",
    detail: "Fed policy, CPI, trade disputes, energy shocks",
    color: "text-amber-400",
  },
  {
    icon: BarChart2,
    label: "Company-specific research",
    detail: "Earnings, analyst ratings, guidance per ticker",
    color: "text-blue-400",
  },
  {
    icon: FileText,
    label: "Sector & regulatory scan",
    detail: "AI regulation, defense spending, FDA, antitrust",
    color: "text-purple-400",
  },
  {
    icon: Brain,
    label: "Generating recommendations",
    detail: "Cross-referencing profile, running risk models",
    color: "text-green-400",
  },
];

export function AutoRunner({ snapshotId }: { snapshotId: string }) {
  // stepIndex: which step is currently ACTIVE (in progress)
  // completedSteps: set of step indices that have finished
  const [stepIndex, setStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId }),
      });

      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done || cancelled) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6));

            if (payload.error) {
              setError(payload.error);
              return;
            }

            if (payload.reportId) {
              // All done — mark last step complete and navigate
              setCompletedSteps(prev => new Set([...prev, 3]));
              router.push(`/report/${payload.reportId}`);
              return;
            }

            if (typeof payload.step === "number") {
              const s = payload.step;
              if (s <= 2) {
                // Search completed: mark it done, move active indicator to next
                setCompletedSteps(prev => new Set([...prev, s]));
                setStepIndex(s + 1 < STEPS.length ? s + 1 : s);
              } else if (s === 3) {
                // AI analysis has started
                setStepIndex(3);
              }
            }
          } catch {
            // malformed SSE line, skip
          }
        }
      }
    }

    run().catch(err => setError(err.message));
    return () => { cancelled = true; };
  }, [snapshotId, router]);

  if (error) {
    return (
      <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-xl p-4 text-center">
        Analysis failed: {error}
      </div>
    );
  }

  const currentStep = STEPS[stepIndex];
  const Icon = currentStep.icon;

  return (
    <div className="flex flex-col items-center gap-6 py-6">
      {/* Spinner */}
      <div className="w-16 h-16 rounded-full border border-slate-700 bg-slate-900 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>

      {/* Active step callout */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl px-5 py-3.5 flex items-center gap-3 min-w-[300px]">
        <Icon className={`w-5 h-5 flex-shrink-0 ${currentStep.color}`} />
        <div className="text-left">
          <p className={`text-sm font-semibold ${currentStep.color}`}>{currentStep.label}</p>
          <p className="text-xs text-slate-500 mt-0.5">{currentStep.detail}</p>
        </div>
        <Loader2 className="w-3.5 h-3.5 text-slate-600 animate-spin ml-auto flex-shrink-0" />
      </div>

      {/* Step list */}
      <div className="w-full max-w-sm space-y-1.5">
        {STEPS.map((step, i) => {
          const S = step.icon;
          const isDone = completedSteps.has(i);
          const isActive = i === stepIndex && !isDone;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-2 rounded-lg transition-all duration-300 ${
                isActive ? "bg-slate-800/80 border border-slate-600" :
                isDone ? "opacity-50" : "opacity-20"
              }`}
            >
              {isDone
                ? <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                : <S className={`w-4 h-4 flex-shrink-0 ${isActive ? step.color : "text-slate-500"}`} />
              }
              <p className={`text-xs font-medium flex-1 ${isActive ? "text-slate-200" : isDone ? "text-slate-500 line-through" : "text-slate-600"}`}>
                {step.label}
              </p>
              {isActive && <Loader2 className="w-3 h-3 text-slate-500 animate-spin flex-shrink-0" />}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-600 max-w-xs text-center">
        3 independent web searches + AI analysis. Do not close this tab.
      </p>
    </div>
  );
}
