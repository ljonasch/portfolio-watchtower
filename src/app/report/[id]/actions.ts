"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { archiveBundleBackedReport } from "@/lib/services/report-archive-service";

export async function archiveReportAction(formData: FormData) {
  const requestedId = String(formData.get("requestedId") ?? "").trim();
  if (!requestedId) {
    throw new Error("Report id is required");
  }

  const user = await prisma.user.findFirst({
    select: { id: true },
  });

  if (!user) {
    throw new Error("No user found");
  }

  await archiveBundleBackedReport({
    userId: user.id,
    requestedId,
  });

  redirect(`/report/${requestedId}`);
}
