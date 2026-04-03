/**
 * Integration test for the new analysis pipeline.
 * Runs all stages in sequence with verbose error reporting.
 * Usage: npx tsx -r dotenv/config scripts/test-pipeline.ts
 */
import "dotenv/config";
import OpenAI from "openai";
import { prisma } from "../src/lib/prisma";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error("❌ No OPENAI_API_KEY"); process.exit(1); }
  const hfKey = process.env.HUGGINGFACE_API_KEY ?? null;

  const openai = new OpenAI({ apiKey });
  console.log("✅ OpenAI client ready");
  console.log(`${hfKey ? "✅" : "⚠️ "} HuggingFace key: ${hfKey ? "present" : "missing"}`);

  // ── Load latest snapshot ──────────────────────────────────────────────────────
  const snapshot = await prisma.portfolioSnapshot.findFirst({
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
    where: { archivedAt: null },
  });
  if (!snapshot) { console.error("❌ No active snapshot found"); process.exit(1); }
  
  const nonCash = snapshot.holdings.filter(h => !h.isCash);
  console.log(`✅ Snapshot loaded: ${nonCash.length} positions`);

  const user = await prisma.user.findUnique({
    where: { id: snapshot.userId },
    include: { profile: true },
  });
  if (!user?.profile) { console.error("❌ No user profile found"); process.exit(1); }
  console.log("✅ User profile loaded");

  const today = new Date().toISOString().split("T")[0];
  const existingTickers = nonCash.map(h => h.ticker);
  console.log(`\nTickers: ${existingTickers.join(", ")}\n`);

  // ── Stage 0-R: Market Regime ──────────────────────────────────────────────────
  console.log("━━━ STAGE 0-R: Market Regime ━━━");
  try {
    const { detectMarketRegime } = await import("../src/lib/research/market-regime");
    const regime = await detectMarketRegime(openai, today, e => {
      if (e.type === "regime") console.log(`  riskMode=${e.riskMode} rates=${e.rateTrend} vix=${e.vix}`);
    });
    console.log(`✅ Regime: ${regime.riskMode} | multiplier: ${regime.aggressionMultiplier}`);
  } catch (err: any) {
    console.error("❌ Market regime failed:", err.message);
  }

  // ── Stage 0-A/B: Gap Analysis ─────────────────────────────────────────────────
  console.log("\n━━━ STAGE 0-A/B: Gap Analysis ━━━");
  let gapReport: any = null;
  try {
    const { runGapAnalysis } = await import("../src/lib/research/gap-analyzer");
    gapReport = await runGapAnalysis(
      openai,
      nonCash.map(h => ({ ticker: h.ticker, currentWeight: 0, isCash: false })),
      user.profile as any,
      today,
      e => { if (e.type === "gap_found") console.log(`  [${e.severity}] ${e.description}`); }
    );
    console.log(`✅ Gap analysis: ${gapReport.gaps.length} gaps found`);
    console.log(`   Search brief: "${gapReport.searchBrief.slice(0, 80)}"`);
  } catch (err: any) {
    console.error("❌ Gap analysis failed:", err.message);
    gapReport = { gaps: [], searchBrief: "growth opportunities", profilePreferences: "" };
  }

  // ── Stage 0-C/D: Candidate Screener ──────────────────────────────────────────
  console.log("\n━━━ STAGE 0-C/D: Candidate Screener ━━━");
  let candidates: any[] = [];
  try {
    const { screenCandidates } = await import("../src/lib/research/candidate-screener");
    candidates = await screenCandidates(
      openai, existingTickers, gapReport.searchBrief, [], user.profile as any, today,
      (e: any) => {
        if (e.type === "candidate_found") console.log(`  Found: ${e.ticker} (${e.source}) — ${e.reason?.slice(0,60)}`);
      }
    );
    console.log(`✅ Candidates: ${candidates.length} found`);
  } catch (err: any) {
    console.error("❌ Candidate screener failed:", err.message);
  }

  // ── Stage 1: News Fetch ───────────────────────────────────────────────────────
  console.log("\n━━━ STAGE 1: News Fetch ━━━");
  let newsResult: any = null;
  const allTickers = [...new Set([...existingTickers, ...candidates.map((c:any) => c.ticker)])];
  console.log(`  Fetching news for ${allTickers.length} tickers...`);
  try {
    const { fetchAllNewsWithFallback } = await import("../src/lib/research/news-fetcher");
    newsResult = await fetchAllNewsWithFallback(openai, allTickers, today, step => {
      const labels = ["24h breaking", "macro/geo", "company", "sector"];
      console.log(`  Search ${step+1}/4: ${labels[step] ?? "search"} complete`);
    });
    const summaryLen = newsResult.combinedSummary?.length ?? 0;
    const breakingLen = newsResult.breaking24h?.length ?? 0;
    console.log(`✅ News: ${summaryLen} chars summary, ${breakingLen} chars breaking, fallback=${newsResult.usingFallback}`);
  } catch (err: any) {
    console.error("❌ News fetch failed:", err.message);
    newsResult = { combinedSummary: "", breaking24h: "", allSources: [], usingFallback: true };
  }

  // ── Stage 1-E: Price Timeline ─────────────────────────────────────────────────
  console.log("\n━━━ STAGE 1-E: Price Timelines ━━━");
  try {
    const { fetchPriceTimelines } = await import("../src/lib/research/price-timeline");
    const timelines = await fetchPriceTimelines(
      allTickers.slice(0, 5), // test with 5 to keep it fast
      new Map(),
      today,
      e => { if (e.type === "price_reaction") console.log(`  ${e.ticker}: ${e.verdict}`); }
    );
    console.log(`✅ Price timelines: ${timelines.size} tickers fetched`);
    for (const [ticker, tl] of timelines) {
      console.log(`  ${ticker}: ${tl.bars.length} bars, day ${tl.dayChangePct > 0 ? "+" : ""}${tl.dayChangePct.toFixed(1)}%`);
    }
  } catch (err: any) {
    console.error("❌ Price timeline failed:", err.message);
  }

  // ── Stage 2: Sentiment Scoring ────────────────────────────────────────────────
  console.log("\n━━━ STAGE 2: Sentiment Scoring ━━━");
  try {
    const { scoreSentimentForAll } = await import("../src/lib/research/sentiment-scorer");
    const tickerArticles = new Map(existingTickers.slice(0, 3).map(t => [t, [{
      title: `${t} related financial news`,
      text: `${t} stock performance update`,
      publishedAt: new Date().toISOString(),
    }]]));
    const signals = await scoreSentimentForAll(tickerArticles, new Map(), hfKey, e => {
      if (e.type === "sentiment_score") {
        console.log(`  ${e.ticker}: ${e.direction} (magnitude=${e.magnitude.toFixed(2)}, confidence=${e.confidence.toFixed(2)})`);
        if (e.finbert !== undefined) console.log(`    FinBERT=${e.finbert}, DistilRoBERTa=${e.fingpt}`);
      }
    });
    console.log(`✅ Sentiment: ${signals.size} signals scored`);
  } catch (err: any) {
    console.error("❌ Sentiment scoring failed:", err.message);
  }

  // ── Stage 3: o3-mini cross-check (simplified) ────────────────────────────────
  console.log("\n━━━ STAGE 3: o3-mini Cross-check ━━━");
  try {
    const res = await openai.chat.completions.create({
      model: "o3-mini",
      max_completion_tokens: 300,
      messages: [{
        role: "user",
        content: `Today is ${today}. Give a one-word verdict (Buy/Hold/Sell) for each: ${existingTickers.slice(0,3).join(", ")}. Return JSON array: [{"ticker":"X","action":"Hold"}]`
      }]
    });
    const raw = res.choices[0]?.message?.content ?? "[]";
    const clean = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    console.log(`✅ o3-mini cross-check: ${parsed.length} verdicts`);
    parsed.forEach((v: any) => console.log(`  ${v.ticker}: ${v.action}`));
  } catch (err: any) {
    console.error("❌ o3-mini failed:", err.message);
  }

  // ── Stage 3: GPT-5.4 analysis ────────────────────────────────────────────────
  console.log("\n━━━ STAGE 3: GPT-5.4 analysis ━━━");
  try {
    const { generatePortfolioReport } = await import("../src/lib/analyzer");
    const { buildResearchContext } = await import("../src/lib/research/context-loader");
    const settingsRec = await prisma.appSettings.findUnique({ where: { key: "portfolio_config" } });
    const settings = settingsRec ? JSON.parse(settingsRec.value) : {};
    
    console.log("  Calling GPT-5.4-pro (may take 60-120s)...");
    const t0 = Date.now();
    const report = await generatePortfolioReport(
      snapshot.holdings, user.profile as any, settings,
      (step) => console.log(`  GPT step ${step+1}`),
      undefined, undefined, undefined, undefined
    );
    console.log(`✅ GPT-5.4: ${report.recommendations.length} recs in ${((Date.now()-t0)/1000).toFixed(0)}s`);
    report.recommendations.slice(0,3).forEach((r: any) => {
      console.log(`  ${r.ticker}: ${r.action} (${r.confidence ?? "?"})`);
    });
  } catch (err: any) {
    console.error("❌ GPT-5.4 failed:", err.message);
  }

  console.log("\n━━━ TEST COMPLETE ━━━");
  await prisma.$disconnect();
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
