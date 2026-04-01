import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AutoRunner } from "./AutoRunner";

export const dynamic = "force-dynamic";

export default async function GenerateReportPage() {
  const latestSnapshot = await prisma.portfolioSnapshot.findFirst({
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
    where: { archivedAt: null },
  });

  if (!latestSnapshot) redirect("/");

  const holdingsCount = latestSnapshot.holdings.filter(h => !h.isCash).length;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold">Portfolio Analysis</h1>
        <p className="text-slate-400 text-sm">
          Multi-model deep analysis on{" "}
          <span className="text-slate-200 font-medium">{holdingsCount} positions</span> —
          market regime detection, gap analysis, candidate screening, parallel AI reasoning, and signal aggregation.
        </p>
      </div>

      <AutoRunner snapshotId={latestSnapshot.id} />
    </div>
  );
}
