import type { HoldingRecommendation, UserProfile } from "@prisma/client";
import type { ChangeLog } from "./comparator";
import type { AlertLevel } from "./alerts";

const ALERT_COLORS: Record<AlertLevel, string> = {
  none: "#22c55e",
  low: "#84cc16",
  medium: "#f59e0b",
  high: "#f97316",
  urgent: "#ef4444",
};

const ALERT_LABELS: Record<AlertLevel, string> = {
  none: "✅ Stable",
  low: "🟡 Minor Changes",
  medium: "🟠 Attention Needed",
  high: "🔴 Action Required",
  urgent: "🚨 Urgent",
};

function baseStyles() {
  return `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 0; }
    .container { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
    .header { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 20px; border-left: 4px solid #3b82f6; color: #e2e8f0; }
    .card { background: #1e293b; border-radius: 8px; padding: 16px; margin-bottom: 16px; color: #e2e8f0; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 10px; background: #0f172a; color: #64748b; font-weight: 500; }
    td { padding: 8px 10px; border-bottom: 1px solid #334155; color: #e2e8f0; }
    .green { color: #22c55e; } .red { color: #ef4444; } .amber { color: #f59e0b; } .muted { color: #64748b; }
    h1 { margin: 0 0 4px; font-size: 22px; color: #f8fafc; } h2 { font-size: 16px; color: #94a3b8; margin: 0 0 12px; }
    h3 { font-size: 14px; color: #94a3b8; margin: 0 0 10px; }
    .footer { text-align: center; color: #475569; font-size: 12px; margin-top: 24px; }
    a { color: #60a5fa; text-decoration: none; }
  `;
}

