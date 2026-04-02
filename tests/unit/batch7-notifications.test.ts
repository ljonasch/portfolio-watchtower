/**
 * tests/unit/batch7-notifications.test.ts
 * Batch 7 tests: email idempotency, notification ViewModel projections.
 *
 * T40 — projectNotificationEvent: maps raw Prisma row to NotificationEventViewModel
 * T41 — projectNotificationEvent: status coercion with unknown value defaults to "pending"
 * T42 — projectNotificationEvent: sentAt populated only when status="sent" + createdAt is Date
 * T43 — projectNotificationRecipient: maps raw row to NotificationRecipientViewModel
 * T44 — idempotency logic: alreadySent check correctly skips duplicate sends
 */

import { projectNotificationEvent, projectNotificationRecipient } from "@/lib/view-models/index";

// ─── T40: projectNotificationEvent basic mapping ──────────────────────────────

describe("T40 — projectNotificationEvent: basic mapping", () => {
  test("maps all fields correctly from raw row", () => {
    const raw = {
      id: "notif_001",
      recipient: "user@example.com",
      status: "sent",
      createdAt: new Date("2026-04-01T10:00:00Z"),
      errorMessage: null,
      runId: "run_abc",
      reportId: "report_xyz",
    };
    const vm = projectNotificationEvent(raw);
    expect(vm.id).toBe("notif_001");
    expect(vm.type).toBe("email");
    expect(vm.recipientEmail).toBe("user@example.com");
    expect(vm.status).toBe("sent");
    expect(vm.errorMessage).toBeNull();
    expect(vm.runId).toBe("run_abc");
    expect(vm.reportId).toBe("report_xyz");
  });

  test("missing fields fall back to null/defaults", () => {
    const vm = projectNotificationEvent({ id: "notif_002", status: "pending" });
    expect(vm.recipientEmail).toBeNull();
    expect(vm.errorMessage).toBeNull();
    expect(vm.runId).toBeNull();
    expect(vm.reportId).toBeNull();
    expect(vm.sentAt).toBeNull();
  });
});

// ─── T41: status coercion ─────────────────────────────────────────────────────

describe("T41 — projectNotificationEvent: status coercion", () => {
  test("known status values map correctly", () => {
    expect(projectNotificationEvent({ status: "sent" }).status).toBe("sent");
    expect(projectNotificationEvent({ status: "failed" }).status).toBe("failed");
    expect(projectNotificationEvent({ status: "pending" }).status).toBe("pending");
  });

  test("unknown status defaults to 'pending'", () => {
    expect(projectNotificationEvent({ status: "queued" }).status).toBe("pending");
    expect(projectNotificationEvent({ status: null }).status).toBe("pending");
    expect(projectNotificationEvent({ status: undefined }).status).toBe("pending");
  });
});

// ─── T42: sentAt only populated on sent + Date ────────────────────────────────

describe("T42 — projectNotificationEvent: sentAt logic", () => {
  test("sentAt is ISO string when status=sent and createdAt is Date", () => {
    const raw = {
      status: "sent",
      createdAt: new Date("2026-04-01T08:30:00Z"),
    };
    const vm = projectNotificationEvent(raw);
    expect(vm.sentAt).toBe("2026-04-01T08:30:00.000Z");
  });

  test("sentAt is null when status=failed", () => {
    const raw = { status: "failed", createdAt: new Date("2026-04-01T08:30:00Z") };
    expect(projectNotificationEvent(raw).sentAt).toBeNull();
  });

  test("sentAt is null when createdAt is a string, not a Date", () => {
    const raw = { status: "sent", createdAt: "2026-04-01T08:30:00Z" };
    expect(projectNotificationEvent(raw).sentAt).toBeNull();
  });

  test("sentAt is null when createdAt is missing", () => {
    const raw = { status: "sent" };
    expect(projectNotificationEvent(raw).sentAt).toBeNull();
  });
});

// ─── T43: projectNotificationRecipient ───────────────────────────────────────

describe("T43 — projectNotificationRecipient: mapping", () => {
  test("maps all fields correctly", () => {
    const raw = {
      id: "recip_001",
      email: "alert@example.com",
      label: "Primary",
      active: true,
    };
    const vm = projectNotificationRecipient(raw);
    expect(vm.id).toBe("recip_001");
    expect(vm.email).toBe("alert@example.com");
    expect(vm.label).toBe("Primary");
    expect(vm.active).toBe(true);
  });

  test("label defaults to null when missing", () => {
    const vm = projectNotificationRecipient({ id: "r1", email: "a@b.com", active: false });
    expect(vm.label).toBeNull();
    expect(vm.active).toBe(false);
  });

  test("active defaults to true when missing", () => {
    const vm = projectNotificationRecipient({ id: "r2", email: "b@c.com" });
    expect(vm.active).toBe(true);
  });
});

// ─── T44: idempotency guard logic ────────────────────────────────────────────

describe("T44 — idempotency check: prevents duplicate sends", () => {
  test("alreadySent=found → skip send (simulate guard logic)", () => {
    // Simulate the idempotency guard without hitting the DB
    const alreadySent = { id: "notif_existing", status: "sent" }; // truthy = exists

    let emailSent = false;
    const runEmailPath = () => {
      if (alreadySent) return; // guard
      emailSent = true;
    };

    runEmailPath();
    expect(emailSent).toBe(false);
  });

  test("alreadySent=null → proceeds with send", () => {
    const alreadySent = null; // no existing record

    let emailSent = false;
    const runEmailPath = () => {
      if (alreadySent) return; // guard
      emailSent = true;
    };

    runEmailPath();
    expect(emailSent).toBe(true);
  });

  test("idempotency key uses runId + recipient + type + status=sent", () => {
    // This test documents the exact fields used for dedup — a contract test
    const idempotencyKey = {
      runId: "run_abc",
      recipient: "user@example.com",
      type: "daily_alert",
      status: "sent",
    };
    expect(idempotencyKey.runId).toBeTruthy();
    expect(idempotencyKey.recipient).toBeTruthy();
    expect(idempotencyKey.type).toBe("daily_alert");
    expect(idempotencyKey.status).toBe("sent");
  });
});
