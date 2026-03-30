import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { AutoRunner } from "./AutoRunner";

export const dynamic = "force-dynamic";

export default async function GenerateReportPage() {
  // Always grab the absolutely newest snapshot in the database. 
  // This ensures that when a user uploads/confirms a new snapshot,
  // we analyze THAT one, not the previous days.
  const latestSnapshot = await prisma.portfolioSnapshot.findFirst({
    orderBy: { createdAt: 'desc' },
    include: { holdings: true }
  });

  if (!latestSnapshot) {
    redirect('/');
  }

  const holdingsCount = latestSnapshot.holdings.length;

  return (
    <div className="max-w-lg mx-auto mt-16 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">Analyzing Portfolio</h1>
        <p className="text-slate-400 text-sm">
          Running a deep analysis on <span className="text-slate-200 font-medium">{holdingsCount} positions</span> — searching live news, cross-referencing your profile, and generating recommendations.
        </p>
      </div>

      <AutoRunner snapshotId={latestSnapshot.id} />
    </div>
  );
}
