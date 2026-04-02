/**
 * tests/unit/batch8-harness.test.ts
 * Batch 8 tests: golden packet runner, EvidenceAudit + AppSettings projections,
 * and export route CSV utility functions.
 *
 * T55 — projectEvidenceAudit: normal run fixture → correct ViewModel
 * T56 — projectEvidenceAudit: abstained run fixture → outcome=abstained
 * T57 — projectEvidenceAudit: fallback news fixture → perSectionChars parsed
 * T63 — projectAppSettings: known keys map to typed values
 * T64 — projectAppSettings: missing keys produce safe defaults
 * T65 — projectAppSettings: validation_enforce_block false/true coercion
 * T68 — CSV escapeCSV: handles commas, quotes, newlines
 * T69 — isSnapshotStale: returns true for >7 day old snapshot
 */

import { projectEvidenceAudit, projectAppSettings, isSnapshotStale } from "@/lib/view-models/index";

// Load fixtures from harness directory
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fixtureNormal = require("../../tests/harness/fixture_normal_run.json");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fixtureAbstained = require("../../tests/harness/fixture_abstained_run.json");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fixtureFallback = require("../../tests/harness/fixture_fallback_news.json");

// ─── CSV escape utility (copied from export route — pure function, no HTTP) ───

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSV(headers: string[], rows: Record<string, unknown>[]): string {
  const head = headers.join(",");
  const body = rows.map((r) => headers.map((h) => escapeCSV(r[h])).join(",")).join("\n");
  return head + "\n" + body;
}

// ─── T55: Normal run fixture projection ───────────────────────────────────────

describe("T55 — projectEvidenceAudit: normal run fixture", () => {
  const vm = projectEvidenceAudit(fixtureNormal);

  test("runId and snapshotId mapped", () => {
    expect(vm.runId).toBe("run_fixture_001");
    expect(vm.snapshotId).toBe("snap_fixture_001");
  });

  test("outcome is 'used'", () => {
    expect(vm.outcome).toBe("used");
  });

  test("promptHash matches fixture", () => {
    expect(vm.promptHash).toBe("a1b2c3d4e5f6a1b2");
  });

  test("totalInputChars parsed as number", () => {
    expect(vm.totalInputChars).toBe(18450);
  });

  test("perSectionChars parsed from JSON string", () => {
    expect(vm.perSectionChars).toEqual({
      regime: 420,
      breaking24h: 1800,
      news30d: 8000,
      priceReactions: 600,
      sentiment: 540,
      valuation: 2400,
      correlation: 1200,
      candidates: 900,
    });
  });

  test("frozenAt is ISO string", () => {
    expect(vm.frozenAt).toBe("2026-04-01T10:00:00.000Z");
  });

  test("schemaVersion defaults to 1", () => {
    expect(vm.schemaVersion).toBe(1);
  });

  test("debugPayload.regime parsed correctly", () => {
    expect((vm.debugPayload?.regime as any)?.riskMode).toBe("risk-on");
  });
});

// ─── T56: Abstained run fixture ───────────────────────────────────────────────

describe("T56 — projectEvidenceAudit: abstained run fixture", () => {
  const vm = projectEvidenceAudit(fixtureAbstained);

  test("outcome is 'abstained'", () => {
    expect(vm.outcome).toBe("abstained");
  });

  test("promptHash matches fixture", () => {
    expect(vm.promptHash).toBe("b2c3d4e5f6a1b2c3");
  });

  test("totalInputChars reflects large portfolio", () => {
    expect(vm.totalInputChars).toBe(31200);
  });

  test("perSectionChars: breaking24h is 3000 (capped)", () => {
    expect(vm.perSectionChars.breaking24h).toBe(3000);
  });

  test("debugPayload.regime has elevated vixLevel", () => {
    expect((vm.debugPayload?.regime as any)?.vixLevel).toBe("elevated");
  });
});

// ─── T57: Fallback news fixture ───────────────────────────────────────────────

describe("T57 — projectEvidenceAudit: fallback news fixture", () => {
  const vm = projectEvidenceAudit(fixtureFallback);

  test("outcome is 'used'", () => {
    expect(vm.outcome).toBe("used");
  });

  test("breaking24h section is 0 chars (unavailable)", () => {
    expect(vm.perSectionChars.breaking24h).toBe(0);
  });

  test("news debugPayload flags as fallback", () => {
    expect((vm.debugPayload?.news as any)?.text).toContain("[FALLBACK]");
  });

  test("promptHash is distinct from other fixtures", () => {
    expect(vm.promptHash).toBe("c3d4e5f6a1b2c3d4");
    expect(vm.promptHash).not.toBe("a1b2c3d4e5f6a1b2");
    expect(vm.promptHash).not.toBe("b2c3d4e5f6a1b2c3");
  });
});