export function renderDailyAlertEmail(opts: {
  reportId: string;
  alertLevel: AlertLevel;
  alertReason: string;
  changes: ChangeLog[];
  recommendations: HoldingRecommendation[];
  profile: UserProfile;
  runDate: string;
  reportSummary?: string;
  reportReasoning?: string;
  appUrl?: string;
}): { subject: string; html: string } {
  const { reportId, alertLevel, alertReason, changes, recommendations, profile, runDate, reportSummary, reportReasoning, appUrl = "http://localhost:3000" } = opts;
  const color = ALERT_COLORS[alertLevel];
  const label = ALERT_LABELS[alertLevel];
  const changed = changes.filter((c) => c.changed);
  const age = new Date().getFullYear() - profile.birthYear;

  const subject = `[Portfolio Watchtower] ${label} — ${runDate}`;

  const changesRows = changed.map((c) => `
    <tr>
      <td><strong>${c.ticker}</strong></td>
      <td class="muted">${c.priorAction ?? "—"}</td>
      <td style="color:${c.newAction === "Sell" || c.newAction === "Exit" ? "#ef4444" : "#22c55e"}">${c.newAction}</td>
      <td>${c.priorTargetShares ?? "—"} → ${c.newTargetShares}</td>
      <td class="muted">${c.changeReason}</td>
    </tr>`).join("");

  const recRows = recommendations.map((r) => `
    <tr>
      <td><strong>${r.ticker}</strong></td>
      <td class="muted">${r.currentShares ?? 0} → </td><td>${r.targetShares}</td>
      <td class="muted">${(r.currentWeight ?? 0).toFixed(1)}% → </td><td>${r.targetWeight.toFixed(1)}%</td>
      <td style="color:${r.action==="Sell"||r.action==="Exit"?"#ef4444":"#22c55e"}">${r.action}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles()}</style></head><body>
<div class="container">
  <div class="header">
    <h1>Portfolio Watchtower</h1>
    <h2>${runDate} — Daily Analysis</h2>
    <span class="badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${label}</span>
  </div>

  <div class="card">
    <h3>Alert Summary</h3>
    <p style="margin:0;font-size:14px">${alertReason}</p>
  </div>

  ${reportSummary ? `
  <div class="card">
    <h3>AI Analysis & Reasoning</h3>
    <p style="margin:0 0 12px;font-size:14px;line-height:1.5">${reportSummary}</p>
    ${reportReasoning ? `<p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.4">${reportReasoning}</p>` : ""}
  </div>
  ` : ""}

  <div class="card">
    <h3>Profile Context</h3>
    <p style="margin:0;font-size:13px;color:#94a3b8">
      Age ${age} · ${profile.trackedAccountObjective} · ${profile.trackedAccountRiskTolerance} risk · 
      ${profile.trackedAccountTaxStatus ?? "Taxable"}
    </p>
  </div>

  ${changed.length > 0 ? `
  <div class="card">
    <h3>AI Strategy Updates Since Yesterday (${changed.length} position${changed.length > 1 ? "s" : ""})</h3>
    <p style="margin:0 0 10px;font-size:12px;color:#94a3b8">Highlights when the AI changes its underlying thesis or target conviction compared to the prior run.</p>
    <table>
      <thead><tr><th>Ticker</th><th>Previous Advice</th><th>New Advice</th><th>Target Shares</th><th>Reason</th></tr></thead>
      <tbody>${changesRows}</tbody>
    </table>
  </div>` : `<div class="card"><p class="muted" style="margin:0">No changes in AI strategy from prior run.</p></div>`}

  <div class="card">
    <h3>Active Trade Recommendations</h3>
    <p style="margin:0 0 10px;font-size:12px;color:#94a3b8">Your current target allocations. Execute these trades in your brokerage to align with the AI's strategy.</p>
    <table>
      <thead><tr><th>Ticker</th><th colspan="2">Shares (Current → Target)</th><th colspan="2">Weight (Current → Target)</th><th>Action</th></tr></thead>
      <tbody>${recRows}</tbody>
    </table>
  </div>

  <p style="text-align:center;margin-top:20px">
    <a href="${appUrl}/report/${reportId}" style="background:#3b82f6;color:white;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600">View Full Report →</a>
  </p>

  <div class="footer">
    <p>Portfolio Watchtower · Recommendations only — does not place trades.<br>
    <a href="${appUrl}/settings">Manage notifications</a> · <a href="${appUrl}/how-it-works">How this works</a></p>
  </div>
</div></body></html>`;

  return { subject, html };
}

export function renderWeeklySummaryEmail(opts: {
  weekEnding: string;
  runs: { date: string; alertLevel: AlertLevel; alertReason: string }[];
  topChanges: ChangeLog[];
  recommendations: HoldingRecommendation[];
  profile: UserProfile;
  appUrl?: string;
}): { subject: string; html: string } {
  const { weekEnding, runs, topChanges, recommendations, profile, appUrl = "http://localhost:3000" } = opts;
  const age = new Date().getFullYear() - profile.birthYear;

  const subject = `[Portfolio Watchtower] Weekly Summary — week ending ${weekEnding}`;

  const runRows = runs.map((r) => `
    <tr>
      <td>${r.date}</td>
      <td><span class="badge" style="background:${ALERT_COLORS[r.alertLevel]}20;color:${ALERT_COLORS[r.alertLevel]}">${ALERT_LABELS[r.alertLevel]}</span></td>
      <td class="muted">${r.alertReason}</td>
    </tr>`).join("");

  const changeRows = topChanges.filter((c) => c.changed).slice(0, 5).map((c) => `
    <tr>
      <td><strong>${c.ticker}</strong></td>
      <td>${c.priorAction ?? "—"} → ${c.newAction}</td>
      <td>${c.priorTargetShares ?? "—"} → ${c.newTargetShares}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles()}</style></head><body>
<div class="container">
  <div class="header">
    <h1>Weekly Summary</h1>
    <h2>Week ending ${weekEnding}</h2>
  </div>

  <div class="card">
    <h3>How these recommendations fit your profile</h3>
    <p style="margin:0;font-size:13px;color:#94a3b8">
      You are ${age} years old with a <strong style="color:#e2e8f0">${profile.trackedAccountRiskTolerance}</strong> risk tolerance 
      and a <strong style="color:#e2e8f0">${profile.trackedAccountObjective}</strong> objective. 
      ${profile.trackedAccountTaxStatus ? `This is a <strong style="color:#e2e8f0">${profile.trackedAccountTaxStatus}</strong> account.` : ""}
      ${profile.maxPositionSizePct ? `Maximum position size: ${profile.maxPositionSizePct}%.` : ""}
      All recommendations this week were generated using only your saved profile — no assumptions were made.
    </p>
  </div>

  <div class="card">
    <h3>This Week's Runs (${runs.length})</h3>
    <table>
      <thead><tr><th>Date</th><th>Alert</th><th>Summary</th></tr></thead>
      <tbody>${runRows}</tbody>
    </table>
  </div>

  ${changeRows ? `<div class="card">
    <h3>Top Changes This Week</h3>
    <table>
      <thead><tr><th>Ticker</th><th>Action Change</th><th>Target Shares</th></tr></thead>
      <tbody>${changeRows}</tbody>
    </table>
  </div>` : ""}

  <p style="text-align:center;margin-top:20px">
    <a href="${appUrl}" style="background:#3b82f6;color:white;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600">Open Portfolio Watchtower →</a>
  </p>
  <div class="footer">
    <p>Portfolio Watchtower · Recommendations only — does not place trades.<br>
    <a href="${appUrl}/settings">Manage notifications</a> · <a href="${appUrl}/how-it-works">How this works</a></p>
  </div>
</div></body></html>`;

  return { subject, html };
}

export function renderTestEmail(appUrl = "http://localhost:3000"): { subject: string; html: string } {
  return {
    subject: "[Portfolio Watchtower] Test Notification",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${baseStyles()}</style></head><body>
<div class="container">
  <div class="header"><h1>Portfolio Watchtower</h1><h2>Test Notification</h2></div>
  <div class="card">
    <p>✅ Your email notifications are configured correctly and working.</p>
    <p class="muted">You'll receive daily alerts when meaningful portfolio changes are detected, and a weekly summary every Sunday.</p>
  </div>
  <p style="text-align:center"><a href="${appUrl}" style="background:#3b82f6;color:white;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600">Open Portfolio Watchtower →</a></p>
  <div class="footer"><p>Portfolio Watchtower · <a href="${appUrl}/settings">Manage notifications</a></p></div>
</div></body></html>`,
  };
}
