jest.mock("@/lib/prisma", () => ({
  prisma: {
    notificationEvent: { create: jest.fn() },
    analysisBundle: { update: jest.fn() },
  },
}));

jest.mock("@/lib/mailer", () => ({
  sendMail: jest.fn(),
}));

import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";
import { sendEmailNotification } from "@/lib/services";

describe("email-delivery-service", () => {
  test("records notification events for email sends", async () => {
    (sendMail as jest.Mock).mockResolvedValue({ ok: true });
    (prisma.notificationEvent.create as jest.Mock).mockResolvedValue({ id: "evt_1" });

    await sendEmailNotification({
      userId: "user_1",
      type: "daily_alert",
      recipient: "user@example.com",
      subject: "Portfolio update",
      html: "<p>Hello</p>",
      runId: "run_1",
      reportId: "report_1",
      isDebug: true,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(prisma.notificationEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.analysisBundle.update).not.toHaveBeenCalled();
  });

  test("updates bundle delivery state when a bundle id is provided", async () => {
    (sendMail as jest.Mock).mockResolvedValue({ ok: false, error: "smtp timeout" });
    (prisma.notificationEvent.create as jest.Mock).mockResolvedValue({ id: "evt_2" });
    (prisma.analysisBundle.update as jest.Mock).mockResolvedValue({ id: "bundle_1" });

    await sendEmailNotification({
      userId: "user_1",
      type: "daily_alert",
      recipient: "user@example.com",
      subject: "Portfolio update",
      html: "<p>Hello</p>",
      analysisBundleId: "bundle_1",
    });

    expect(prisma.analysisBundle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bundle_1" },
        data: expect.objectContaining({
          deliveryStatus: "send_failed",
        }),
      })
    );
  });
});
