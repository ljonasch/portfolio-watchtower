import { prisma } from "@/lib/prisma";
import { ReviewForm } from "@/components/ReviewForm";
import { notFound } from "next/navigation";

export default async function ReviewPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const snapshot = await prisma.portfolioSnapshot.findUnique({
    where: { id: params.id },
    include: { holdings: true }
  });

  if (!snapshot) return notFound();

  const formattedHoldings = snapshot.holdings.map(h => ({
    id: h.id,
    ticker: h.ticker,
    shares: h.shares,
    currentPrice: h.currentPrice || 0,
    currentValue: h.currentValue || 0,
    isCash: h.isCash
  }));

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

      <ReviewForm snapshotId={snapshot.id} initialHoldings={formattedHoldings} warnings={parserWarnings} />
    </div>
  );
}
