import { prisma } from "@/lib/prisma";
import { ReviewForm } from "@/components/ReviewForm";
import { notFound } from "next/navigation";

export default async function ReviewPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const snapshot = await prisma.portfolioSnapshot.findUnique({
    where: { id: params.id },
    include: { holdings: true },
  });

  if (!snapshot) return notFound();

  // Load the most recent PRIOR confirmed snapshot for the same user
  // so we can compare share counts and inherit lastBoughtAt intelligently.
  const priorSnapshot = await prisma.portfolioSnapshot.findFirst({
    where: {
      userId: snapshot.userId,
      id: { not: snapshot.id },
    },
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
  });

  // Build a lookup: ticker → { shares, lastBoughtAt } from prior snapshot
  const priorHoldingMap = new Map<string, { shares: number; lastBoughtAt: Date | null }>();
  for (const h of priorSnapshot?.holdings ?? []) {
    priorHoldingMap.set(h.ticker.toUpperCase(), {
      shares: h.shares,
      lastBoughtAt: (h as any).lastBoughtAt ?? null,
    });
  }



  const today = new Date().toISOString().split("T")[0];

  const formattedHoldings = snapshot.holdings.map(h => {
    const prior = priorHoldingMap.get(h.ticker.toUpperCase());
    const sharesChanged = !prior || Math.abs(prior.shares - h.shares) > 0.0001;

    let lastBoughtAt: string | null;
    if (!sharesChanged && prior?.lastBoughtAt) {
      // Shares unchanged — inherit the prior date (visibly pre-filled)
      lastBoughtAt = prior.lastBoughtAt.toISOString().split("T")[0];
    } else if (sharesChanged) {
      // Shares changed — default to today (user almost certainly bought today)
      lastBoughtAt = today;
    } else {
      // New position with no prior at all — also default to today
      lastBoughtAt = today;
    }

    return {
      id: h.id,
      ticker: h.ticker,
      shares: h.shares,
      currentPrice: h.currentPrice || 0,
      currentValue: h.currentValue || 0,
      isCash: h.isCash,
      lastBoughtAt,
      sharesChangedFromPrior: sharesChanged,
    };
  });

  let parserWarnings: string[] = [];
  try {
    if (snapshot.notes && snapshot.notes.startsWith("[")) {
      parserWarnings = JSON.parse(snapshot.notes);
    }
  } catch(e) {}

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Review Parsed Holdings</h1>
        <p className="text-slate-400 mt-2">
          Please confirm these extracted holdings before proceeding. You can edit any mistakes made by the OCR parser.
        </p>
      </div>

      <ReviewForm
        snapshotId={snapshot.id}
        initialHoldings={formattedHoldings}
        warnings={parserWarnings}
      />
    </div>
  );
}
