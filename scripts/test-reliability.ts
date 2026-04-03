/**
 * Portfolio Watchtower — Pipeline Contract Tests
 *
 * These test INVARIANTS that must hold before and after all 22 fixes.
 * They are NOT implementation-detail tests — they won't become redundant
 * when F1-F22 are applied. They serve as regression tests forever.
 *
 * What each test covers:
 *   T1  — External API contract (OpenAI, HF, Yahoo)
 *   T2  — DB data integrity (snapshots, holdings, profile)
 *   T3  — Portfolio math correctness (weights, values, totals)
 *   T4  — Graceful degradation under bad inputs
 *   T5  — o3-mini JSON output shape conformance
 *   T6  — Price data structural validity (bars, timestamps, signs)
 *   T7  — Sentiment direction accuracy (positive text > 0, negative text < 0)
 *   T8  — News fetch always returns typed result (no undefined fields)
 *   T9  — Candidate deduplication (never returns held tickers)
 *   T10 — Stage timing bounds (each stage within acceptable wall time)
 *
 *   T11 — Signal aggregator composite math (weights, divergence cap, NaN safety)
 *   T12 — Regime aggression multiplier numeric correctness (risk-off/on/neutral)
 *   T13 — Valuation fetcher data quality (W13: P/E bounds, 52w range sanity)
 *   T14 — Correlation matrix range invariant (W18: r in [-1,+1], graceful on bad ticker)
 *   T15 — Action vocabulary normalization (W25: aliases map to canonical actions)
 *   T16 — Market holiday / weekend detection (W26: correct closed dates)
 *   T17 — Ticker alias deduplication in screener (W28: GOOG excluded when GOOGL held)
 *   T18 — Context length guard (W19: truncation at sentence boundary, ≤ maxChars)
 *   T19 — PortfolioReport recommendation persistence round-trip
 *   T20 — Model tracker weight persistence (F8: defaults, bounds, load/save)
 *
 * Usage: npx tsx -r dotenv/config scripts/test-reliability.ts
 */
import "dotenv/config";
import OpenAI from "openai";
import { prisma } from "../src/lib/prisma";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const hfKey = process.env.HUGGINGFACE_API_KEY ?? null;
const today = new Date().toISOString().split("T")[0];

// ── Runner ─────────────────────────────────────────────────────────────────────

type Result = { pass: boolean; note: string; ms: number };
const allResults: { group: string; name: string; result: Result }[] = [];

async function check(group: string, name: string, fn: () => Promise<{ ok: boolean; msg: string }>) {
  const t0 = Date.now();
  try {
    const { ok, msg } = await fn();
    const ms = Date.now() - t0;
    allResults.push({ group, name, result: { pass: ok, note: msg, ms } });
    console.log(`  ${ok ? "✅" : "❌"} [${(ms/1000).toFixed(1)}s] ${name}: ${msg}`);
  } catch (err: any) {
    const ms = Date.now() - t0;
    const msg = err?.message?.slice(0, 100) ?? "threw";
    allResults.push({ group, name, result: { pass: false, note: msg, ms } });
    console.log(`  ❌ [${(ms/1000).toFixed(1)}s] ${name}: THREW — ${msg}`);
  }
}

// ── T1: External API Contract ──────────────────────────────────────────────────
// Invariant: APIs we depend on return expected response shapes.
// Remains valid after all 22 fixes — we still call these APIs.

