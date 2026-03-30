import Link from "next/link";
import { Check } from "lucide-react";

const STEPS = [
  { label: "Profile", href: "/settings" },
  { label: "Upload", href: "/upload" },
  { label: "Analyze", href: "/report/generate" },
  { label: "Report", href: "#" },
  { label: "Update", href: "/upload?mode=update" },
];

export function WorkflowSteps({ current }: { current: 0 | 1 | 2 | 3 | 4 }) {
  return (
    <nav className="flex items-center gap-0 w-full overflow-x-auto pb-1" aria-label="Workflow steps">
      {STEPS.map((step, i) => {
        const isDone = i < current;
        const isActive = i === current;
        return (
          <div key={i} className="flex items-center flex-1 min-w-0">
            <Link
              href={step.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0
                ${isActive ? "bg-blue-600/20 text-blue-300 border border-blue-500/40" : ""}
                ${isDone ? "text-slate-400 hover:text-slate-200" : ""}
                ${!isActive && !isDone ? "text-slate-600 pointer-events-none" : ""}
              `}
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border flex-shrink-0
                ${isActive ? "border-blue-500 bg-blue-600 text-white" : ""}
                ${isDone ? "border-slate-600 bg-slate-800 text-slate-400" : ""}
                ${!isActive && !isDone ? "border-slate-800 bg-slate-900 text-slate-700" : ""}
              `}>
                {isDone ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              {step.label}
            </Link>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 mx-1 ${i < current ? "bg-slate-600" : "bg-slate-800"}`} />
            )}
          </div>
        );
      })}
    </nav>
  );
}
