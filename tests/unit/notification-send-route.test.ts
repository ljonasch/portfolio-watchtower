jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: jest.fn() },
    notificationRecipient: { findMany: jest.fn() },
    portfolioReport: { findFirst: jest.fn() },
  },
}));

jest.mock("@/lib/services", () => ({
  sendEmailNotification: jest.fn(),
}));

jest.mock("@/lib/read-models", () => ({
  getCurrentBundleRecord: jest.fn(),
}));

jest.mock("@/lib/comparator", () => ({
  compareRecommendations: jest.fn(),
}));

jest.mock("@/lib/alerts", () => ({
  evaluateAlert: jest.fn(),
  AlertLevel: {},
}));

import { prisma } from "@/lib/prisma";
import { getCurrentBundleRecord } from "@/lib/read-models";
import { sendEmailNotification } from "@/lib/services";
import { compareRecommendations } from "@/lib/comparator";
import { evaluateAlert } from "@/lib/alerts";
import { POST } from "@/app/api/notifications/send/route";

describe("notification send route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("uses the bundle-backed send path without legacy live recomputation", async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({
      id: "user_1",
      profile: { firstName: "Test" },
    });
    (prisma.notificationRecipient.findMany as jest.Mock).mockResolvedValue([
      { id: "recipient_1", email: "one@example.com" },
      { id: "recipient_2", email: "two@example.com" },
    ]);
    (getCurrentBundleRecord as jest.Mock).mockResolvedValue({
      currentBundle: {
        id: "bundle_1",
        sourceRunId: "run_1",
      },
    });
    (sendEmailNotification as jest.Mock).mockResolvedValue({ ok: true });

    const response = await POST(
      new Request("http://localhost/api/notifications/send", {
        method: "POST",
        body: JSON.stringify({ type: "daily_alert" }),
      })
    );

    expect(response.status).toBe(200);
    expect(sendEmailNotification).toHaveBeenCalledTimes(2);
    expect(sendEmailNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        analysisBundleId: "bundle_1",
        runId: "run_1",
        subject: "",
        html: "",
      })
    );
    expect(prisma.portfolioReport.findFirst).not.toHaveBeenCalled();
    expect(compareRecommendations).not.toHaveBeenCalled();
    expect(evaluateAlert).not.toHaveBeenCalled();
  });
});
