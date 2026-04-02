import type { AbstainReason } from "@/lib/research/types";
import {
  ABSTAIN_REASON_CODES as contractAbstainReasons,
  DELIVERY_STATUSES as contractDeliveryStatuses,
} from "@/lib/contracts";
import { type ActionEnum, type ConfidenceEnum } from "@/lib/view-models/types";

describe("contract compatibility shims", () => {
  test("research types abstain reason alias points to canonical contract values", () => {
    const reason: AbstainReason = "SEMANTIC_VALIDATION_FAILED";
    expect(contractAbstainReasons).toContain(reason);
  });

  test("view-model shim action and confidence aliases still accept canonical values", () => {
    const action: ActionEnum = "Buy";
    const confidence: ConfidenceEnum = "high";

    expect(action).toBe("Buy");
    expect(confidence).toBe("high");
    expect(contractDeliveryStatuses).toContain("awaiting_ack");
  });
});