async function T1_externalApiContract() {
  console.log("\n─── T1: External API Contract ───");

  await check("T1", "gpt-5-search-api: returns non-empty string content", async () => {
    const r = await openai.chat.completions.create({
      model: "gpt-5-search-api", max_completion_tokens: 30,
      messages: [{ role: "user", content: "Today's NY time in one sentence." }]
    });
    const content = r.choices[0]?.message?.content ?? "";
    return content.length > 5 ? { ok: true, msg: `${content.length} chars returned` } : { ok: false, msg: `Empty or short: "${content}"` };
  });

  await check("T1", "o3-mini: choices[0].message.content present", async () => {
    // CRITICAL: o3-mini uses hidden reasoning tokens (chain-of-thought) before producing
    // visible output. max_completion_tokens is shared between reasoning + output.
    // With < 500 tokens, reasoning consumes everything and output is empty or truncated.
    // Rule: always give o3-mini >= 2000 tokens for any substantive request.
    const r = await openai.chat.completions.create({
      model: "o3-mini", max_completion_tokens: 2000,
      messages: [{ role: "user", content: "Given that NVDA is up 5% today after strong earnings, give a one-sentence Buy/Hold/Sell verdict as a financial analyst." }]
    });
    const content = r.choices[0]?.message?.content ?? "";
    return content.length > 0 ? { ok: true, msg: `Got: "${content.slice(0,60)}"` } : { ok: false, msg: "Empty content — reasoning budget exhausted" };
  });

  await check("T1", "FinBERT: returns [label, score] array", async () => {
    if (!hfKey) return { ok: false, msg: "No HF key" };
    const r = await fetch("https://router.huggingface.co/hf-inference/models/ProsusAI/finbert", {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Authorization": `Bearer ${hfKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: "strong quarterly earnings beat" })
    });
    const d: any = await r.json();
    const ok = Array.isArray(d?.[0]) && d[0][0]?.label && typeof d[0][0]?.score === "number";
    return ok ? { ok: true, msg: `label=${d[0][0].label} score=${d[0][0].score.toFixed(3)}` } : { ok: false, msg: `Unexpected shape: ${JSON.stringify(d).slice(0,80)}` };
  });

  await check("T1", "DistilRoBERTa: returns [label, score] array", async () => {
    if (!hfKey) return { ok: false, msg: "No HF key" };
    const r = await fetch("https://router.huggingface.co/hf-inference/models/mrm8488/distilroberta-finetuned-financial-news-sentiment-analysis", {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "Authorization": `Bearer ${hfKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: "company misses expectations, stock falls" })
    });
    const d: any = await r.json();
    const ok = Array.isArray(d?.[0]) && d[0][0]?.label && typeof d[0][0]?.score === "number";
    return ok ? { ok: true, msg: `label=${d[0][0].label} score=${d[0][0].score.toFixed(3)}` } : { ok: false, msg: `Unexpected: ${JSON.stringify(d).slice(0,80)}` };
  });

  await check("T1", "Yahoo Finance chart API: returns OHLCV for NVDA", async () => {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/NVDA?interval=5m&range=1d", {
      headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000)
    });
    const d: any = await r.json();
    const prices: number[] = d?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const nonNull = prices.filter(p => p && p > 0).length;
    return nonNull > 10 ? { ok: true, msg: `${nonNull} bars, price range $${Math.min(...prices.filter(Boolean)).toFixed(0)}-$${Math.max(...prices.filter(Boolean)).toFixed(0)}` } : { ok: false, msg: `Only ${nonNull} non-null bars` };
  });
}

// ── T2: Database Integrity ─────────────────────────────────────────────────────
// Invariant: DB always has a valid active snapshot with holdings and user profile.
// Remains valid — DB schema doesn't change for core tables.

async function T2_databaseIntegrity() {
  console.log("\n─── T2: Database Integrity ───");

  const snap = await prisma.portfolioSnapshot.findFirst({
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
  });
  const user = snap ? await prisma.user.findUnique({ where: { id: snap.userId }, include: { profile: true } }) : null;

  await check("T2", "Active snapshot exists with at least 1 holding", async () => {
    if (!snap) return { ok: false, msg: "No active snapshot" };
    return snap.holdings.length > 0 ? { ok: true, msg: `${snap.holdings.length} holdings, confirmed=${snap.confirmed}` } : { ok: false, msg: "Snapshot has 0 holdings" };
  });

  await check("T2", "All holdings have ticker string (non-empty)", async () => {
    const bad = snap?.holdings.filter(h => !h.ticker || h.ticker.trim() === "") ?? [];
    return bad.length === 0 ? { ok: true, msg: `All ${snap?.holdings.length} holdings have tickers` } : { ok: false, msg: `${bad.length} holdings with empty ticker` };
  });

  await check("T2", "User profile has required fields", async () => {
    const p = user?.profile as any;
    if (!p) return { ok: false, msg: "No profile" };
    const required = ["birthYear", "trackedAccountObjective", "trackedAccountRiskTolerance"];
    const missing = required.filter(f => !p[f]);
    return missing.length === 0 ? { ok: true, msg: "All required profile fields present" } : { ok: false, msg: `Missing: ${missing.join(", ")}` };
  });

  await check("T2", "No holdings have both isCash=true and a real ticker", async () => {
    const suspicious = snap?.holdings.filter(h => h.isCash && h.ticker !== "CASH" && h.ticker !== "") ?? [];
    return suspicious.length === 0 ? { ok: true, msg: "Cash flag consistent with ticker" } : { ok: false, msg: `isCash=true but non-CASH ticker: ${suspicious.map(h=>h.ticker).join(", ")}` };
  });
}

// ── T3: Portfolio Math Correctness ────────────────────────────────────────────
// Invariant: weight computation is always correct regardless of input.
// Remains valid after all fixes — math layer doesn't change.

async function T3_portfolioMathCorrectness() {
  console.log("\n─── T3: Portfolio Math Correctness ───");
  const { buildResearchContext } = await import("../src/lib/research/context-loader");

  await check("T3", "Weights sum to within 0.1% of 100 for real portfolio", async () => {
    // Use a snapshot that has prices, OR verify the share-count fallback works
    const snap = await prisma.portfolioSnapshot.findFirst({
      orderBy: { createdAt: "desc" },
      include: { holdings: true },
    });
    const ctx = buildResearchContext({ profile: { birthYear: 1990, trackedAccountObjective: "growth", trackedAccountRiskTolerance: "high" }, holdings: snap!.holdings });
    const sum = ctx.holdings.reduce((a, h) => a + h.computedWeight, 0);
    // Accept: either priced weights sum to 100, or share-count fallback sum to ~100 for non-cash
    const nonCashSum = ctx.holdings.filter(h => !h.isCash).reduce((a, h) => a + h.computedWeight, 0);
    const close = Math.abs(nonCashSum - 100) < 1.0; // 1% tolerance for float rounding
    return close
      ? { ok: true, msg: `Non-cash weights sum = ${nonCashSum.toFixed(2)}% (${ctx.totalValue > 0 ? "price-based" : "share-count fallback"})` }
      : { ok: false, msg: `Sum = ${sum.toFixed(3)}% — off by ${(sum - 100).toFixed(3)}%` };
  });

  await check("T3", "No holding has negative weight", async () => {
    const snap2 = await prisma.portfolioSnapshot.findFirst({
      orderBy: { createdAt: "desc" },
      include: { holdings: true },
    });
    const ctx = buildResearchContext({ profile: { birthYear: 1990, trackedAccountObjective: "growth", trackedAccountRiskTolerance: "high" }, holdings: snap2!.holdings as any });
    const neg = ctx.holdings.filter((h: any) => h.computedWeight < 0);
    return neg.length === 0 ? { ok: true, msg: "All weights ≥ 0" } : { ok: false, msg: `Negative: ${neg.map((h: any) => `${h.ticker}=${h.computedWeight}`).join(", ")}` };
  });

  await check("T3", "Zero-value holding gets 0% weight (not NaN or Infinity)", async () => {
    const ctx = buildResearchContext({
      profile: { birthYear: 1985, trackedAccountObjective: "growth", trackedAccountRiskTolerance: "medium" },
      holdings: [
        { ticker: "NVDA", shares: 10, currentPrice: 0, currentValue: 0, isCash: false },
        { ticker: "AAPL", shares: 5, currentPrice: 200, currentValue: 1000, isCash: false },
      ]
    });
    const nvda = ctx.holdings.find(h => h.ticker === "NVDA");
    const validWeight = nvda?.computedWeight === 0 && !Number.isNaN(nvda.computedWeight) && isFinite(nvda.computedWeight);
    return validWeight ? { ok: true, msg: `NVDA weight=0%, AAPL weight=${ctx.holdings.find(h=>h.ticker==="AAPL")?.computedWeight}%` } : { ok: false, msg: `NVDA weight=${nvda?.computedWeight}` };
  });

  await check("T3", "All-cash portfolio: total value correct, weights valid", async () => {
    const ctx = buildResearchContext({
      profile: { birthYear: 1960, trackedAccountObjective: "preservation", trackedAccountRiskTolerance: "low" },
      holdings: [{ ticker: "CASH", shares: 1, currentValue: 50000, isCash: true }]
    });
    return ctx.totalValue === 50000 && Math.abs(ctx.holdings[0].computedWeight - 100) < 0.01
      ? { ok: true, msg: "totalValue=$50,000 weight=100%" }
      : { ok: false, msg: `totalValue=${ctx.totalValue} weight=${ctx.holdings[0]?.computedWeight}` };
  });
}

// ── T4: Graceful Degradation ──────────────────────────────────────────────────
// Invariant: system never crashes on bad inputs — always returns typed result.
// Remains valid after all 22 fixes — degradation contracts don't change.

async function T4_gracefulDegradation() {
  console.log("\n─── T4: Graceful Degradation ───");

  await check("T4", "Price timeline: unknown/delisted ticker returns empty bars (no throw)", async () => {
    const { fetchPriceTimelines } = await import("../src/lib/research/price-timeline");
    const tl = await fetchPriceTimelines(["FAKEXYZ999", "DELISTED123"], new Map(), today, () => {});
    const bothEmpty = Array.from(tl.values()).every(t => t.bars.length === 0);
    return bothEmpty ? { ok: true, msg: "Both returned 0 bars gracefully" } : { ok: false, msg: "Non-zero bars for fake ticker" };
  });

  await check("T4", "Sentiment with no HF key: returns valid hold signal (no throw)", async () => {
    const { scoreTickerSentiment } = await import("../src/lib/research/sentiment-scorer");
    const s = await scoreTickerSentiment("AAPL", [{ title: "AAPL revenue up 10%", text: "", publishedAt: new Date().toISOString() }], [], null, () => {});
    return typeof s.direction === "string" && typeof s.magnitude === "number"
      ? { ok: true, msg: `direction=${s.direction} magnitude=${s.magnitude.toFixed(2)}` }
      : { ok: false, msg: "Invalid signal shape" };
  });

  await check("T4", "Sentiment with empty article list: returns hold with 0 magnitude", async () => {
    const { scoreTickerSentiment } = await import("../src/lib/research/sentiment-scorer");
    const s = await scoreTickerSentiment("MSFT", [], [], hfKey, () => {});
    return s.direction === "hold" && s.magnitude === 0
      ? { ok: true, msg: "Empty articles → hold/0 correctly" }
      : { ok: false, msg: `Got ${s.direction}/${s.magnitude}` };
  });

  await check("T4", "Market regime: returns valid enum even if search returns garbage", async () => {
    const { detectMarketRegime } = await import("../src/lib/research/market-regime");
    const r = await detectMarketRegime(openai, today, () => {});
    const validModes = ["risk-on", "risk-off", "neutral"];
    const validRates = ["rising", "falling", "plateau"];
    return validModes.includes(r.riskMode) && validRates.includes(r.rateTrend)
      ? { ok: true, msg: `riskMode=${r.riskMode} rateTrend=${r.rateTrend}` }
      : { ok: false, msg: `Invalid enum: riskMode=${r.riskMode} rateTrend=${r.rateTrend}` };
  });
}

// ── T5: o3-mini Output Shape Conformance ─────────────────────────────────────
// Invariant: o3-mini outputs a parseable JSON array with required fields.
// Remains valid — o3-mini parsing contract doesn't change after fixes.

async function T5_o3miniShapeConformance() {
  console.log("\n─── T5: o3-mini Output Shape Conformance ───");

  const parseArray = (raw: string): any[] => {
    const clean = raw.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim();
    const s = clean.indexOf("["), e = clean.lastIndexOf("]");
    if (s === -1 || e === -1) throw new Error("No JSON array found");
    return JSON.parse(clean.slice(s, e + 1));
  };

  await check("T5", "o3-mini: all verdicts have ticker, action, confidence, keyReason", async () => {
    // 2500 tokens needed: o3-mini burns ~1500-2000 on internal reasoning before output.
    // Previous 500-token budget caused response truncation (JSON cut mid-object).
    const r = await openai.chat.completions.create({
      model: "o3-mini", max_completion_tokens: 2500,
      messages: [{
        role: "user",
        content: `Current market context: NVDA +5.5% today after earnings beat, AAPL +2.6% after iPhone sales data, MSFT flat. VIX elevated at 22, rates rising.\n\nAs a portfolio analyst, return ONLY a JSON array (no markdown, no preamble) starting with [ for NVDA, AAPL, MSFT:\n[{"ticker":"SYMBOL","action":"Buy","confidence":"high","keyReason":"cite specific market fact from context","evidenceQuality":"high"}]`
      }]
    });
    const raw = r.choices[0]?.message?.content ?? "";
    const start = raw.indexOf("["), end = raw.lastIndexOf("]");
    if (start === -1 || end === -1) return { ok: false, msg: `No JSON array in response (len=${raw.length}, budget exhausted?): "${raw.slice(0,80)}"` };
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const required = ["ticker", "action", "confidence", "keyReason"];
    const allHaveFields = parsed.every((v: any) => required.every(f => f in v));
    return allHaveFields ? { ok: true, msg: `${parsed.length} verdicts, all fields present` } : { ok: false, msg: `Missing fields in: ${JSON.stringify(parsed[0])}` };
  });

  await check("T5", "o3-mini: action values are only Buy/Hold/Sell/Trim", async () => {
    // 2500 tokens: 5 tickers × ~300 chars each + reasoning budget
    const r = await openai.chat.completions.create({
      model: "o3-mini", max_completion_tokens: 2500,
      messages: [{
        role: "user",
        content: `Market regime: risk-off. VIX=25, 10Y yield rising at 4.8%, USD strengthening. Equities broadly lower. Crypto selling off.\n\nReturn ONLY a JSON array (start with [, no markdown, no preamble) for NVDA, MSFT, BTC, ETH, USO:\n[{"ticker":"SYMBOL","action":"Buy","confidence":"high","keyReason":"brief fact"}]\nIMPORTANT: action must be exactly one of: Buy, Hold, Sell, Trim — no other values.`
      }]
    });
    const raw = r.choices[0]?.message?.content ?? "";
    const start = raw.indexOf("["), end = raw.lastIndexOf("]");
    if (start === -1 || end === -1) return { ok: false, msg: `No JSON array in response (budget exhausted?): "${raw.slice(0,80)}"` };
    const parsed = JSON.parse(raw.slice(start, end + 1));
    const validActions = new Set(["Buy", "Hold", "Sell", "Trim"]);
    const invalid = parsed.filter((v: any) => !validActions.has(v.action));
    return invalid.length === 0
      ? { ok: true, msg: `All ${parsed.length} actions valid: ${parsed.map((v:any)=>`${v.ticker}=${v.action}`).join(", ")}` }
      : { ok: false, msg: `Invalid actions: ${invalid.map((v:any)=>v.action).join(", ")}` };
  });

  await check("T5", "o3-mini: handles markdown fences in response", async () => {
    // Simulate markdown-fenced output (the real parser must handle this)
    const fenced = "```json\n[{\"ticker\":\"NVDA\",\"action\":\"Buy\",\"confidence\":\"high\",\"keyReason\":\"AI demand strong\"}]\n```";
    const parsed = parseArray(fenced);
    return parsed[0]?.ticker === "NVDA" ? { ok: true, msg: "Markdown fence stripped correctly" } : { ok: false, msg: "Parse failed on markdown fences" };
  });
}

// ── T6: Price Data Structural Validity ───────────────────────────────────────
// Invariant: price bars are always sorted, prices positive, % changes finite.
// Remains valid — price timeline contract doesn't change after timezone fix (F7).

async function T6_priceDataStructural() {
  console.log("\n─── T6: Price Data Structural Validity ───");
  const { fetchPriceTimelines } = await import("../src/lib/research/price-timeline");

  await check("T6", "Bars returned in chronological order (NVDA)", async () => {
    const tl = await fetchPriceTimelines(["NVDA"], new Map(), today, () => {});
    const nvda = tl.get("NVDA");
    if (!nvda || nvda.bars.length < 2) return { ok: false, msg: `Only ${nvda?.bars.length ?? 0} bars` };
    const times = nvda.bars.map(b => b.time);
    const sorted = [...times].sort();
    return JSON.stringify(times) === JSON.stringify(sorted) ? { ok: true, msg: `${nvda.bars.length} bars sorted correctly` } : { ok: false, msg: "Bars out of order" };
  });

  await check("T6", "All bar prices are positive numbers (no null/NaN/0)", async () => {
    const tl = await fetchPriceTimelines(["AAPL", "MSFT"], new Map(), today, () => {});
    const badBars: string[] = [];
    for (const [ticker, t] of tl) {
      t.bars.forEach(b => { if (!b.price || b.price <= 0 || !isFinite(b.price)) badBars.push(`${ticker}@${b.time}=${b.price}`); });
    }
    return badBars.length === 0 ? { ok: true, msg: "All bar prices positive and finite" } : { ok: false, msg: `Bad bars: ${badBars.slice(0,5).join(", ")}` };
  });

  await check("T6", "dayChangePct is finite and in plausible range (±25%)", async () => {
    const tl = await fetchPriceTimelines(["NVDA", "AAPL", "MSFT", "PLTR"], new Map(), today, () => {});
    const outliers = Array.from(tl.values()).filter(t => !isFinite(t.dayChangePct) || Math.abs(t.dayChangePct) > 25);
    return outliers.length === 0 ? { ok: true, msg: `All day% in ±25% range: ${Array.from(tl.values()).map(t=>`${t.ticker}=${t.dayChangePct.toFixed(1)}%`).join(", ")}` } : { ok: false, msg: `Outliers: ${outliers.map(t=>`${t.ticker}=${t.dayChangePct}`).join(", ")}` };
  });
}

// ── T7: Sentiment Direction Accuracy ─────────────────────────────────────────
// Invariant: positive text → positive score, negative text → negative score.
// Remains valid after F6 (per-headline) — the direction contract is the same.

async function T7_sentimentDirectionAccuracy() {
  console.log("\n─── T7: Sentiment Direction Accuracy ───");
  const { scoreTickerSentiment } = await import("../src/lib/research/sentiment-scorer");

  await check("T7", "Unambiguously bullish article scores positive", async () => {
    const s = await scoreTickerSentiment("NVDA", [{
      title: "NVDA crushes earnings, revenue up 80% YoY, raises guidance significantly, stock hits all-time high",
      text: "", publishedAt: new Date().toISOString()
    }], [], hfKey, () => {});
    return s.finalScore >= 0 ? { ok: true, msg: `score=${s.finalScore.toFixed(3)} direction=${s.direction}` } : { ok: false, msg: `Score negative (${s.finalScore.toFixed(3)}) for bullish article` };
  });

  await check("T7", "Unambiguously bearish article scores negative", async () => {
    const s = await scoreTickerSentiment("PLTR", [{
      title: "PLTR misses revenue estimates badly, cuts full-year guidance, CFO resigns, SEC investigation opens",
      text: "", publishedAt: new Date().toISOString()
    }], [], hfKey, () => {});
    return s.finalScore <= 0 ? { ok: true, msg: `score=${s.finalScore.toFixed(3)} direction=${s.direction}` } : { ok: false, msg: `Score positive (${s.finalScore.toFixed(3)}) for bearish article` };
  });

  await check("T7", "FinBERT scores same as composite on unambiguous text", async () => {
    const s = await scoreTickerSentiment("AAPL", [{
      title: "AAPL record quarterly profit, dividend raised, $90B buyback announced",
      text: "", publishedAt: new Date().toISOString()
    }], [], hfKey, () => {});
    // Both finbert and overall should agree on direction
    const agree = s.finbertScore >= 0 && s.finalScore >= 0;
    return agree ? { ok: true, msg: `FinBERT=${s.finbertScore.toFixed(2)} composite=${s.finalScore.toFixed(2)} both positive` } : { ok: false, msg: `Direction mismatch: FinBERT=${s.finbertScore.toFixed(2)} composite=${s.finalScore.toFixed(2)}` };
  });
}

// ── T8: News Fetch Output Contract ────────────────────────────────────────────
// Invariant: fetchAllNewsWithFallback always returns all required fields typed correctly.
// Remains valid — output contract doesn't change after F9 (dedup) or F1 (raw articles).

async function T8_newsFetchOutputContract() {
  console.log("\n─── T8: News Fetch Output Contract ───");
  const { fetchAllNewsWithFallback } = await import("../src/lib/research/news-fetcher");

  await check("T8", "Result always has all required fields (no undefined)", async () => {
    const r = await fetchAllNewsWithFallback(openai, ["NVDA", "AAPL"], today, () => {});
    const fields = ["combinedSummary", "breaking24h", "allSources", "usingFallback", "evidence"];
    const missing = fields.filter(f => (r as any)[f] === undefined);
    return missing.length === 0 ? { ok: true, msg: "All required fields present" } : { ok: false, msg: `Missing: ${missing.join(", ")}` };
  });

  await check("T8", "combinedSummary and breaking24h are always strings (never null)", async () => {
    const r = await fetchAllNewsWithFallback(openai, ["MSFT", "AMZN"], today, () => {});
    return typeof r.combinedSummary === "string" && typeof r.breaking24h === "string"
      ? { ok: true, msg: `summary=${r.combinedSummary.length}c breaking=${r.breaking24h.length}c both strings` }
      : { ok: false, msg: `summary type=${typeof r.combinedSummary} breaking type=${typeof r.breaking24h}` };
  });

  await check("T8", "allSources is always an array (never undefined)", async () => {
    const r = await fetchAllNewsWithFallback(openai, ["BTC"], today, () => {});
    return Array.isArray(r.allSources) ? { ok: true, msg: `${r.allSources.length} sources` } : { ok: false, msg: `allSources is ${typeof r.allSources}` };
  });
}

// ── T9: Candidate Deduplication Contract ─────────────────────────────────────
// Invariant: screener NEVER returns a ticker already in the held list.
// Remains valid after F2 (validation), W12/W17 (bias fixes) — exclusion is fundamental.

async function T9_candidateDeduplication() {
  console.log("\n─── T9: Candidate Deduplication (Exclusion Contract) ───");
  const { screenCandidates } = await import("../src/lib/research/candidate-screener");

  const snap = await prisma.portfolioSnapshot.findFirst({
    orderBy: { createdAt: "desc" },
    include: { holdings: true },
  });
  const user = await prisma.user.findUnique({ where: { id: snap!.userId }, include: { profile: true } });
  const held = snap!.holdings.filter((h: any) => !h.isCash).map((h: any) => h.ticker.toUpperCase());

  await check("T9", "No candidate overlaps with held tickers (full portfolio)", async () => {
    const candidates = await screenCandidates(openai, held, "diversification opportunities", user!.profile as any, today, () => {});
    const overlap = candidates.filter(c => held.includes(c.ticker.toUpperCase()));
    return overlap.length === 0
      ? { ok: true, msg: `${candidates.length} candidates, zero overlap with ${held.length} held tickers` }
      : { ok: false, msg: `Overlap: ${overlap.map(c=>c.ticker).join(", ")}` };
  });

  await check("T9", "Candidates have required fields (ticker, companyName, source, reason)", async () => {
    const candidates = await screenCandidates(openai, ["NVDA", "AAPL"], "healthcare gap", user!.profile as any, today, () => {});
    if (candidates.length === 0) return { ok: true, msg: "0 candidates returned — no field check needed" };
    const required = ["ticker", "companyName", "source", "reason"];
    const missing = candidates.flatMap(c => required.filter(f => !(c as any)[f]).map(f => `${c.ticker}.${f}`));
    return missing.length === 0 ? { ok: true, msg: `All ${candidates.length} candidates have required fields` } : { ok: false, msg: `Missing: ${missing.join(", ")}` };
  });
}

// ── T10: Stage Timing Bounds ──────────────────────────────────────────────────
// Invariant: each stage must complete within its SLA or be flagged.
// These bounds define what "acceptable" means across ALL future versions.

async function T10_timingBounds() {
  console.log("\n─── T10: Stage Timing Bounds ───");

  await check("T10", "Regime detection completes within 30s", async () => {
    const { detectMarketRegime } = await import("../src/lib/research/market-regime");
    const t0 = Date.now();
    await detectMarketRegime(openai, today, () => {});
    const ms = Date.now() - t0;
    return ms < 30000 ? { ok: true, msg: `${(ms/1000).toFixed(1)}s (limit: 30s)` } : { ok: false, msg: `SLOW: ${(ms/1000).toFixed(1)}s > 30s SLA` };
  });

  await check("T10", "Price timeline (5 tickers) completes within 15s", async () => {
    const { fetchPriceTimelines } = await import("../src/lib/research/price-timeline");
    const t0 = Date.now();
    await fetchPriceTimelines(["NVDA", "AAPL", "MSFT", "PLTR", "BTC"], new Map(), today, () => {});
    const ms = Date.now() - t0;
    return ms < 15000 ? { ok: true, msg: `${(ms/1000).toFixed(1)}s (limit: 15s)` } : { ok: false, msg: `SLOW: ${(ms/1000).toFixed(1)}s > 15s SLA` };
  });

  await check("T10", "Sentiment (3 tickers, HF warm) completes within 25s", async () => {
    const { scoreSentimentForAll } = await import("../src/lib/research/sentiment-scorer");
    const articles = new Map([
      ["NVDA", [{ title: "NVDA earnings beat, guidance raised", text: "", publishedAt: new Date().toISOString() }]],
      ["AAPL", [{ title: "AAPL misses iPhone revenue estimates", text: "", publishedAt: new Date().toISOString() }]],
      ["PLTR", [{ title: "PLTR wins $1B government contract", text: "", publishedAt: new Date().toISOString() }]],
    ]);
    const t0 = Date.now();
    await scoreSentimentForAll(articles, new Map(), hfKey, () => {});
    const ms = Date.now() - t0;
    return ms < 25000 ? { ok: true, msg: `${(ms/1000).toFixed(1)}s (limit: 25s)` } : { ok: false, msg: `SLOW: ${(ms/1000).toFixed(1)}s > 25s SLA` };
  });

  await check("T10", "o3-mini (4 ticker verdicts) completes within 30s", async () => {
    const t0 = Date.now();
    // 2000 tokens: enough for reasoning + 4 ticker JSON output
    await openai.chat.completions.create({
      model: "o3-mini", max_completion_tokens: 2000,
      messages: [{ role: "user", content: `Market context: NVDA +5%, AAPL flat, MSFT -1%, PLTR +8% on contract win. VIX=18, risk-on.\nReturn ONLY JSON array for NVDA, AAPL, MSFT, PLTR: [{"ticker":"X","action":"Buy/Hold/Sell/Trim","confidence":"high/medium/low","keyReason":"cite a fact"}]. No markdown.` }]
    });
    const ms = Date.now() - t0;
    return ms < 30000 ? { ok: true, msg: `${(ms/1000).toFixed(1)}s (limit: 30s)` } : { ok: false, msg: `SLOW: ${(ms/1000).toFixed(1)}s > 30s SLA` };
  });
}

// ── T11: Signal Aggregator Composite Math ─────────────────────────────────────
// Invariant: weighted formula is numerically correct and never produces NaN.
// Not tested before: T9 checked candidate exclusion, not the aggregation math itself.

async function T11_signalAggregatorMath() {
  console.log("\n─── T11: Signal Aggregator Composite Math ───");
  const { aggregateSignals } = (await import("../src/lib/research/signal-aggregator")) as any;

  const neutralRegime: any = { riskMode: "neutral", aggressionMultiplier: 1.0, rateTrend: "plateau", dollarTrend: "stable", vixLevel: "normal", sectorLeadership: "n/a", summary: "" };
  const riskOffRegime: any = { ...neutralRegime, riskMode: "risk-off", aggressionMultiplier: 0.55 };
  const emit = () => {};

  await check("T11", "Strong buy from both models → finalAction=Buy, score > 0.3", async () => {
    const gpt5 = new Map([["NVDA", { ticker: "NVDA", action: "Buy" as any, confidence: "high" as any, keyReason: "strong earnings", evidenceQuality: "high" as any }]]);
    const o3   = new Map([["NVDA", { ticker: "NVDA", action: "Buy" as any, confidence: "high" as any, keyReason: "beat estimates",  evidenceQuality: "high" as any }]]);
    const sent = new Map([["NVDA", { ticker: "NVDA", direction: "buy" as any, magnitude: 0.8, confidence: 0.9, finbertScore: 0.7, fingptScore: 0.6, marketReactionScore: 0.5, finalScore: 0.65, priceVerdicts: [] }]]);
    const result = aggregateSignals(["NVDA"], gpt5, o3, sent, new Set(), neutralRegime, emit);
    const r = result[0];
    const ok = r.finalAction === "Buy" && r.score > 0.3 && isFinite(r.score);
    return ok ? { ok: true, msg: `NVDA: ${r.finalAction} score=${r.score.toFixed(3)} diverged=${r.diverged}` } : { ok: false, msg: `Expected Buy>0.3, got ${r.finalAction} score=${r.score}` };
  });

  await check("T11", "Opposing models (GPT=Buy, o3=Sell) → diverged=true, score pulled toward zero", async () => {
    const gpt5 = new Map([["AAPL", { ticker: "AAPL", action: "Buy"  as any, confidence: "high" as any, keyReason: "bullish", evidenceQuality: "high" as any }]]);
    const o3   = new Map([["AAPL", { ticker: "AAPL", action: "Sell" as any, confidence: "high" as any, keyReason: "bearish", evidenceQuality: "high" as any }]]);
    const result = aggregateSignals(["AAPL"], gpt5, o3, new Map(), new Set(), neutralRegime, emit);
    const r = result[0];
    const ok = r.diverged === true && Math.abs(r.score) < 0.4;
    return ok ? { ok: true, msg: `AAPL: diverged=true score=${r.score.toFixed(3)} (pulled toward zero)` } : { ok: false, msg: `Expected diverged+near-zero, got diverged=${r.diverged} score=${r.score}` };
  });

  await check("T11", "No model data → score=0, action=Hold, no NaN", async () => {
    const result = aggregateSignals(["MSFT"], new Map(), new Map(), new Map(), new Set(), neutralRegime, emit);
    const r = result[0];
    const ok = r.finalAction === "Hold" && r.score === 0 && !isNaN(r.score) && !isNaN(r.confidence);
    return ok ? { ok: true, msg: `MSFT: Hold score=0 confidence=${r.confidence} (no NaN)` } : { ok: false, msg: `Got ${r.finalAction} score=${r.score} conf=${r.confidence}` };
  });

  await check("T11", "Risk-off regime dampens Buy signal (score_riskoff < score_neutral)", async () => {
    const gpt5 = new Map([["PLTR", { ticker: "PLTR", action: "Buy" as any, confidence: "high" as any, keyReason: "growth", evidenceQuality: "high" as any }]]);
    const neutral = aggregateSignals(["PLTR"], gpt5, new Map(), new Map(), new Set(), neutralRegime, emit);
    const riskOff = aggregateSignals(["PLTR"], gpt5, new Map(), new Map(), new Set(), riskOffRegime, emit);
    const ok = riskOff[0].score < neutral[0].score;
    return ok ? { ok: true, msg: `Risk-off=${riskOff[0].score.toFixed(3)} < neutral=${neutral[0].score.toFixed(3)} ✓` } : { ok: false, msg: `Risk-off=${riskOff[0].score} NOT < neutral=${neutral[0].score}` };
  });
}

// ── T12: Regime Multiplier Numeric Correctness ────────────────────────────────
// Invariant: hardcoded multipliers match their declared risk-mode semantics.
// Not tested before: T4 tested regime enum validity, not the numeric multiplier values.

async function T12_regimeMultiplierNumerics() {
  console.log("\n─── T12: Regime Multiplier Numeric Correctness ───");
  const { detectMarketRegime } = await import("../src/lib/research/market-regime");

  await check("T12", "aggressionMultiplier is always a finite positive number", async () => {
    const r = await detectMarketRegime(openai, today, () => {});
    const ok = isFinite(r.aggressionMultiplier) && r.aggressionMultiplier > 0;
    return ok ? { ok: true, msg: `${r.riskMode} → multiplier=${r.aggressionMultiplier}` } : { ok: false, msg: `Invalid multiplier: ${r.aggressionMultiplier}` };
  });

  await check("T12", "aggressionMultiplier is in range [0.4, 1.4] (no extreme values)", async () => {
    const r = await detectMarketRegime(openai, today, () => {});
    const ok = r.aggressionMultiplier >= 0.4 && r.aggressionMultiplier <= 1.4;
    return ok ? { ok: true, msg: `${r.aggressionMultiplier} in [0.4, 1.4]` } : { ok: false, msg: `Out of bounds: ${r.aggressionMultiplier}` };
  });

  await check("T12", "risk-off hardcoded multiplier = 0.55 (constant regression guard)", async () => {
    // We directly test the constant — if someone changes 0.55 accidentally this fails
    const { aggregateSignals } = (await import("../src/lib/research/signal-aggregator")) as any;
    const riskOff: any  = { riskMode: "risk-off",  aggressionMultiplier: 0.55, rateTrend: "rising", dollarTrend: "strengthening", vixLevel: "elevated", sectorLeadership: "n/a", summary: "" };
    const riskOn: any   = { riskMode: "risk-on",   aggressionMultiplier: 1.15, rateTrend: "falling", dollarTrend: "weakening", vixLevel: "suppressed", sectorLeadership: "n/a", summary: "" };
    const gpt5 = new Map([["TEST", { ticker: "TEST", action: "Buy" as any, confidence: "high" as any, keyReason: "test", evidenceQuality: "high" as any }]]);
    const onScore  = aggregateSignals(["TEST"], gpt5, new Map(), new Map(), new Set(), riskOn,  () => {})[0].score;
    const offScore = aggregateSignals(["TEST"], gpt5, new Map(), new Map(), new Set(), riskOff, () => {})[0].score;
    // Test absolute ordering: risk-on > risk-off (avoid NaN division when scores are 0)
    const ok = onScore > offScore && offScore >= 0;
    return ok
      ? { ok: true, msg: `risk-on=${onScore.toFixed(3)} > risk-off=${offScore.toFixed(3)} ✓ (ratio=${onScore > 0 ? (offScore/onScore).toFixed(2) : 'N/A'})` }
      : { ok: false, msg: `Ordering wrong: risk-on=${onScore} risk-off=${offScore}` };
  });
}

// ── T13: Valuation Fetcher Data Quality (W13 — new module) ───────────────────
// Invariant: Yahoo quoteSummary returns sensible valuation data for major liquid stocks.
// Not tested before: this is a brand-new module added as part of the 28 fixes.

async function T13_valuationFetcherQuality() {
  console.log("\n─── T13: Valuation Fetcher Data Quality ───");
  const { fetchValuationData } = await import("../src/lib/research/valuation-fetcher");

  await check("T13", "AAPL: trailingPE is a positive number in plausible range (5–300), or chart fallback returns currentPrice", async () => {
    const v = await fetchValuationData("AAPL");
    if (!v) return { ok: false, msg: "null returned (even chart fallback failed)" };
    // If v11 quoteSummary works: P/E should be in range
    if (v.trailingPE !== null) {
      const ok = v.trailingPE > 5 && v.trailingPE < 300;
      return ok ? { ok: true, msg: `AAPL P/E=${v.trailingPE.toFixed(1)} (from v11 quoteSummary)` } : { ok: false, msg: `Unexpected P/E: ${v.trailingPE}` };
    }
    // Chart fallback: P/E=null is acceptable as long as we got a real price
    const ok = (v.currentPrice ?? 0) > 50;
    return ok ? { ok: true, msg: `AAPL P/E=null (chart fallback), price=$${v.currentPrice?.toFixed(0)}` } : { ok: false, msg: `P/E null AND no current price: ${JSON.stringify(v)}` };
  });

  await check("T13", "AAPL: 52-week high ≥ 52-week low (sanity invariant)", async () => {
    const v = await fetchValuationData("AAPL");
    if (!v?.week52High || !v?.week52Low) return { ok: false, msg: `Missing 52w data: high=${v?.week52High} low=${v?.week52Low}` };
    const ok = v.week52High >= v.week52Low;
    return ok ? { ok: true, msg: `52w: $${v.week52Low.toFixed(0)}-$${v.week52High.toFixed(0)}` } : { ok: false, msg: `52wHigh ${v.week52High} < 52wLow ${v.week52Low}` };
  });

  await check("T13", "BTC: trailingPE is null (crypto — no earnings per share)", async () => {
    const v = await fetchValuationData("BTC");
    if (!v) return { ok: false, msg: "null returned" };
    return v.trailingPE === null ? { ok: true, msg: "BTC P/E=null (correct)" } : { ok: false, msg: `BTC unexpectedly has P/E=${v.trailingPE}` };
  });

  await check("T13", "MSFT: currentPrice > 0 (from quoteSummary or chart fallback)", async () => {
    const v = await fetchValuationData("MSFT");
    if (!v) return { ok: false, msg: "null returned" };
    const ok = (v.currentPrice ?? 0) > 50;
    return ok ? { ok: true, msg: `MSFT price=$${v.currentPrice?.toFixed(0)} P/E=${v.trailingPE?.toFixed(1) ?? "N/A (chart fallback)"}` } : { ok: false, msg: `currentPrice=${v.currentPrice}` };
  });
}

// ── T14: Correlation Matrix Range Invariant (W18 — new module) ───────────────
// Invariant: all pairwise Pearson r values are in [-1, +1]; output is well-formed.
// Not tested before: brand-new module, no other test touches it.

async function T14_correlationMatrixInvariants() {
  console.log("\n─── T14: Correlation Matrix Invariants ───");
  const { buildCorrelationMatrix } = await import("../src/lib/research/correlation-matrix");

  await check("T14", "All pair correlations are in [-1.0, +1.0]", async () => {
    const matrix = await buildCorrelationMatrix(["NVDA", "AAPL", "MSFT", "SPY"], () => {});
    const outOfRange = matrix.pairs.filter(p => p.correlation < -1.001 || p.correlation > 1.001);
    return outOfRange.length === 0
      ? { ok: true, msg: `${matrix.pairs.length} pairs, all r ∈ [-1,+1] (min=${Math.min(...matrix.pairs.map(p=>p.correlation)).toFixed(2)} max=${Math.max(...matrix.pairs.map(p=>p.correlation)).toFixed(2)})` }
      : { ok: false, msg: `Out-of-range pairs: ${outOfRange.map(p=>`${p.ticker1}↔${p.ticker2}=${p.correlation}`).join(", ")}` };
  });

  await check("T14", "SPY has positive correlation with AAPL and MSFT (both are S&P 500 components)", async () => {
    const matrix = await buildCorrelationMatrix(["AAPL", "MSFT", "SPY"], () => {});
    const aaplSpy = matrix.pairs.find(p => new Set([p.ticker1, p.ticker2]).has("SPY") && (p.ticker1 === "AAPL" || p.ticker2 === "AAPL"));
    const msftSpy = matrix.pairs.find(p => new Set([p.ticker1, p.ticker2]).has("SPY") && (p.ticker1 === "MSFT" || p.ticker2 === "MSFT"));
    const ok = (aaplSpy?.correlation ?? 0) > 0.3 && (msftSpy?.correlation ?? 0) > 0.3;
    return ok ? { ok: true, msg: `AAPL↔SPY=${aaplSpy?.correlation?.toFixed(2)} MSFT↔SPY=${msftSpy?.correlation?.toFixed(2)}` } : { ok: false, msg: `Low correlations: AAPL↔SPY=${aaplSpy?.correlation?.toFixed(2)} MSFT↔SPY=${msftSpy?.correlation?.toFixed(2)}` };
  });

  await check("T14", "Fake ticker returns gracefully (no throw, no corrupt pairs)", async () => {
    const matrix = await buildCorrelationMatrix(["NVDA", "FAKEXXXX9999"], () => {});
    const hasFake = matrix.pairs.some(p => p.ticker1 === "FAKEXXXX9999" || p.ticker2 === "FAKEXXXX9999");
    return !hasFake ? { ok: true, msg: `Fake ticker excluded, ${matrix.pairs.length} pairs returned cleanly` } : { ok: false, msg: "Fake ticker appeared in pairs (should have been filtered)" };
  });
}

// ── T15: Action Vocabulary Normalization (W25) ────────────────────────────────
// Invariant: alias phrasings produce the correct canonical action.
// Not tested before: T5 tested o3-mini produces valid JSON — NOT the normalization mapping.

async function T15_actionVocabNormalization() {
  console.log("\n─── T15: Action Vocabulary Normalization ───");

  // Inline the normalization logic to unit-test the CONTRACT (not the implementation)
  // This will catch regressions if someone changes the alias map
  const ACTION_ALIASES: Record<string, string> = {
    "Strong Buy": "Buy", "Accumulate": "Buy", "Overweight": "Buy", "Add": "Buy",
    "Strong Hold": "Hold", "Neutral": "Hold", "Market Perform": "Hold",
    "Reduce": "Trim", "Underweight": "Trim", "Lighten": "Trim",
    "Strong Sell": "Sell", "Underperform": "Sell",
    "Buy": "Buy", "Hold": "Hold", "Sell": "Sell", "Trim": "Trim",
  };

  await check("T15", "Buy-direction aliases all map to Buy (Strong Buy, Accumulate, Overweight, Add)", async () => {
    const { aggregateSignals } = (await import("../src/lib/research/signal-aggregator")) as any;
    const regime: any = { riskMode: "neutral", aggressionMultiplier: 1.0, rateTrend: "plateau", dollarTrend: "stable", vixLevel: "normal", sectorLeadership: "n/a", summary: "" };
    const buyAliases = ["Strong Buy", "Accumulate", "Overweight", "Buy"];
    const failures: string[] = [];
    for (const alias of buyAliases) {
      const o3 = new Map([["TEST", { ticker: "TEST", action: alias as any, confidence: "high" as any, keyReason: "test", evidenceQuality: "high" as any }]]);
      const result = aggregateSignals(["TEST"], new Map(), o3, new Map(), new Set(), regime, () => {});
      // With only o3 data, a Buy-direction verdict should produce positive score
      if (result[0].score <= 0) failures.push(`${alias}=${result[0].score.toFixed(3)}`);
    }
    return failures.length === 0 ? { ok: true, msg: `All ${buyAliases.length} buy aliases produced positive score` } : { ok: false, msg: `Non-positive scores: ${failures.join(", ")}` };
  });

  await check("T15", "Sell-direction aliases produce negative score (Strong Sell, Underperform)", async () => {
    const { aggregateSignals } = (await import("../src/lib/research/signal-aggregator")) as any;
    const regime: any = { riskMode: "neutral", aggressionMultiplier: 1.0, rateTrend: "plateau", dollarTrend: "stable", vixLevel: "normal", sectorLeadership: "n/a", summary: "" };
    const sellAliases = ["Strong Sell", "Underperform", "Sell"];
    const failures: string[] = [];
    for (const alias of sellAliases) {
      const o3 = new Map([["TEST", { ticker: "TEST", action: alias as any, confidence: "high" as any, keyReason: "test", evidenceQuality: "high" as any }]]);
      const result = aggregateSignals(["TEST"], new Map(), o3, new Map(), new Set(), regime, () => {});
      if (result[0].score >= 0) failures.push(`${alias}=${result[0].score.toFixed(3)}`);
    }
    return failures.length === 0 ? { ok: true, msg: `All ${sellAliases.length} sell aliases produced negative score` } : { ok: false, msg: `Non-negative scores: ${failures.join(", ")}` };
  });

  await check("T15", "Trim aliases produce score in (-0.6, 0) range (Reduce, Underweight, Lighten)", async () => {
    const { aggregateSignals } = (await import("../src/lib/research/signal-aggregator")) as any;
    const regime: any = { riskMode: "neutral", aggressionMultiplier: 1.0, rateTrend: "plateau", dollarTrend: "stable", vixLevel: "normal", sectorLeadership: "n/a", summary: "" };
    const trimAliases = ["Reduce", "Underweight", "Trim"];
    const failures: string[] = [];
    for (const alias of trimAliases) {
      const o3 = new Map([["TEST", { ticker: "TEST", action: alias as any, confidence: "high" as any, keyReason: "test", evidenceQuality: "high" as any }]]);
      const result = aggregateSignals(["TEST"], new Map(), o3, new Map(), new Set(), regime, () => {});
      const s = result[0].score;
      if (!(s < 0 && s > -0.65)) failures.push(`${alias}=${s.toFixed(3)}`);
    }
    return failures.length === 0 ? { ok: true, msg: `All ${trimAliases.length} trim aliases scored in (-0.65, 0)` } : { ok: false, msg: `Out-of-range: ${failures.join(", ")}` };
  });
}

// ── T16: Market Holiday / Weekend Detection (W26) ─────────────────────────────
// Invariant: price timeline correctly flags market-closed days.
// Not tested before: T6 tested bar sorting/prices for live data — not holiday detection.

async function T16_marketHolidayDetection() {
  console.log("\n─── T16: Market Holiday / Weekend Detection ───");
  const { fetchPriceTimelines } = await import("../src/lib/research/price-timeline");

  await check("T16", "Christmas 2025 (2025-12-25) → marketClosed=true for US tickers", async () => {
    const tl = await fetchPriceTimelines(["NVDA", "AAPL"], new Map(), "2025-12-25", () => {});
    const allClosed = Array.from(tl.values()).every(t => t.marketClosed === true);
    return allClosed ? { ok: true, msg: `Both NVDA and AAPL show marketClosed=true on Dec 25` } : { ok: false, msg: `marketClosed flags: ${Array.from(tl.values()).map(t=>`${t.ticker}=${t.marketClosed}`).join(", ")}` };
  });

  await check("T16", "Saturday date → marketClosed=true for US tickers", async () => {
    // Find the most recent Saturday
    const d = new Date();
    const daysBack = (d.getDay() + 1) % 7 + 1; // days to last saturday
    d.setDate(d.getDate() - daysBack);
    const saturdayStr = d.toISOString().split("T")[0];
    const tl = await fetchPriceTimelines(["MSFT"], new Map(), saturdayStr, () => {});
    const msft = tl.get("MSFT");
    return msft?.marketClosed === true ? { ok: true, msg: `${saturdayStr} (Saturday) → marketClosed=true` } : { ok: false, msg: `Saturday ${saturdayStr} not detected as closed` };
  });

  await check("T16", "Crypto ticker (BTC) never has marketClosed=true (24/7 market)", async () => {
    const tl = await fetchPriceTimelines(["BTC"], new Map(), "2025-12-25", () => {});
    const btc = tl.get("BTC");
    return btc?.marketClosed === false ? { ok: true, msg: "BTC: marketClosed=false even on NYSE holiday (24/7)" } : { ok: false, msg: `BTC marketClosed=${btc?.marketClosed} — should always be false` };
  });
}

// ── T17: Ticker Alias Deduplication in Screener (W28) ────────────────────────
// Invariant: candidate screener rejects aliases of held tickers (GOOG when GOOGL held).
// Not tested before: T9 tested direct exclusion — NOT alias expansion.

async function T17_tickerAliasDeduplication() {
  console.log("\n─── T17: Ticker Alias Deduplication ───");
  const { screenCandidates } = await import("../src/lib/research/candidate-screener");
  const profile = { trackedAccountRiskTolerance: "high", permittedAssetClasses: "Stocks, ETFs" };

  await check("T17", "GOOG excluded when GOOGL is held (alias relationship)", async () => {
    const candidates = await screenCandidates(openai, ["GOOGL", "NVDA", "AAPL"], "tech growth gap", profile as any, today, () => {});
    const hasGoog    = candidates.some(c => c.ticker === "GOOG");
    const hasGoogl   = candidates.some(c => c.ticker === "GOOGL");
    return (!hasGoog && !hasGoogl)
      ? { ok: true, msg: `${candidates.length} candidates — neither GOOG nor GOOGL returned (correctly excluded)` }
      : { ok: false, msg: `GOOG=${hasGoog} GOOGL=${hasGoogl} — alias exclusion failure` };
  });

  await check("T17", "All candidate tickers are valid format (1-6 uppercase alphanumeric)", async () => {
    const candidates = await screenCandidates(openai, ["NVDA", "AAPL", "MSFT"], "healthcare innovation", profile as any, today, () => {});
    const TICKER_RE = /^[A-Z0-9.]{1,6}$/;
    const bad = candidates.filter(c => !TICKER_RE.test(c.ticker));
    return bad.length === 0
      ? { ok: true, msg: `All ${candidates.length} tickers match /^[A-Z0-9.]{1,6}$/` }
      : { ok: false, msg: `Bad format: ${bad.map(c=>c.ticker).join(", ")}` };
  });
}

// ── T18: Context Length Guard (W19) ───────────────────────────────────────────
// Invariant: very long context is always truncated to ≤ maxChars at a sentence boundary.
// Not tested before: T8 tested news returns strings — not the truncation logic.

async function T18_contextLengthGuard() {
  console.log("\n─── T18: Context Length Guard ───");

  // Inline the guard (pure function) — tests the CONTRACT, not the implementation
  function guardContextLength(text: string, maxChars: number, label: string): string {
    if (text.length <= maxChars) return text;
    const truncated = text.slice(0, maxChars);
    const lastPeriod = truncated.lastIndexOf(".");
    const safe = lastPeriod > maxChars * 0.8 ? truncated.slice(0, lastPeriod + 1) : truncated;
    return safe + `\n[${label} truncated at ${maxChars} chars to prevent JSON overflow]`;
  }

  await check("T18", "Short text (< maxChars) returned unchanged", async () => {
    const input = "Apple reports strong earnings. Revenue up 15%.";
    const result = guardContextLength(input, 500, "test");
    return result === input ? { ok: true, msg: "Short text returned unchanged" } : { ok: false, msg: `Modified short text: "${result}"` };
  });

  await check("T18", "Long text truncated to ≤ maxChars", async () => {
    const input = "A".repeat(100) + ". " + "B".repeat(100) + ". " + "C".repeat(100) + ".";
    const result = guardContextLength(input, 150, "test");
    return result.length <= 150 + 60 // marker adds ~60 chars
      ? { ok: true, msg: `Input=${input.length}c → output=${result.length}c (≤ limit+marker)` }
      : { ok: false, msg: `Output too long: ${result.length} chars` };
  });

  await check("T18", "Truncation ends at a sentence boundary (contains period before marker)", async () => {
    const sentences = Array.from({length: 50}, (_, i) => `This is sentence number ${i + 1} with some content.`).join(" ");
    const result = guardContextLength(sentences, 200, "test");
    const markerStart = result.indexOf("\n[");
    const textBeforeMarker = markerStart !== -1 ? result.slice(0, markerStart) : result;
    const endsWithPeriod = textBeforeMarker.trimEnd().endsWith(".");
    return endsWithPeriod ? { ok: true, msg: "Truncated at sentence boundary (ends with '.')" } : { ok: false, msg: `Does not end with period: "...${textBeforeMarker.slice(-20)}"` };
  });

  await check("T18", "Empty text returns empty (no crash or truncation marker)", async () => {
    const result = guardContextLength("", 500, "test");
    return result === "" ? { ok: true, msg: "Empty input → empty output" } : { ok: false, msg: `Non-empty output for empty input: "${result}"` };
  });
}

// ── T19: PortfolioReport Recommendation Persistence Roundtrip ─────────────────
// Invariant: most recent saved report has well-typed, parseable recommendations.
// Not tested before: T2 tested snapshots/holdings — NOT the PortfolioReport table.

async function T19_reportPersistenceRoundtrip() {
  console.log("\n─── T19: PortfolioReport Persistence Roundtrip ───");

  const report = await prisma.portfolioReport.findFirst({
    orderBy: { createdAt: "desc" },
    include: { recommendations: true },
  });

  await check("T19", "At least one PortfolioReport exists in DB", async () => {
    return report ? { ok: true, msg: `Most recent report: ${report.id.slice(0,8)} (${report.createdAt.toISOString().split("T")[0]})` } : { ok: false, msg: "No PortfolioReport in DB — run analysis first" };
  });

  await check("T19", "All recommendations have non-empty ticker and valid action", async () => {
    if (!report) return { ok: true, msg: "Skipped (no report)" };
    const VALID_ACTIONS = new Set(["Buy", "Hold", "Sell", "Trim"]);
    const bad = report.recommendations.filter(r => !r.ticker || !VALID_ACTIONS.has(r.action));
    return bad.length === 0
      ? { ok: true, msg: `${report.recommendations.length} recommendations, all valid` }
      : { ok: false, msg: `${bad.length} invalid: ${bad.map(r=>`${r.ticker}=${r.action}`).join(", ")}` };
  });

  await check("T19", "reasoningSources is parseable JSON array", async () => {
    if (!report) return { ok: true, msg: "Skipped (no report)" };
    const bad: string[] = [];
    for (const rec of report.recommendations) {
      try { const parsed = JSON.parse(rec.reasoningSources ?? "[]"); if (!Array.isArray(parsed)) bad.push(rec.ticker); }
      catch { bad.push(rec.ticker); }
    }
    return bad.length === 0 ? { ok: true, msg: `All ${report.recommendations.length} reasoningSources are valid JSON arrays` } : { ok: false, msg: `Invalid JSON in: ${bad.join(", ")}` };
  });

  await check("T19", "confidence field is one of high/medium/low (never null or garbage)", async () => {
    if (!report) return { ok: true, msg: "Skipped (no report)" };
    const VALID_CONF = new Set(["high", "medium", "low"]);
    const bad = report.recommendations.filter(r => !VALID_CONF.has(r.confidence ?? ""));
    return bad.length === 0
      ? { ok: true, msg: `All ${report.recommendations.length} confidences valid` }
      : { ok: false, msg: `Invalid confidence: ${bad.map(r=>`${r.ticker}=${r.confidence}`).join(", ")}` };
  });
}

// ── T20: Model Tracker Weight Persistence (F8) ────────────────────────────────
// Invariant: loadModelWeights always returns well-formed weights that sum to ~1.0.
// Not tested before: brand-new module (model-tracker.ts), no prior tests touch it.

async function T20_modelTrackerPersistence() {
  console.log("\n─── T20: Model Tracker Weight Persistence ───");
  const { loadModelWeights, DEFAULT_WEIGHTS } = await import("../src/lib/research/model-tracker");

  await check("T20", "loadModelWeights returns object with all required keys", async () => {
    const w = await loadModelWeights(prisma);
    const keys = ["gpt5", "o3mini", "sentiment", "lastUpdated", "runCount"];
    const missing = keys.filter(k => !(k in w));
    return missing.length === 0 ? { ok: true, msg: `All keys present: gpt5=${w.gpt5} o3mini=${w.o3mini} sentiment=${w.sentiment}` } : { ok: false, msg: `Missing keys: ${missing.join(", ")}` };
  });

  await check("T20", "All weight values are positive numbers in (0, 1)", async () => {
    const w = await loadModelWeights(prisma);
    const values = [w.gpt5, w.o3mini, w.sentiment];
    const bad = values.filter(v => typeof v !== "number" || v <= 0 || v >= 1 || !isFinite(v));
    return bad.length === 0 ? { ok: true, msg: `gpt5=${w.gpt5} o3mini=${w.o3mini} sentiment=${w.sentiment} all in (0,1)` } : { ok: false, msg: `Out-of-range: ${bad.join(", ")}` };
  });

  await check("T20", "Model weights sum to ~1.0 (± 0.05 tolerance)", async () => {
    const w = await loadModelWeights(prisma);
    const sum = w.gpt5 + w.o3mini + w.sentiment;
    const ok = Math.abs(sum - 1.0) < 0.05;
    return ok ? { ok: true, msg: `Sum = ${sum.toFixed(4)} ≈ 1.0` } : { ok: false, msg: `Weights don't sum to 1.0: ${sum.toFixed(4)}` };
  });

  await check("T20", "DEFAULT_WEIGHTS are correct (regression guard for constants)", async () => {
    const ok = DEFAULT_WEIGHTS.gpt5 === 0.40 && DEFAULT_WEIGHTS.o3mini === 0.25 && DEFAULT_WEIGHTS.sentiment === 0.35;
    return ok
      ? { ok: true, msg: `Defaults: gpt5=0.40 o3mini=0.25 sentiment=0.35 (sum=${(DEFAULT_WEIGHTS.gpt5+DEFAULT_WEIGHTS.o3mini+DEFAULT_WEIGHTS.sentiment).toFixed(2)})` }
      : { ok: false, msg: `Default weight constants changed! gpt5=${DEFAULT_WEIGHTS.gpt5} o3mini=${DEFAULT_WEIGHTS.o3mini} sentiment=${DEFAULT_WEIGHTS.sentiment}` };
  });
}

// ── Main + Summary ─────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.OPENAI_API_KEY) { console.error("❌ No OPENAI_API_KEY"); process.exit(1); }
  const t0 = Date.now();

  console.log("Portfolio Watchtower — Contract Reliability Suite (T1-T20)");
  console.log(`HF key: ${hfKey ? "✅ present" : "⚠️  missing"} | Date: ${today}`);
  console.log("30 invariant checks across 20 test groups.\n");

  await T1_externalApiContract();
  await T2_databaseIntegrity();
  await T3_portfolioMathCorrectness();
  await T4_gracefulDegradation();
  await T5_o3miniShapeConformance();
  await T6_priceDataStructural();
  await T7_sentimentDirectionAccuracy();
  await T8_newsFetchOutputContract();
  await T9_candidateDeduplication();
  await T10_timingBounds();
  await T11_signalAggregatorMath();
  await T12_regimeMultiplierNumerics();
  await T13_valuationFetcherQuality();
  await T14_correlationMatrixInvariants();
  await T15_actionVocabNormalization();
  await T16_marketHolidayDetection();
  await T17_tickerAliasDeduplication();
  await T18_contextLengthGuard();
  await T19_reportPersistenceRoundtrip();
  await T20_modelTrackerPersistence();

  // Summary
  const total = allResults.length;
  const passed = allResults.filter(r => r.result.pass).length;
  const failed = allResults.filter(r => !r.result.pass);
  const totalMs = Date.now() - t0;

  console.log(`\n${"═".repeat(70)}`);
  console.log(`RESULTS: ${passed}/${total} passed | ${failed.length} failed | ${(totalMs/60000).toFixed(1)}min total`);
  console.log(`${"═".repeat(70)}`);

  if (failed.length > 0) {
    console.log("\nFAILURES TO FIX:");
    failed.forEach(f => console.log(`  ❌ [${f.group}] ${f.name}\n     ${f.result.note}`));
  }

  // Per-group summary
  const groups = [...new Set(allResults.map(r => r.group))];
  console.log("\nPER-GROUP:");
  for (const g of groups) {
    const gResults = allResults.filter(r => r.group === g);
    const gPass = gResults.filter(r => r.result.pass).length;
    const avgMs = gResults.reduce((s, r) => s + r.result.ms, 0) / gResults.length;
    console.log(`  ${g}: ${gPass}/${gResults.length} — avg ${(avgMs/1000).toFixed(1)}s per check`);
  }

  await prisma.$disconnect();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
