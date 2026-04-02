import { prisma } from "@/lib/prisma";

export interface AcknowledgeBundleInput {
  bundleId: string;
  userId: string;
  runId?: string | null;
}

export async function acknowledgeBundle(input: AcknowledgeBundleInput) {
  const acknowledgedAt = new Date();

  const bundle = await prisma.analysisBundle.update({
    where: { id: input.bundleId },
    data: {
      acknowledgedAt,
      deliveryStatus: "acknowledged",
    },
  });

  await prisma.notificationEvent.create({
    data: {
      userId: input.userId,
      runId: input.runId ?? null,
      analysisBundleId: input.bundleId,
      type: "report_acknowledged",
      channel: "email",
      status: "sent",
      isDebug: false,
    },
  });

  return bundle;
}
