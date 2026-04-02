import {
  ABSTAIN_REASON_CODES,
  ANALYSIS_RUN_STAGES,
  BUNDLE_OUTCOMES,
  BUNDLE_REASON_CODES,
  BUNDLE_SCOPES,
  CURRENT_BUNDLE_RENDER_STATES,
  DEGRADED_REASON_CODES,
  DELIVERY_ERROR_CODES,
  DELIVERY_STATUSES,
  NOTIFICATION_EVENT_TYPES,
  RECOMMENDATION_ACTIONS,
  RUN_FAILURE_CODES,
} from "@/lib/contracts";

describe("contract enums", () => {
  test("bundle and delivery enums match the frozen plan", () => {
    expect(BUNDLE_SCOPES).toEqual(["PRIMARY_PORTFOLIO"]);
    expect(BUNDLE_OUTCOMES).toEqual(["validated", "abstained", "degraded"]);
    expect(DELIVERY_STATUSES).toEqual([
      "not_eligible",
      "awaiting_ack",
      "acknowledged",
      "sending",
      "sent",
      "send_failed",
    ]);
    expect(RECOMMENDATION_ACTIONS).toEqual(["Buy", "Sell", "Hold", "Exit", "Trim"]);
  });

  test("run stages and render states are closed and ordered", () => {
    expect(ANALYSIS_RUN_STAGES).toEqual([
      "queued",
      "preparing_inputs",
      "building_evidence",
      "scoring",
      "validating",
      "finalized_validated",
      "finalized_abstained",
      "finalized_degraded",
      "failed",
    ]);
    expect(CURRENT_BUNDLE_RENDER_STATES).toContain("failed_run_prior_bundle_retained");
  });

  test("abstain and degraded reason codes are subsets of bundle reason codes", () => {
    for (const code of ABSTAIN_REASON_CODES) {
      expect(BUNDLE_REASON_CODES).toContain(code);
    }
    for (const code of DEGRADED_REASON_CODES) {
      expect(BUNDLE_REASON_CODES).toContain(code);
    }
  });

  test("failure and delivery code sets are separate from bundle codes", () => {
    expect(RUN_FAILURE_CODES).toContain("MODEL_TIMEOUT");
    expect(DELIVERY_ERROR_CODES).toContain("SMTP_TRANSIENT_FAILURE");
    expect(NOTIFICATION_EVENT_TYPES).toContain("email_failed");
    expect(BUNDLE_REASON_CODES).not.toContain("MODEL_TIMEOUT" as never);
    expect(BUNDLE_REASON_CODES).not.toContain("SMTP_TRANSIENT_FAILURE" as never);
  });
});
