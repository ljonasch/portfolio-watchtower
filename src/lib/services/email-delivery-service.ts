import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mailer";

export interface SendEmailNotificationInput {
  userId: string;
  type: string;
  recipient: string;
  subject: string;
  html: string;
  runId?: string | null;
  analysisBundleId?: string | null;
  reportId?: string | null;
  isDebug?: boolean;
}

function mapDeliveryErrorCode(error?: string): string | null {
  if (!error) return null;
  if (error.toLowerCase().includes("auth")) return "AUTH_FAILURE";
  if (error.toLowerCase().includes("reject")) return "RECIPIENT_REJECTED";
  if (error.toLowerCase().includes("smtp")) return "SMTP_TRANSIENT_FAILURE";
  return "UNKNOWN_DELIVERY_ERROR";
}

export async function sendEmailNotification(input: SendEmailNotificationInput) {
  const result = await sendMail({
    to: input.recipient,
    subject: input.subject,
    html: input.html,
  });

  await prisma.notificationEvent.create({
    data: {
      userId: input.userId,
      runId: input.runId ?? null,
      analysisBundleId: input.analysisBundleId ?? null,
      reportId: input.reportId ?? null,
      type: input.type,
      channel: "email",
      recipient: input.recipient,
      subject: input.subject,
      status: result.ok ? "sent" : "failed",
      errorMessage: result.error,
      isDebug: input.isDebug ?? false,
    },
  });

  if (input.analysisBundleId) {
    await prisma.analysisBundle.update({
      where: { id: input.analysisBundleId },
      data: {
        deliveryStatus: result.ok ? "sent" : "send_failed",
        deliveryAttemptCount: { increment: 1 },
        deliveryLastErrorCode: result.ok ? null : mapDeliveryErrorCode(result.error),
      },
    });
  }

  return result;
}
