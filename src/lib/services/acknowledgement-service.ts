import { prisma } from "@/lib/prisma";
import { buildDeliveryEligibility } from "@/lib/read-models";

export interface AcknowledgeBundleInput {
  bundleId: string;
  userId: string;
  runId?: string | null;
}

export async function acknowledgeBundle(input: AcknowledgeBundleInput) {
  const bundle = await prisma.analysisBundle.findUnique({
    where: { id: input.bundleId },
  });
  if (!bundle) {
    throw new Error("Bundle not found");
  }

  const eligibility = buildDeliveryEligibility({
    bundleId: bundle.id,
    bundleOutcome: bundle.bundleOutcome,
    isCurrentBundle: !bundle.isSuperseded,
    isSuperseded: bundle.isSuperseded,
    acknowledgedAt: bundle.acknowledgedAt,
    deliveryStatus: bundle.deliveryStatus as any,
    emailPayloadJson: bundle.emailPayloadJson,
  });

  if (!eligibility.isValidated || bundle.isSuperseded || bundle.bundleOutcome !== "validated") {
    throw new Error("Bundle is not eligible for acknowledgement");
  }

  if (bundle.acknowledgedAt) {
    return bundle;
  }

  const acknowledgedAt = new Date();

  const updatedBundle = await prisma.analysisBundle.update({
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

  return updatedBundle;
}
