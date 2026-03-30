import { HOW_IT_WORKS_SECTIONS, LAST_UPDATED, VERSION } from "@/lib/how-it-works";
import Link from "next/link";
import { ArrowLeft, BookOpen } from "lucide-react";

export const metadata = {
  title: "How This System Works — Portfolio Watchtower",
  description: "A plain-English explanation of what Portfolio Watchtower does and how it works behind the scenes.",
};

export default function HowItWorksPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 hover:text-slate-200 transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-blue-400" />
          <h1 className="text-2xl font-bold">How This System Works</h1>
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Plain-English explanation · No jargon · Written for non-technical users
        </p>
        <span className="text-xs text-slate-600 font-mono">
          {VERSION} · Updated {LAST_UPDATED}
        </span>
      </div>

      <div className="space-y-6">
        {HOW_IT_WORKS_SECTIONS.map((section) => (
          <div key={section.id} className="bg-slate-900/30 border border-slate-800 rounded-xl p-6 space-y-3">
            <h2 className="text-lg font-semibold text-slate-100">{section.title}</h2>
            <div className="text-sm text-slate-300 leading-relaxed space-y-2">
              {section.body.split("\n\n").map((para, i) => {
                // Render bold markdown **text**
                const rendered = para.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
                return (
                  <p
                    key={i}
                    className={para.startsWith("-") || para.startsWith("✅") || para.startsWith("❌")
                      ? "pl-2 border-l-2 border-slate-700"
                      : ""}
                    dangerouslySetInnerHTML={{ __html: rendered }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="text-center pt-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
