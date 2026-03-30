"use client";

import { useState } from "react";
import { Plus, Trash2, Bell, Save, Mail, CheckCircle2, Loader2, Clock } from "lucide-react";
import type { NotificationRecipient } from "@prisma/client";

interface NotifSettings {
  dailyChecksEnabled: boolean;
  emailNotificationsEnabled: boolean;
  browserNotificationsEnabled: boolean;
  weeklySummaryDay: number;
  weeklySummaryHour: number;
  dailyCheckHour: number;
  alertThreshold: string;
}

interface NotificationsFormProps {
  recipients: NotificationRecipient[];
  notifSettings: NotifSettings;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function NotificationsForm({ recipients: initialRecipients, notifSettings: initialSettings }: NotificationsFormProps) {
  const [recipients, setRecipients] = useState(initialRecipients);
  const [settings, setSettings] = useState(initialSettings);
  const [newEmail, setNewEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [saving, setSaving] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [removingId, setRemovingId] = useState<string | null>(null);

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const addRecipient = async () => {
    if (!validateEmail(newEmail)) { setEmailError("Please enter a valid email address"); return; }
    setEmailError("");
    try {
      const res = await fetch("/api/settings/recipients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail }),
      });
      const r = await res.json();
      if (r.id) { setRecipients(prev => [...prev, r]); setNewEmail(""); }
    } catch {}
  };

  const removeRecipient = async (id: string) => {
    setRemovingId(id);
    await fetch(`/api/settings/recipients/${id}`, { method: "DELETE" });
    setRecipients(prev => prev.filter(r => r.id !== id));
    setRemovingId(null);
  };

  const saveSettings = async () => {
    setSaving("saving");
    try {
      const res = await fetch("/api/settings/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSaving(res.ok ? "done" : "error");
      setTimeout(() => setSaving("idle"), 2000);
    } catch { setSaving("error"); setTimeout(() => setSaving("idle"), 2000); }
  };

  return (
    <div className="space-y-6 rounded-xl border border-slate-800 bg-slate-900/30 p-6">
      <div className="flex items-center gap-2">
        <Bell className="w-5 h-5 text-blue-400" />
        <h2 className="text-lg font-bold">Notifications &amp; Scheduling</h2>
      </div>

      {/* Notification toggles */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-300">Preferences</h3>
        {[
          { key: "dailyChecksEnabled" as const, label: "Daily background checks", desc: "Automatically analyze your portfolio once per day" },
          { key: "emailNotificationsEnabled" as const, label: "Email notifications", desc: "Send alerts and summaries to your email addresses" },
        ].map(({ key, label, desc }) => (
          <label key={key} className="flex items-start gap-3 cursor-pointer group">
            <div className="relative mt-0.5">
              <input type="checkbox" className="sr-only" checked={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} />
              <div className={`w-10 h-6 rounded-full transition-colors ${settings[key] ? "bg-blue-600" : "bg-slate-700"}`} />
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${settings[key] ? "left-5" : "left-1"}`} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{label}</p>
              <p className="text-xs text-slate-500">{desc}</p>
            </div>
          </label>
        ))}
      </div>

      {/* Schedule settings */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Daily check time</label>
          <select
            value={settings.dailyCheckHour}
            onChange={e => setSettings(s => ({ ...s, dailyCheckHour: Number(e.target.value) }))}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{i === 0 ? "12:00 AM" : i < 12 ? `${i}:00 AM` : i === 12 ? "12:00 PM" : `${i - 12}:00 PM`}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Weekly summary day</label>
          <select
            value={settings.weeklySummaryDay}
            onChange={e => setSettings(s => ({ ...s, weeklySummaryDay: Number(e.target.value) }))}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Alert threshold</label>
          <select
            value={settings.alertThreshold}
            onChange={e => setSettings(s => ({ ...s, alertThreshold: e.target.value }))}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            <option value="low">Low — any change</option>
            <option value="medium">Medium — notable changes</option>
            <option value="high">High — action required</option>
            <option value="urgent">Urgent only</option>
          </select>
        </div>
      </div>

      <button
        onClick={saveSettings}
        disabled={saving === "saving"}
        className="inline-flex items-center gap-2 text-sm font-medium bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/40 text-blue-300 rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
      >
        {saving === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : saving === "done" ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Save className="w-4 h-4" />}
        {saving === "saving" ? "Saving…" : saving === "done" ? "Saved!" : "Save preferences"}
      </button>

      {/* Recipients */}
      <div className="space-y-3 pt-2 border-t border-slate-800">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-semibold text-slate-300">Notification Recipients</h3>
        </div>
        <p className="text-xs text-slate-500">Email addresses that receive daily alerts and weekly summaries. Add multiple addresses if needed.</p>

        {recipients.map(r => (
          <div key={r.id} className="flex items-center gap-3 bg-slate-800/40 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-200 truncate">{r.email}</p>
              {r.label && <p className="text-xs text-slate-500">{r.label}</p>}
            </div>
            <button
              onClick={() => removeRecipient(r.id)}
              disabled={removingId === r.id}
              className="text-slate-600 hover:text-red-400 transition-colors"
            >
              {removingId === r.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        ))}

        <div className="flex gap-2">
          <div className="flex-1">
            <input
              type="email"
              value={newEmail}
              onChange={e => { setNewEmail(e.target.value); setEmailError(""); }}
              onKeyDown={e => e.key === "Enter" && addRecipient()}
              placeholder="Add email address…"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
            {emailError && <p className="text-xs text-red-400 mt-1">{emailError}</p>}
          </div>
          <button
            onClick={addRecipient}
            className="inline-flex items-center gap-1.5 text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg px-3 py-2 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>
    </div>
  );
}
