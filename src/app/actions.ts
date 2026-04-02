"use server";

import { prisma } from "@/lib/prisma";
import { parsePortfolioScreenshot } from "@/lib/parser";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { enrichPricesCore } from "@/lib/price-fetcher";

// Server action wrapper — delegates to the crypto-aware price fetcher
export async function enrichPricesWithLLM(
  tickers: string[]
): Promise<Record<string, number>> {
  return enrichPricesCore(tickers, process.env.OPENAI_API_KEY);
}

export async function processUpload(formData: FormData) {
  const file = formData.get("file") as File;
  if (!file) throw new Error("No file uploaded.");

  const parsed = await parsePortfolioScreenshot(file);

  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user seeded.");

  await prisma.rawExtraction.create({
    data: {
      userId: user.id,
      rawText: "Mock OCR text",
      imageUrl: "mock-url"
    }
  });

  const snapshot = await prisma.portfolioSnapshot.create({
    data: {
      userId: user.id,
      notes: parsed.warnings?.length ? JSON.stringify(parsed.warnings) : "Parsed from screenshot",
      holdings: {
        create: parsed.holdings.map(p => ({
          ticker: p.ticker,
          companyName: p.companyName,
          shares: p.shares,
          currentPrice: p.currentPrice,
          currentValue: p.currentValue,
          isCash: p.isCash || false
        }))
      }
    }
  });

  redirect(`/review/${snapshot.id}`);
}

export async function runAnalysis(snapshotId: string) {
  void snapshotId;
  throw new Error(
    "runAnalysis() is deprecated. Start analysis through /api/analyze/stream so runs go through the lifecycle service boundary."
  );
}

export async function fetchDailyChanges(tickers: string[]): Promise<Record<string, number | null>> {
  const results: Record<string, number | null> = {};
  if (!tickers || tickers.length === 0) return results;

  const upperTickers = tickers.map(t => t.toUpperCase());
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${upperTickers.join(",")}&range=1d&interval=1d&t=${Date.now()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await res.json();
      const sparkResults = json?.spark?.result ?? [];
      
      for (const item of sparkResults) {
        const ticker = item?.symbol?.toUpperCase();
        if (!ticker) continue;
        
        const meta = item?.response?.[0]?.meta;
        const price = meta?.regularMarketPrice ?? null;
        const prev = meta?.previousClose ?? null;
        
        if (price && prev && prev > 0 && price !== prev) {
          results[ticker] = Math.round(((price - prev) / prev) * 10000) / 100;
        } else {
          results[ticker] = null;
        }
      }
    }
  } catch (e) {
    // Fail silently, daily change is a secondary enhancement
  }
  return results;
}

export async function updateAndConfirmSnapshot(
  snapshotId: string, 
  holdings: { ticker: string; shares: number; currentPrice?: number; currentValue?: number; isCash?: boolean; lastBoughtAt?: string | null }[],
  isQueueOnly: boolean = false
) {
  const tickers = holdings.filter(h => !h.isCash && h.ticker).map(h => h.ticker);
  const dailyChanges = await fetchDailyChanges(tickers);

  await prisma.holding.deleteMany({ where: { snapshotId } });
  
  await prisma.portfolioSnapshot.update({
    where: { id: snapshotId },
    data: {
      confirmed: true, // user has reviewed and saved
      holdings: {
        create: holdings.map(h => ({
          ticker: h.ticker,
          shares: h.shares,
          currentPrice: h.currentPrice,
          currentValue: h.currentValue,
          dailyChangePct: dailyChanges[h.ticker.toUpperCase()] ?? null,
          // Null when blank — never default to today; that was misleading
          lastBoughtAt: h.lastBoughtAt && h.lastBoughtAt.trim() !== ""
            ? new Date(h.lastBoughtAt)
            : null,
          isCash: h.isCash
        }))
      }
    }
  });

  revalidatePath("/");
  
  if (isQueueOnly) {
    redirect("/");
  } else {
    redirect(`/report/generate`);
  }
}

export async function updateProfile(formData: FormData) {
  const user = await prisma.user.findFirst({ include: { profile: true }});
  if (!user || !user.profile) return;
  
  await prisma.userProfile.update({
    where: { id: user.profile.id },
    data: {
      birthYear: parseInt(formData.get('birthYear') as string) || user.profile.birthYear,
      trackedAccountRiskTolerance: (formData.get('trackedAccountRiskTolerance') as string) || user.profile.trackedAccountRiskTolerance,
      trackedAccountObjective: (formData.get('trackedAccountObjective') as string) || user.profile.trackedAccountObjective,
      targetRetirementAge: parseInt(formData.get('targetRetirementAge') as string) || user.profile.targetRetirementAge,
      employmentStatus: String(formData.get('employmentStatus') || '') || undefined,
      profession: String(formData.get('profession') || '') || undefined,
      annualIncomeRange: String(formData.get('annualIncomeRange') || '') || undefined,
      jobStabilityVolatility: String(formData.get('jobStabilityVolatility') || '') || undefined,
      emergencyFundMonths: formData.get('emergencyFundMonths') ? parseFloat(formData.get('emergencyFundMonths') as string) || undefined : undefined,
      separateRetirementAssetsAmount: formData.get('separateRetirementAssetsAmount') ? parseFloat(formData.get('separateRetirementAssetsAmount') as string) || undefined : undefined,
      separateRetirementAccountsDescription: String(formData.get('separateRetirementAccountsDescription') || '') || undefined,
      retirementAccountAssetMix: String(formData.get('retirementAccountAssetMix') || '') || undefined,
      trackedAccountStyle: String(formData.get('trackedAccountStyle') || '') || undefined,
      permittedAssetClasses: formData.getAll('permittedAssetClasses').length > 0 ? formData.getAll('permittedAssetClasses').join(', ') : "",
      trackedAccountTimeHorizon: String(formData.get('trackedAccountTimeHorizon') || '') || undefined,
      trackedAccountTaxStatus: String(formData.get('trackedAccountTaxStatus') || '') || undefined,
      maxDrawdownTolerancePct: formData.get('maxDrawdownTolerancePct') ? parseFloat(formData.get('maxDrawdownTolerancePct') as string) || undefined : undefined,
      leverageOptionsPermitted: String(formData.get('leverageOptionsPermitted') || '') || undefined,
      targetNumberOfHoldings: formData.get('targetNumberOfHoldings') ? parseInt(formData.get('targetNumberOfHoldings') as string) || undefined : undefined,
      maxPositionSizePct: formData.get('maxPositionSizePct') ? parseFloat(formData.get('maxPositionSizePct') as string) || undefined : undefined,
      sectorsToEmphasize: String(formData.get('sectorsToEmphasize') || '') || undefined,
      sectorsToAvoid: String(formData.get('sectorsToAvoid') || '') || undefined,
      notes: String(formData.get('notes') || '') || undefined,
    }
  });
  
  revalidatePath('/settings');
  revalidatePath('/');

  if (formData.get('continueToUpload') === '1') {
    redirect('/upload');
  }
}
