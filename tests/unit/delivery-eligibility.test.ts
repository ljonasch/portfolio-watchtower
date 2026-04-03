import { buildDeliveryEligibility } from "@/lib/read-models";

describe("delivery-eligibility", () => {
  test("validated current acknowledged bundle is eligible for initial send", () => {
    const result = buildDeliveryEligibility({
      bundleId: "bundle_1",
      bundleOutcome: "validated",
      isCurrentBundle: true,
      isSuperseded: false,
      acknowledgedAt: "2026-04-02T00:00:00.000Z",
      deliveryStatus: "acknowledged",
      emailPayloadJson: "{\"subject\":\"ok\"}",
    });

    expect(result.isEligibleForInitialSend).toBe(true);
    expect(result.isEligibleForManualResend).toBe(false);
  });

  test("superseded or non-validated bundles are blocked", () => {
    const superseded = buildDeliveryEligibility({
      bundleId: "bundle_1",
      bundleOutcome: "validated",
      isCurrentBundle: false,
      isSuperseded: true,
      acknowledgedAt: "2026-04-02T00:00:00.000Z",
      deliveryStatus: "acknowledged",
      emailPayloadJson: "{\"subject\":\"ok\"}",
    });

    const abstained = buildDeliveryEligibility({
      bundleId: "bundle_2",
      bundleOutcome: "abstained",
      isCurrentBundle: true,
      isSuperseded: false,
      acknowledgedAt: "2026-04-02T00:00:00.000Z",
      deliveryStatus: "acknowledged",
      emailPayloadJson: null,
    });

    expect(superseded.isEligibleForInitialSend).toBe(false);
    expect(abstained.isEligibleForInitialSend).toBe(false);
  });

  test("manual resend is allowed only from send_failed", () => {
    const result = buildDeliveryEligibility({
      bundleId: "bundle_1",
      bundleOutcome: "validated",
      isCurrentBundle: true,
      isSuperseded: false,
      acknowledgedAt: "2026-04-02T00:00:00.000Z",
      deliveryStatus: "send_failed",
      emailPayloadJson: "{\"subject\":\"ok\"}",
    });

    expect(result.isEligibleForInitialSend).toBe(false);
    expect(result.isEligibleForManualResend).toBe(true);
  });
});
