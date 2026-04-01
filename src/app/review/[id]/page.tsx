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


  // Load ALL prior confirmed snapshots for this user (newest first) so we can
  // walk back in history to find the last known lastBoughtAt for each ticker.
  // This handles the common case where the most recent snapshot has null dates
  // (e.g. nothing was entered on the first upload).
  const priorSnapshots = await prisma.portfolioSnapshot.findMany({
    where: {
      userId: snapshot.userId,
      id: { not: snapshot.id },
      confirmed: true,
    },
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
  });

  // Build a map: ticker → { shares (from most recent prior), lastBoughtAt (from deepest non-null) }
  const priorShares = new Map<string, number>();
  const priorDates  = new Map<string, Date>();

  // Walk from newest to oldest to get shares from the most recent prior snapshot.
  // Only inherit a lastBoughtAt if it is STRICTLY BEFORE the snapshot's creation date —
  // if they match (same calendar day), the date was auto-filled as "today" when the
  // snapshot was saved and should be discarded rather than propagated as a real date.
  for (const snap of priorSnapshots) {
    const snapDay = snap.createdAt.toISOString().split("T")[0];
    for (const h of snap.holdings as any[]) {
      const key = h.ticker.toUpperCase();
      if (!priorShares.has(key)) {
        priorShares.set(key, h.shares);
      }
      if (!priorDates.has(key) && h.lastBoughtAt) {
        const holdingDay = (h.lastBoughtAt as Date).toISOString().split("T")[0];
        // Only accept the date if it predates the snapshot — otherwise it was auto-filled
        if (holdingDay < snapDay) {
          priorDates.set(key, h.lastBoughtAt);
        }
      }
    }
  }


  const today = new Date().toISOString().split("T")[0];

  const formattedHoldings = snapshot.holdings.map(h => {
    const key = h.ticker.toUpperCase();
    const prevShares  = priorShares.get(key);   // undefined = brand new position
    const prevDate    = priorDates.get(key);     // undefined or Date

    const isNew         = prevShares === undefined;
    const sharesIncreased = !isNew && (h.shares - prevShares!) > 0.0001;
    const sharesUnchanged = !isNew && Math.abs(h.shares - prevShares!) <= 0.0001;

    let lastBoughtAt: string | null;
    if (sharesUnchanged && prevDate) {
      // Same shares, and we have a real date somewhere in history — inherit it
      lastBoughtAt = prevDate.toISOString().split("T")[0];
    } else if (sharesUnchanged && !prevDate) {
      // Same shares but no date ever recorded — leave blank, don't mislead
      lastBoughtAt = null;
    } else if (isNew || sharesIncreased) {
      // New or increased position — default to today (user bought recently)
      lastBoughtAt = today;
    } else {
      // Shares decreased (trim/sell) — date is ambiguous, leave blank
      lastBoughtAt = null;
    }

    return {
      id: h.id,
      ticker: h.ticker,
      shares: h.shares,
      currentPrice: h.currentPrice || 0,
      currentValue: h.currentValue || 0,
      isCash: h.isCash,
      lastBoughtAt,
      sharesChangedFromPrior: !sharesUnchanged,
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
