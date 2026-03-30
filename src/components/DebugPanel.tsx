"use client";

import { useState } from "react";
import { Loader2, Play, Send, RefreshCw, CheckCircle2, XCircle, Bug } from "lucide-react";

interface Recipient { id: string; email: string; }

interface DebugPanelProps {
  hasSnapshot: boolean;
  recipients: Recipient[];
}

export function DebugPanel({ hasSnapshot, recipients }: DebugPanelProps) {
  const [open, setOpen] = useState(false);
  const [runStatus, setRunStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [runMsg, setRunMsg] = useState("");
  const [notifType, setNotifType] = useState<"test" | "daily_alert" | "weekly_summary">("test");
  const [notifStatus, setNotifStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [notifMsg, setNotifMsg] = useState("");

  const runManualCheck = async () => {
    setRunStatus("running");
    setRunMsg("");
    try {
      const res = await fetch("/api/run/manual", { method: "POST" });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        const lines = text.split("\n").filter(l => l.startsWith("data:"));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(5));
            if (data.error) { setRunStatus("error"); setRunMsg(data.error); return; }
            if (data.done) {
              setRunStatus("done");
              setRunMsg(`Run complete! Alert level: ${data.alertLevel}. Report saved.`);
              setTimeout(() => window.location.reload(), 1500);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setRunStatus("error");
      setRunMsg(e.message ?? "Unknown error");
    }
  };

  const sendTestNotification = async () => {
    setNotifStatus("sending");
    setNotifMsg("");
    try {
      const res = await fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: notifType }),
      });
      const data = await res.json();
      if (data.error) { setNotifStatus("error"); setNotifMsg(data.error); return; }
      const results: { email: string; ok: boolean; error?: string }[] = data.results ?? [];
      const allOk = results.every(r => r.ok);
      setNotifStatus(allOk ? "done" : "error");
      setNotifMsg(results.map(r => `${r.email}: ${r.ok ? "✓ Sent" : `✗ ${r.error}`}`).join(" · "));
    } catch (e: any) {
      setNotifStatus("error");
      setNotifMsg(e.message ?? "Unknown error");
    }
  };

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 transition-colors"
      >
        <span className="flex items-center gap-2"><Bug className="w-4 h-4" /> Debug &amp; Manual Triggers</span>
        <span className="text-xs">{open ? "▲ Collapse" : "▼ Expand"}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 space-y-5 border-t border-slate-800">
          {/* Manual run */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">Run Daily Check Now</h3>
            <p className="text-xs text-slate-500">Executes the same code path as the scheduled daily run. Stores an AnalysisRun, report, and change log. Marked as "manual" trigger.</p>
            <button
              onClick={runManualCheck}
              disabled={!hasSnapshot || runStatus === "running"}
              className="inline-flex items-center gap-2 text-sm font-medium bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/40 text-blue-300 rounded-lg px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {runStatus === "running" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {runStatus === "running" ? "Running analysis…" : "Run daily check now"}
            </button>
            {runMsg && (
              <div className={`flex items-center gap-2 text-xs ${runStatus === "done" ? "text-green-400" : "text-red-400"}`}>
                {runStatus === "done" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                {runMsg}
              </div>
            )}
          </div>

          {/* Notification send */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-300">Send Test Notification</h3>
            <p className="text-xs text-slate-500">Sends to all active notification recipients. Logged as debug/manual in notification history.</p>
            <div className="flex gap-2 flex-wrap">
              {(["test", "daily_alert", "weekly_summary"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setNotifType(t)}
                  className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${notifType === t ? "bg-purple-600/30 border-purple-500/50 text-purple-300" : "border-slate-700 text-slate-400 hover:border-slate-600"}`}
                >
                  {t === "test" ? "Test email" : t === "daily_alert" ? "Latest daily alert" : "Weekly summary"}
                </button>
              ))}
            </div>
            <button
              onClick={sendTestNotification}
              disabled={recipients.length === 0 || notifStatus === "sending"}
              className="inline-flex items-center gap-2 text-sm font-medium bg-purple-600/20 hover:bg-purple-600/30 border border-purple-600/40 text-purple-300 rounded-lg px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {notifStatus === "sending" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {notifStatus === "sending" ? "Sending…" : `Send ${notifType.replace("_", " ")} to ${recipients.length} recipient${recipients.length !== 1 ? "s" : ""}`}
            </button>
            {recipients.length === 0 && <p className="text-xs text-amber-400">⚠ No notification recipients set up — add emails in Settings → Notifications.</p>}
            {notifMsg && (
              <div className={`flex items-start gap-2 text-xs ${notifStatus === "done" ? "text-green-400" : "text-red-400"}`}>
                {notifStatus === "done" ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                {notifMsg}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
