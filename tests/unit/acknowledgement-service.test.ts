jest.mock("@/lib/prisma", () => ({
  prisma: {
    analysisBundle: { findUnique: jest.fn(), update: jest.fn() },
    notificationEvent: { create: jest.fn() },
  },
}));

jest.mock("@/lib/read-models", () => ({
  buildDeliveryEligibility: jest.fn(),
  isCurrentBundleId: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { buildDeliveryEligibility, isCurrentBundleId } from "@/lib/read-models";
import { acknowledgeBundle } from "@/lib/services";

describe("acknowledgement-service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      bundleOutcome: "validated",
      isSuperseded: false,
      acknowledgedAt: null,
      deliveryStatus: "awaiting_ack",
      emailPayloadJson: "{\"subject\":\"hello\"}",
    });
    (buildDeliveryEligibility as jest.Mock).mockReturnValue({
      isValidated: true,
      isCurrentBundle: true,
    });
    (isCurrentBundleId as jest.Mock).mockResolvedValue(true);
  });

  test("owns acknowledgment writes for bundle state and notification event", async () => {
    (prisma.analysisBundle.update as jest.Mock).mockResolvedValue({ id: "bundle_1" });
    (prisma.notificationEvent.create as jest.Mock).mockResolvedValue({ id: "evt_1" });

    await acknowledgeBundle({
      bundleId: "bundle_1",
      userId: "user_1",
      runId: "run_1",
    });

    expect(prisma.analysisBundle.update).toHaveBeenCalledTimes(1);
    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.notificationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          analysisBundleId: "bundle_1",
          runId: "run_1",
          type: "report_acknowledged",
        }),
      })
    );
  });

  test("blocks superseded or non-validated bundles", async () => {
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue({
      id: "bundle_1",
      bundleOutcome: "abstained",
      isSuperseded: true,
      acknowledgedAt: null,
      deliveryStatus: "not_eligible",
      emailPayloadJson: null,
    });
    (buildDeliveryEligibility as jest.Mock).mockReturnValue({
      isValidated: false,
      isCurrentBundle: false,
    });
    (isCurrentBundleId as jest.Mock).mockResolvedValue(false);

    await expect(
      acknowledgeBundle({
        bundleId: "bundle_1",
        userId: "user_1",
        runId: "run_1",
      })
    ).rejects.toThrow("Bundle is not eligible for acknowledgement");
  });

  test("is idempotent for already acknowledged eligible bundle", async () => {
    const acknowledgedBundle = {
      id: "bundle_1",
      bundleOutcome: "validated",
      isSuperseded: false,
      acknowledgedAt: new Date("2026-04-02T00:00:00.000Z"),
      deliveryStatus: "acknowledged",
      emailPayloadJson: "{\"subject\":\"hello\"}",
    };
    (prisma.analysisBundle.findUnique as jest.Mock).mockResolvedValue(acknowledgedBundle);
    (buildDeliveryEligibility as jest.Mock).mockReturnValue({
      isValidated: true,
      isCurrentBundle: true,
    });

    const result = await acknowledgeBundle({
      bundleId: "bundle_1",
      userId: "user_1",
      runId: "run_1",
    });

    expect(result).toBe(acknowledgedBundle);
    expect(prisma.analysisBundle.update).not.toHaveBeenCalled();
    expect(prisma.notificationEvent.create).not.toHaveBeenCalled();
  });
});
