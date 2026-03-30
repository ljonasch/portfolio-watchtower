"use server";

import { prisma } from "@/lib/prisma";
import { parsePortfolioScreenshot } from "@/lib/parser";
import { generatePortfolioReport } from "@/lib/analyzer";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { evaluateAlert } from "@/lib/alerts";
import { compareRecommendations } from "@/lib/comparator";
import OpenAI from "openai";

export async function enrichPricesWithLLM(
  tickers: string[]
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  const failedTickers: string[] = [];

  // --- Stage 1: Direct Yahoo Finance HTTP fetch (live, real-time prices) ---
  const upperTickers = tickers.map(t => t.toUpperCase());
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${upperTickers.join(",")}&range=1d&interval=1d&t=${Date.now()}`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json: any = await res.json();
      const sparkResults = json?.spark?.result ?? [];
      
      for (const item of sparkResults) {
        const ticker = item?.symbol?.toUpperCase();
        if (!ticker) continue;
        
        const meta = item?.response?.[0]?.meta;
        const price = meta?.regularMarketPrice ?? meta?.previousClose ?? null;
        
        if (price && price > 0) {
          results[ticker] = Math.round(price * 100) / 100;
        } else {
          failedTickers.push(ticker);
        }
      }
      
      for (const t of upperTickers) {
        if (!results[t] && !failedTickers.includes(t)) {
          failedTickers.push(t);
        }
      }
    } else {
      upperTickers.forEach(t => failedTickers.push(t));
    }
  } catch (err: any) {
    upperTickers.forEach(t => failedTickers.push(t));
  }

  // --- Stage 2: OpenAI fallback (approximate — model knowledge may be months old) ---
  // Only used when live data is unavailable. Prices returned here are estimates.
  const openAIResolved: string[] = [];
  if (failedTickers.length > 0 && process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const prompt =
        `You are a financial data tool. Return ONLY a valid JSON object mapping each ticker to its most recent known stock price in USD (numbers only, no strings). No markdown, no explanation.\n` +
        `Tickers: ${failedTickers.join(", ")}\n` +
        `Example: {"AAPL": 215.50, "MSFT": 420.00}`;
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 200,
      });
      const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
      // Strip any accidental markdown fences
      const cleaned = raw.replace(/```[a-z]*\n?/gi, "").trim();
      const parsed = JSON.parse(cleaned);
      for (const [ticker, price] of Object.entries(parsed)) {
        const numPrice = Number(price);
        if (numPrice > 0 && !results[ticker.toUpperCase()]) {
          results[ticker.toUpperCase()] = Math.round(numPrice * 100) / 100;
          openAIResolved.push(ticker.toUpperCase());
        }
      }
    } catch {
      // OpenAI fallback also failed — nothing more we can do
    }
  }

  if (Object.keys(results).length === 0) {
    throw new Error(
      `Could not fetch live prices for: ${tickers.join(", ")}. ` +
      `Yahoo Finance appears to be unavailable${process.env.OPENAI_API_KEY ? " and the AI fallback also failed" : " and no OPENAI_API_KEY is set"}. ` +
      `Please enter prices manually.`
    );
  }

  // If some prices came from OpenAI's stale training data, warn the caller
  if (openAIResolved.length > 0 && openAIResolved.length === Object.keys(results).length) {
    throw new Error(
      `⚠️ Live price fetch failed. Prices for ${openAIResolved.join(", ")} were estimated by AI and may be inaccurate — please verify and correct them manually.`
    );
  }

  return results;
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
  const snapshot = await prisma.portfolioSnapshot.findUnique({
    where: { id: snapshotId },
    include: { holdings: true }
  });
  
  if (!snapshot) throw new Error("Snapshot not found");

  const user = await prisma.user.findUnique({
    where: { id: snapshot.userId },
    include: { profile: true }
  });

  const settingsObj = await prisma.appSettings.findUnique({
    where: { key: 'portfolio_config' }
  });

  const settings = settingsObj ? JSON.parse(settingsObj.value) : {};
  
  const latestReport = await prisma.portfolioReport.findFirst({
    orderBy: { createdAt: "desc" },
    include: { recommendations: true },
  });
  
  const reportData = await generatePortfolioReport(
    snapshot.holdings,
    user!.profile!,
    settings,
    undefined,
    latestReport?.recommendations
  );

  // --- NEW: MVP2 AnalysisRun Tracing ---
  const changes = compareRecommendations(
    latestReport?.recommendations || [],
    reportData.recommendations as any
  );
  const alert = evaluateAlert(changes, reportData.recommendations as any, user!.profile!, null);

  const run = await prisma.analysisRun.create({
    data: {
      userId: snapshot.userId,
      snapshotId: snapshot.id,
      triggerType: "manual",
      triggeredBy: user?.name || "User",
      status: "complete",
      alertLevel: alert.level,
      alertReason: alert.reason,
      profileSnapshot: JSON.stringify(user!.profile!),
      startedAt: new Date(),
      completedAt: new Date(),
      changeLogs: {
        create: changes.map(c => ({
          ticker: c.ticker,
          companyName: c.companyName,
          priorAction: c.priorAction,
          newAction: c.newAction,
          priorTargetShares: c.priorTargetShares,
          newTargetShares: c.newTargetShares,
          sharesDelta: c.sharesDelta,
          priorWeight: c.priorWeight,
          newWeight: c.newWeight,
          changed: c.changed,
          changeReason: c.changeReason,
        }))
      }
    }
  });

  const report = await prisma.portfolioReport.create({
    data: {
      userId: snapshot.userId,
      snapshotId: snapshot.id,
      analysisRunId: run.id, // LINK TO RUN
      summary: reportData.summary,
      reasoning: reportData.reasoning,
      marketContext: JSON.stringify(reportData.marketContext ?? { shortTerm: [], mediumTerm: [], longTerm: [] }),
      recommendations: {
        create: reportData.recommendations.map(r => ({
          ticker: r.ticker,
          companyName: r.companyName,
          role: r.role,
          currentShares: r.currentShares,
          targetShares: r.targetShares,
          shareDelta: r.shareDelta,
          currentWeight: r.currentWeight,
          targetWeight: r.targetWeight,
          valueDelta: r.valueDelta,
          action: r.action,
          confidence: r.confidence,
          thesisSummary: r.thesisSummary,
          detailedReasoning: r.detailedReasoning,
          reasoningSources: JSON.stringify(r.reasoningSources ?? []),
        }))
      }
    }
  });

  revalidatePath("/");
  redirect(`/report/${report.id}`);
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
  holdings: { ticker: string; shares: number; currentPrice?: number; currentValue?: number; isCash?: boolean; lastBoughtAt?: string | null }[]
) {
  const tickers = holdings.filter(h => !h.isCash && h.ticker).map(h => h.ticker);
  const dailyChanges = await fetchDailyChanges(tickers);

  await prisma.holding.deleteMany({ where: { snapshotId } });
  
  await prisma.portfolioSnapshot.update({
    where: { id: snapshotId },
    data: {
      holdings: {
        create: holdings.map(h => ({
          ticker: h.ticker,
          shares: h.shares,
          currentPrice: h.currentPrice,
          currentValue: h.currentValue,
          dailyChangePct: dailyChanges[h.ticker.toUpperCase()] ?? null,
          lastBoughtAt: h.lastBoughtAt ? new Date(h.lastBoughtAt) : null,
          isCash: h.isCash
        }))
      }
    }
  });

  revalidatePath("/");
  redirect(`/report/generate`);
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

