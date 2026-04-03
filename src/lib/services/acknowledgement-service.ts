import { prisma } from "@/lib/prisma";
import { buildDeliveryEligibility, isCurrentBundleId } from "@/lib/read-models";

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

  const isCurrentBundle = await isCurrentBundleId(input.userId, bundle.id);
  const eligibility = buildDeliveryEligibility({
    bundleId: bundle.id,
    bundleOutcome: bundle.bundleOutcome,
    isCurrentBundle,
    isSuperseded: bundle.isSuperseded,
    acknowledgedAt: bundle.acknowledgedAt,
    deliveryStatus: bundle.deliveryStatus as any,
    emailPayloadJson: bundle.emailPayloadJson,
  });

  if (!eligibility.isValidated || !eligibility.isCurrentBundle || bundle.isSuperseded || bundle.bundleOutcome !== "validated") {
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
