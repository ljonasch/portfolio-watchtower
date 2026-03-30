import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Upload, Play, ShieldAlert, BadgeCheck, Settings, ArrowRight, BookOpen, Bell, Download, Clock, TrendingUp, TrendingDown, Minus, AlertCircle, History } from "lucide-react";
import { MissingInfoGate } from "@/components/MissingInfoGate";
import { DebugPanel } from "@/components/DebugPanel";
import { WeightChart } from "@/components/WeightChart";

export const dynamic = "force-dynamic";

const ALERT_COLORS = { none: "#22c55e", low: "#84cc16", medium: "#f59e0b", high: "#f97316", urgent: "#ef4444" } as const;
const ALERT_LABELS = { none: "Stable", low: "Minor Changes", medium: "Attention Needed", high: "Action Required", urgent: "Urgent" } as const;

type AlertLevel = keyof typeof ALERT_COLORS;

function ActionBadge({ action }: { action: string }) {
  const isAdd = action === "Buy" || action === "Add" || action.startsWith("Buy");
  const isSell = action === "Sell" || action === "Exit";
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${isAdd ? "bg-green-900/40 text-green-400" : isSell ? "bg-red-900/40 text-red-400" : "bg-slate-800 text-slate-400"}`}>
      {isAdd ? <TrendingUp className="w-3 h-3" /> : isSell ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
      {action}
    </span>
  );
}

export default async function Dashboard() {
  const profile = await prisma.userProfile.findFirst({ include: { user: true } });
  const recipients = await prisma.notificationRecipient.findMany({ where: { active: true } });

  const latestReport = await prisma.portfolioReport.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      recommendations: true,
      snapshot: { include: { holdings: true } },
      analysisRun: { include: { changeLogs: true } },
    },
  });

  const latestSnapshot = await prisma.portfolioSnapshot.findFirst({
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
  });

  // Latest scheduled run (independent of manual runs)
  const latestRun = await prisma.analysisRun.findFirst({
    orderBy: { startedAt: "desc" },
    include: { changeLogs: true },
  });

  const recentRuns = await prisma.analysisRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 5,
  });

  const notifSettings = await prisma.appSettings.findFirst({ where: { key: "notification_settings" } });
  const notifConfig = notifSettings ? JSON.parse(notifSettings.value) : {};

  const portfolioValue = latestSnapshot?.holdings.reduce((s, h) => s + (h.currentValue || h.shares * (h.currentPrice || 0)), 0) || 0;
  const age = profile ? new Date().getFullYear() - profile.birthYear : null;
  const alertLevel = (latestRun?.alertLevel ?? "none") as AlertLevel;

  const isProfileComplete = !!(profile?.trackedAccountObjective && profile?.trackedAccountRiskTolerance);

  // Check for missing required fields for notifications
  const missingFields: string[] = [];
  if (notifConfig.emailNotificationsEnabled !== false) {
    if (recipients.length === 0) missingFields.push("Notification email address (Settings → Notifications)");
    if (!profile?.birthYear) missingFields.push("Birth year (Settings → Profile)");
    if (!profile?.trackedAccountObjective) missingFields.push("Account objective (Settings → Profile)");
    if (!profile?.trackedAccountRiskTolerance) missingFields.push("Risk tolerance (Settings → Profile)");
  }

  // Weight chart data
  const weightChartData = latestReport?.recommendations.filter(r => r.ticker !== "CASH").map(r => ({
    ticker: r.ticker,
    current: Number(r.currentWeight.toFixed(1)),
    target: Number(r.targetWeight.toFixed(1)),
  })) ?? [];

  // Changes from latest run
  const latestChanges = (latestRun?.changeLogs ?? []).filter(c => c.changed);
  const adds = latestChanges.filter(c => c.newAction === "Add" || c.newAction === "Buy" || c.newAction?.startsWith("Buy")).slice(0, 3);
  const sells = latestChanges.filter(c => c.newAction === "Sell" || c.newAction === "Exit").slice(0, 3);

  // Next scheduled run (tomorrow at 8am)
  const nextRun = new Date();
  nextRun.setDate(nextRun.getDate() + 1);
  nextRun.setHours(notifConfig.dailyCheckHour ?? 8, 0, 0, 0);

  return (
    <div className="space-y-5">
      <MissingInfoGate missingFields={missingFields} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">Step 1 · Dashboard</h1>
          <p className="text-slate-400 mt-1 text-sm">
            {latestRun ? `Last run: ${latestRun.startedAt.toLocaleString()} · Next: ${nextRun.toLocaleString()}` : "No runs yet — run your first analysis"}
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <Link href="/history" className="inline-flex items-center gap-2 rounded-lg text-sm font-medium border border-slate-700 bg-transparent hover:bg-slate-800 text-slate-100 h-9 px-4 transition-colors">
            <History className="h-4 w-4" /> History
          </Link>
          {latestSnapshot && (
            <Link href="/report/generate" className="inline-flex items-center gap-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 h-9 px-4 transition-colors">
              <Play className="h-4 w-4" /> Run Analysis
            </Link>
          )}
          <Link href="/upload" className="inline-flex items-center gap-2 rounded-lg text-sm font-medium border border-slate-700 bg-transparent hover:bg-slate-800 text-slate-100 h-9 px-4 transition-colors">
            <Upload className="h-4 w-4" /> Upload Holdings
          </Link>
        </div>
      </div>

      {/* Alert + Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Alert Level */}
        <div className="rounded-xl border p-5" style={{ borderColor: ALERT_COLORS[alertLevel] + "40", background: ALERT_COLORS[alertLevel] + "08" }}>
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">Alert Status</div>
          <div className="mt-2 text-lg font-bold flex items-center gap-2" style={{ color: ALERT_COLORS[alertLevel] }}>
            <AlertCircle className="w-5 h-5" />
            {ALERT_LABELS[alertLevel]}
          </div>
          <p className="text-xs text-slate-500 mt-1 truncate">{latestRun?.alertReason ?? "No runs yet"}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">Portfolio Value</div>
          <div className="mt-2 text-lg font-bold">{portfolioValue > 0 ? `$${portfolioValue.toLocaleString()}` : "—"}</div>
          <p className="text-xs text-slate-500 mt-1">{latestSnapshot ? `${latestSnapshot.holdings.length} positions` : "No snapshot"}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">Profile</div>
          <div className="mt-2 text-lg font-bold flex items-center gap-2">
            {isProfileComplete ? <BadgeCheck className="text-green-500 h-5 w-5" /> : <ShieldAlert className="text-amber-500 h-5 w-5" />}
            {age ? `Age ${age}` : "—"}
          </div>
          <p className="text-xs text-slate-500 mt-1 truncate">{profile?.trackedAccountObjective ?? "Not configured"} · {profile?.trackedAccountRiskTolerance ?? "—"} risk</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="text-xs font-medium text-slate-400 uppercase tracking-wide">Notifications</div>
          <div className="mt-2 text-lg font-bold flex items-center gap-2">
            <Bell className={`w-5 h-5 ${recipients.length > 0 ? "text-blue-400" : "text-slate-600"}`} />
            {recipients.length > 0 ? "Active" : "Not set up"}
          </div>
          <p className="text-xs text-slate-500 mt-1 truncate">{recipients.map(r => r.email).join(", ") || "No recipients"}</p>
        </div>
      </div>

      {/* What Changed + Adds/Sells */}
      {latestChanges.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">What Changed Since Last Run</h2>
            <Link href={`/report/${latestReport?.id}`} className="text-xs text-blue-400 hover:text-blue-300">View full report →</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {adds.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Top Adds</p>
                <div className="space-y-1.5">
                  {adds.map(c => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{c.ticker}</span>
                      <span className="text-green-400 text-xs">{c.priorTargetShares ?? 0} → {c.newTargetShares} shares</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sells.length > 0 && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Top Trims / Exits</p>
                <div className="space-y-1.5">
                  {sells.map(c => (
                    <div key={c.id} className="flex items-center justify-between text-sm">
                      <span className="font-medium">{c.ticker}</span>
                      <span className="text-red-400 text-xs">{c.priorTargetShares ?? 0} → {c.newTargetShares} shares</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Weight chart */}
      {weightChartData.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">Holdings Weight: Current vs Target</h2>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-blue-500/60 inline-block" />Current</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-green-500/60 inline-block" />Target</span>
            </div>
          </div>
          <WeightChart data={weightChartData} />
        </div>
      )}

      {/* Latest Recommendations */}
      {latestReport ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">Latest Recommendations</h2>
            <div className="flex items-center gap-3">
              <a href="/api/export/runs" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
                <Download className="w-3 h-3" /> Run history CSV
              </a>
              <Link href={`/report/${latestReport.id}`} className="text-xs text-blue-400 hover:text-blue-300 font-medium">
                View full report →
              </Link>
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-900 text-slate-400 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Ticker</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium text-right">Target Wgt</th>
                  <th className="px-4 py-2.5 font-medium text-right">Target Shares</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-900/20">
                {latestReport.recommendations.map(rec => (
                  <tr key={rec.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-4 py-2.5 font-bold">{rec.ticker}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{rec.role}</td>
                    <td className="px-4 py-2.5 text-right">{rec.targetWeight.toFixed(1)}%</td>
                    <td className="px-4 py-2.5 text-right">{rec.targetShares}</td>
                    <td className="px-4 py-2.5"><ActionBadge action={rec.action} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center p-12 border border-dashed border-slate-800 rounded-2xl bg-slate-900/20 text-center">
          <Upload className="w-10 h-10 text-slate-600 mb-4" />
          <h2 className="text-lg font-semibold mb-2">No holdings yet</h2>
          <p className="text-slate-400 text-sm max-w-xs mb-6">Upload a screenshot of your brokerage account to get your first automated analysis.</p>
          <Link href="/upload" className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors text-sm">
            <Upload className="w-4 h-4" /> Upload Holdings
          </Link>
        </div>
      )}

      {/* Run History */}
      {recentRuns.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold flex items-center gap-2"><Clock className="w-4 h-4 text-slate-400" />Run History</h2>
            <a href="/api/export/runs" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
              <Download className="w-3 h-3" /> CSV
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left py-1.5 pr-4 font-medium">Date</th>
                  <th className="text-left py-1.5 pr-4 font-medium">Trigger</th>
                  <th className="text-left py-1.5 pr-4 font-medium">Alert</th>
                  <th className="text-left py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {recentRuns.map(run => {
                  const level = (run.alertLevel ?? "none") as AlertLevel;
                  return (
                    <tr key={run.id} className="hover:bg-slate-800/20">
                      <td className="py-2 pr-4 text-slate-300">{run.startedAt.toLocaleDateString()}</td>
                      <td className="py-2 pr-4">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${run.triggerType === "manual" || run.triggerType === "debug" ? "bg-purple-900/40 text-purple-400" : "bg-slate-800 text-slate-400"}`}>
                          {run.triggerType}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className="font-medium" style={{ color: ALERT_COLORS[level] }}>{ALERT_LABELS[level]}</span>
                      </td>
                      <td className="py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs ${run.status === "complete" ? "bg-green-900/40 text-green-400" : run.status === "failed" ? "bg-red-900/40 text-red-400" : "bg-blue-900/40 text-blue-400"}`}>
                          {run.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex gap-3 pt-1">
            <a href="/api/export/changes" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
              <Download className="w-3 h-3" /> Changes CSV
            </a>
            <a href="/api/export/alerts" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
              <Download className="w-3 h-3" /> Alerts CSV
            </a>
            <a href="/api/export/notifications" className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition-colors">
              <Download className="w-3 h-3" /> Notifications CSV
            </a>
          </div>
        </div>
      )}

      {/* Profile status + Why this fits */}
      <div className={`rounded-xl border p-5 flex items-start gap-4 ${isProfileComplete ? "border-slate-800 bg-slate-900/30" : "border-amber-700/30 bg-amber-900/10"}`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isProfileComplete ? "bg-green-600/20 border border-green-600/30" : "bg-amber-600/20 border border-amber-600/30"}`}>
          {isProfileComplete ? <BadgeCheck className="w-5 h-5 text-green-400" /> : <Settings className="w-5 h-5 text-amber-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm">{isProfileComplete ? "Profile configured" : "Profile not set up"}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {isProfileComplete
              ? `Age ${age} · ${profile?.trackedAccountRiskTolerance} risk · ${profile?.trackedAccountObjective} · ${profile?.trackedAccountTaxStatus ?? "Tax status not set"}`
              : "Fill in your profile so the AI can tailor recommendations to your goals, tax situation, and risk tolerance."}
          </p>
          {latestReport?.reasoning && isProfileComplete && (
            <details className="mt-2">
              <summary className="text-xs text-blue-400 cursor-pointer hover:text-blue-300 select-none">Why this fits your profile ▾</summary>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{latestReport.reasoning}</p>
            </details>
          )}
        </div>
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 transition-colors flex-shrink-0">
          {isProfileComplete ? "Edit" : "Set up"} <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Footer links */}
      <div className="flex items-center gap-6 text-xs text-slate-500 pt-1">
        <Link href="/how-it-works" className="flex items-center gap-1.5 hover:text-slate-300 transition-colors">
          <BookOpen className="w-3.5 h-3.5" /> How this system works
        </Link>
        <a href="/api/export/holdings" className="flex items-center gap-1.5 hover:text-slate-300 transition-colors">
          <Download className="w-3.5 h-3.5" /> Export holdings history
        </a>
      </div>

      {/* Debug panel */}
      <DebugPanel hasSnapshot={!!latestSnapshot} recipients={recipients.map(r => ({ id: r.id, email: r.email }))} />
    </div>
  );
}
