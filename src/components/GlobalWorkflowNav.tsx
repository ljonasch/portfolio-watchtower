"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, User, Upload, Activity, FileText, RefreshCw, ChevronRight } from "lucide-react";

const STEPS = [
  { label: "Profile", href: "/", matches: ["/", "/settings"], icon: User },
  { label: "Upload", href: "/upload", matches: ["/upload"], icon: Upload },
  { label: "Analyze", href: "/report/generate", matches: ["/report/generate"], icon: Activity },
  { label: "Report", href: "/report", matches: ["/report/"], icon: FileText },
  { label: "Update", href: "/upload?mode=update", matches: ["?mode=update"], icon: RefreshCw },
];

function getActiveStep(pathname: string, search?: string): number {
  if (pathname === "/" || pathname === "/settings") return 0;
  if (pathname.startsWith("/upload") && !search?.includes("mode=update")) return 1;
  if (pathname === "/report/generate") return 2;
  if (pathname.startsWith("/report/") && pathname !== "/report/generate") return 3;
  if (search?.includes("mode=update")) return 4;
  return -1;
}

export function GlobalWorkflowNav({ latestReportId }: { latestReportId?: string }) {
  const pathname = usePathname();
  const current = getActiveStep(pathname);

  return (
    <nav className="flex items-center gap-1 min-w-0" aria-label="Workflow progress">
      {STEPS.map((step, i) => {
        const isDone = i < current;
        const isActive = i === current;
        const StepIcon = step.icon;
        
        // Resolve the link for the report step
        const isReportStep = step.label === "Report";
        const finalHref = isReportStep 
          ? (latestReportId ? `/report/${latestReportId}` : "/history")
          : step.href;

        return (
          <div key={i} className="flex items-center gap-1 flex-1 min-w-0 max-w-[160px]">
            <Link
              href={finalHref}
              className={`group flex items-center justify-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-bold transition-all border flex-1 min-w-0
                ${isActive 
                  ? "bg-blue-600 border-blue-400 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]" 
                  : isDone
                    ? "bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-700/80 hover:border-slate-600"
                    : "bg-slate-900 border-slate-800 text-slate-500 hover:bg-slate-800 hover:border-slate-700 hover:text-slate-400"
                }
              `}
            >
              <span className="opacity-60 text-[10px] sm:inline hidden">({i + 1})</span>
              <div className={`flex items-center justify-center rounded p-1 transition-colors
                ${isActive ? "bg-white/20" : isDone ? "bg-slate-700/50" : "bg-slate-800/80"}
              `}>
                {isDone ? <Check className="w-3 h-3 text-green-400" /> : <StepIcon className={`w-3 h-3 ${isActive ? "text-white" : "text-slate-500"}`} />}
              </div>
              <span className="hidden leading-none sm:inline truncate">
                {step.label}
              </span>
            </Link>
            
            {i < STEPS.length - 1 && (
              <ChevronRight className="w-3 h-3 text-slate-700 flex-shrink-0" />
            )}
          </div>
        );
      })}
    </nav>
  );
}