// ─── T63: projectAppSettings — known keys ─────────────────────────────────────

describe("T63 — projectAppSettings: known keys", () => {
  test("parses antichurn_threshold_pct as float", () => {
    const vm = projectAppSettings([
      { key: "antichurn_threshold_pct", value: "2.5" },
    ]);
    expect(vm.antichurnThresholdPct).toBe(2.5);
  });

  test("parses validation_enforce_block as boolean", () => {
    const vm = projectAppSettings([
      { key: "validation_enforce_block", value: "true" },
    ]);
    expect(vm.validationEnforceBlock).toBe(true);
  });

  test("parses cache_enabled and email_auto_send", () => {
    const vm = projectAppSettings([
      { key: "cache_enabled", value: "false" },
      { key: "email_auto_send", value: "false" },
    ]);
    expect(vm.cacheEnabled).toBe(false);
    expect(vm.emailAutoSend).toBe(false);
  });
});

// ─── T64: projectAppSettings — missing keys use defaults ──────────────────────

describe("T64 — projectAppSettings: missing keys → safe defaults", () => {
  test("empty rows produce all safe defaults", () => {
    const vm = projectAppSettings([]);
    expect(vm.antichurnThresholdPct).toBe(1.5);
    expect(vm.validationEnforceBlock).toBe(false);
    expect(vm.cacheEnabled).toBe(false);
    expect(vm.emailAutoSend).toBe(true);
  });

  test("non-numeric antichurn falls back to 1.5", () => {
    const vm = projectAppSettings([{ key: "antichurn_threshold_pct", value: "not-a-number" }]);
    expect(vm.antichurnThresholdPct).toBe(1.5);
  });
});

// ─── T65: validation_enforce_block coercion ────────────────────────────────────

describe("T65 — projectAppSettings: validation_enforce_block coercion", () => {
  test("'false' string → false boolean", () => {
    const vm = projectAppSettings([{ key: "validation_enforce_block", value: "false" }]);
    expect(vm.validationEnforceBlock).toBe(false);
  });

  test("'true' string → true boolean", () => {
    const vm = projectAppSettings([{ key: "validation_enforce_block", value: "true" }]);
    expect(vm.validationEnforceBlock).toBe(true);
  });

  test("unknown value falls back to default (false)", () => {
    const vm = projectAppSettings([{ key: "validation_enforce_block", value: "yes" }]);
    expect(vm.validationEnforceBlock).toBe(false);
  });
});

// ─── T68: CSV escaping (export route utility) ─────────────────────────────────

describe("T68 — escapeCSV: correct escaping", () => {
  test("plain string passes through unchanged", () => {
    expect(escapeCSV("NVDA")).toBe("NVDA");
  });

  test("null and undefined produce empty string", () => {
    expect(escapeCSV(null)).toBe("");
    expect(escapeCSV(undefined)).toBe("");
  });

  test("value with comma is quoted", () => {
    expect(escapeCSV("Apple, Inc.")).toBe('"Apple, Inc."');
  });

  test("value with double-quote escapes inner quote", () => {
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
  });

  test("value with newline is quoted", () => {
    expect(escapeCSV("line1\nline2")).toBe('"line1\nline2"');
  });

  test("toCSV produces correct header + row", () => {
    const csv = toCSV(["ticker", "action"], [{ ticker: "NVDA", action: "Buy" }]);
    expect(csv).toBe("ticker,action\nNVDA,Buy");
  });

  test("toCSV with special chars escapes correctly", () => {
    const csv = toCSV(["name"], [{ name: "Apple, Inc." }]);
    expect(csv).toBe('name\n"Apple, Inc."');
  });
});

// ─── T69: isSnapshotStale ────────────────────────────────────────────────────

describe("T69 — isSnapshotStale", () => {
  test("snapshot >7 days old → stale", () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    expect(isSnapshotStale(old)).toBe(true);
  });

  test("snapshot 1 day old → not stale", () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    expect(isSnapshotStale(recent)).toBe(false);
  });

  test("accepts ISO string format", () => {
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isSnapshotStale(old)).toBe(true);
  });

  test("snapshot exactly at 7 days is not stale (boundary)", () => {
    const exact7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(isSnapshotStale(exact7)).toBe(false);
  });
});
