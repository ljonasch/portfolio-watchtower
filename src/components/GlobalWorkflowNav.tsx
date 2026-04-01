"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, User, Upload, Activity, FileText, RefreshCw, ChevronRight, Archive } from "lucide-react";

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
          <div key={i} className="flex items-center gap-2 flex-1 min-w-0 max-w-[150px]">
            <Link
              href={finalHref}
              className={`group flex items-center justify-center gap-2.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border flex-1 min-w-0
                ${isActive 
                  ? "bg-slate-800 border-slate-700 text-blue-400 shadow-sm" 
                  : isDone
                    ? "bg-transparent border-transparent text-slate-300 hover:bg-slate-800/50 hover:text-white"
                    : "bg-transparent border-transparent text-slate-500 hover:bg-slate-800/30 hover:text-slate-400"
                }
              `}
            >
              <span className="text-slate-500 text-xs font-bold leading-none">
                {i + 1}
              </span>
              <div className={`flex items-center justify-center rounded transition-colors
                ${isActive ? "text-blue-400" : isDone ? "text-green-500" : "text-slate-600"}
              `}>
                {isDone ? <Check className="w-4 h-4" /> : <StepIcon className="w-4 h-4" />}
              </div>
              <span className="hidden leading-none sm:inline truncate">
                {step.label}
              </span>
            </Link>
            
            {i < STEPS.length - 1 && (
              <ChevronRight className="w-3.5 h-3.5 text-slate-800 flex-shrink-0" />
            )}
          </div>
        );
      })}

      {/* ── Archives utility link ── */}
      <div className="w-px h-4 bg-slate-700 mx-2 flex-shrink-0" />
      <Link
        href="/archive"
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all border flex-shrink-0 ${
          pathname === "/archive"
            ? "bg-indigo-900/40 border-indigo-700/50 text-indigo-300"
            : "bg-transparent border-transparent text-slate-500 hover:bg-slate-800/30 hover:text-slate-400"
        }`}
      >
        <Archive className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Archives</span>
      </Link>
    </nav>
  );
}
