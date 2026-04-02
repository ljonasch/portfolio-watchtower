import type { DeliveryEligibilityContract, DeliveryStatus } from "@/lib/contracts";

const INITIAL_SEND_STATUSES: DeliveryStatus[] = ["acknowledged", "send_failed"];

export function buildDeliveryEligibility(input: {
  bundleId: string;
  bundleOutcome: string;
  isCurrentBundle: boolean;
  isSuperseded: boolean;
  acknowledgedAt: Date | string | null;
  deliveryStatus: DeliveryStatus;
  emailPayloadJson: string | null;
}): DeliveryEligibilityContract {
  const isValidated = input.bundleOutcome === "validated";
  const isAcknowledged = Boolean(input.acknowledgedAt);
  const hasEmailPayload = typeof input.emailPayloadJson === "string" && input.emailPayloadJson.trim().length > 0;

  return {
    bundleId: input.bundleId,
    isValidated,
    isCurrentBundle: input.isCurrentBundle,
    isAcknowledged,
    isSuperseded: input.isSuperseded,
    deliveryStatus: input.deliveryStatus,
    isEligibleForInitialSend:
      isValidated &&
      input.isCurrentBundle &&
      !input.isSuperseded &&
      isAcknowledged &&
      hasEmailPayload &&
      INITIAL_SEND_STATUSES.includes(input.deliveryStatus),
    isEligibleForManualResend:
      isValidated &&
      input.isCurrentBundle &&
      !input.isSuperseded &&
      isAcknowledged &&
      hasEmailPayload &&
      input.deliveryStatus === "send_failed",
  };
}
