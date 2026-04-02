jest.mock("@/lib/prisma", () => ({
  prisma: {
    analysisBundle: { update: jest.fn() },
    notificationEvent: { create: jest.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { acknowledgeBundle } from "@/lib/services";

describe("acknowledgement-service", () => {
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
});
