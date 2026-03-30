"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check } from "lucide-react";

const STEPS = [
  { label: "Profile", href: "/", matches: ["/", "/settings"] },
  { label: "Upload", href: "/upload", matches: ["/upload"] },
  { label: "Analyze", href: "/report/generate", matches: ["/report/generate"] },
  { label: "Report", href: "#", matches: ["/report/"] },
  { label: "Update", href: "/upload?mode=update", matches: ["?mode=update"] },
];

function getActiveStep(pathname: string, search?: string): number {
  if (pathname === "/" || pathname === "/settings") return 0;
  if (pathname.startsWith("/upload") && !search?.includes("mode=update")) return 1;
  if (pathname === "/report/generate") return 2;
  if (pathname.startsWith("/report/") && pathname !== "/report/generate") return 3;
  if (search?.includes("mode=update")) return 4;
  return -1;
}

export function GlobalWorkflowNav() {
  const pathname = usePathname();
  const current = getActiveStep(pathname);

  return (
    <nav className="flex items-center gap-0 min-w-0" aria-label="Workflow steps">
      {STEPS.map((step, i) => {
        const isDone = i < current;
        const isActive = i === current;

        return (
          <div key={i} className="flex items-center flex-1 min-w-0">
            <Link
              href={step.href}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap
                ${isActive ? "text-blue-300" : ""}
                ${isDone ? "text-slate-500 hover:text-slate-300" : ""}
                ${!isActive && !isDone ? "text-slate-600 hover:text-slate-400" : ""}
              `}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border flex-shrink-0
                ${isActive ? "border-blue-500 bg-blue-600 text-white" : ""}
                ${isDone ? "border-slate-700 bg-slate-800/80 text-slate-500" : ""}
                ${!isActive && !isDone ? "border-slate-800 bg-slate-900 text-slate-600" : ""}
              `}>
                {isDone ? <Check className="w-2.5 h-2.5" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </Link>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 mx-0.5 ${i < current ? "bg-slate-700" : "bg-slate-800/60"}`} />
            )}
          </div>
        );
      })}
    </nav>
  );
}
