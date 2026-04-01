/**
 * Stage 2: Sentiment Scoring
 * Fixes applied:
 *   F6  — Per-headline scoring (not combined)
 *   W14 — Price context injected into HF input
 *   W25 — Graceful empty / no-HF-key fallback
 */

import type { ProgressEvent } from "./progress-events";
import type { ArticleReaction } from "./price-timeline";

export interface SentimentSignal {
  ticker: string;
  direction: "buy" | "hold" | "sell";
  magnitude: number;
  confidence: number;
  finbertScore: number;
  fingptScore: number;
  marketReactionScore: number;
  finalScore: number;
  drivingArticle?: string;
  priceVerdicts: string[];
}

const HF_BASE = "https://router.huggingface.co/hf-inference/models";

/**
 * N1: HF cold-start retry with exponential backoff.
 * HF Inference API returns 503 {"error":"Model ... is currently loading"}
 * when a model hasn't been used recently. Retry up to 3 times.
 */
async function callHuggingFace(model: string, inputs: string, apiKey: string, maxRetries = 3): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(`${HF_BASE}/${model}`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) return res.json();

    // 503 = model loading — wait and retry
    if (res.status === 503 && attempt < maxRetries - 1) {
      const waitMs = (attempt + 1) * 2000; // 2s, 4s, 6s
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }

    throw new Error(`HF ${model}: ${res.status}`);
  }
}

function parseHFLabels(raw: any): number {
  const labels: { label: string; score: number }[] = Array.isArray(raw?.[0]) ? raw[0] : [];
  let score = 0;
  for (const l of labels) {
    const lw = l.label?.toLowerCase() ?? "";
    if (lw === "positive" || lw.includes("bullish")) score += l.score;
    if (lw === "negative" || lw.includes("bearish")) score -= l.score;
    // neutral contributes 0
  }
  return Math.max(-1, Math.min(1, score));
}

function priceVerdictToScore(verdicts: ArticleReaction["verdict"][]): number {
  if (verdicts.length === 0) return 0;
  const scoreMap: Record<string, number> = {
    confirmed_bullish: +1.0,
    confirmed_bearish: -1.0,
    overreaction_faded: -0.3,
    pre_event_stale: 0,
    already_priced: 0,
    market_closed: 0,
    ignored: 0,
    conflicted: -0.2,
  };
  const scores = verdicts.map(v => scoreMap[v] ?? 0).filter(s => s !== 0);
  if (scores.length === 0) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * F6: Score each headline individually then aggregate.
 * W14: Prepend price context (day%, YTD indication) to each headline for richer context.
 */
async function scoreHeadlinesWithHF(
  headlines: { title: string; publishedAt: string }[],
  dayChangePct: number | undefined,
  apiKey: string
): Promise<{ finbert: number; distilroberta: number }> {
  if (headlines.length === 0) return { finbert: 0, distilroberta: 0 };

  const recencyWeight = (publishedAt: string): number => {
    const age = Date.now() - new Date(publishedAt).getTime();
    return age < 24 * 3600000 ? 1.0 : age < 7 * 24 * 3600000 ? 0.6 : 0.3;
  };

  // W14: Price context prefix for each headline
  const pricePrefix = dayChangePct !== undefined
    ? `[Stock is ${dayChangePct >= 0 ? "up" : "down"} ${Math.abs(dayChangePct).toFixed(1)}% today] `
    : "";

  let totalWeight = 0;
  let finbertSum = 0;
  let distilrobertaSum = 0;

  // Score each headline individually (F6)
  for (const headline of headlines.slice(0, 5)) {
    const rw = recencyWeight(headline.publishedAt);
    const input = `${pricePrefix}${headline.title}`;

    try {
      const [fbRaw, drRaw] = await Promise.allSettled([
        callHuggingFace("ProsusAI/finbert", input, apiKey),
        callHuggingFace("mrm8488/distilroberta-finetuned-financial-news-sentiment-analysis", input, apiKey),
      ]);

      const fbScore = fbRaw.status === "fulfilled" ? parseHFLabels(fbRaw.value) : 0;
      const drScore = drRaw.status === "fulfilled" ? parseHFLabels(drRaw.value) : 0;

      finbertSum += fbScore * rw;
      distilrobertaSum += drScore * rw;
      totalWeight += rw;
    } catch { /* skip failed headline */ }
  }

  if (totalWeight === 0) return { finbert: 0, distilroberta: 0 };

  return {
    finbert: Math.max(-1, Math.min(1, finbertSum / totalWeight)),
    distilroberta: Math.max(-1, Math.min(1, distilrobertaSum / totalWeight)),
  };
}

export async function scoreTickerSentiment(
  ticker: string,
  articles: { title: string; text: string; publishedAt: string }[],
  priceReactions: ArticleReaction[],
  hfApiKey: string | null,
  emit: (e: ProgressEvent) => void,
  dayChangePct?: number
): Promise<SentimentSignal> {
  const hasHF = !!hfApiKey;

  // Determine driving article (most recent)
  const sorted = [...articles].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const driving = sorted[0];

  let finbertScore = 0;
  let fingptScore = 0; // now distilroberta

  if (hasHF && articles.length > 0) {
    try {
      const scores = await scoreHeadlinesWithHF(
        articles.map(a => ({ title: a.title, publishedAt: a.publishedAt })),
        dayChangePct,
        hfApiKey!
      );
      finbertScore = scores.finbert;
      fingptScore = scores.distilroberta;
    } catch { /* HF unavailable, scores remain 0 */ }
  }

  // Price reaction score
  const verdicts = priceReactions.map(r => r.verdict);
  const mktScore = priceVerdictToScore(verdicts);

  // When market and text disagree, elevate market weight
  const textScore = hasHF ? (finbertScore + fingptScore) / 2 : 0;
  const textMarketDisagree = textScore !== 0 && mktScore !== 0 && Math.sign(textScore) !== Math.sign(mktScore);

  let finalScore: number;
  if (!hasHF && mktScore === 0) {
    finalScore = 0;
  } else if (textMarketDisagree) {
    finalScore = finbertScore * 0.15 + fingptScore * 0.10 + mktScore * 0.75;
  } else {
    finalScore = finbertScore * 0.35 + fingptScore * 0.25 + mktScore * 0.40;
  }

  const magnitude = Math.abs(finalScore);
  const confidence = hasHF
    ? magnitude * (1 - Math.abs(finbertScore - fingptScore) * 0.3)
    : magnitude * 0.7;

  const direction: "buy" | "hold" | "sell" =
    finalScore > 0.2 ? "buy" :
    finalScore < -0.2 ? "sell" : "hold";

  emit({
    type: "sentiment_score",
    ticker,
    direction,
    magnitude: Math.round(magnitude * 100) / 100,
    confidence: Math.round(confidence * 100) / 100,
    drivingArticle: driving?.title,
    finbert: hasHF ? Math.round(finbertScore * 100) / 100 : undefined,
    fingpt: hasHF ? Math.round(fingptScore * 100) / 100 : undefined,
  });

  return {
    ticker, direction, magnitude, confidence,
    finbertScore, fingptScore,
    marketReactionScore: mktScore,
    finalScore,
    drivingArticle: driving?.title,
    priceVerdicts: verdicts,
  };
}

export async function scoreSentimentForAll(
  tickerArticles: Map<string, { title: string; text: string; publishedAt: string }[]>,
  tickerReactions: Map<string, ArticleReaction[]>,
  hfApiKey: string | null,
  emit: (e: ProgressEvent) => void,
  tickerDayChangePct?: Map<string, number>
): Promise<Map<string, SentimentSignal>> {
  emit({ type: "stage_start", stage: "sentiment", label: "Sentiment Scoring", detail: hfApiKey ? "FinBERT + DistilRoBERTa per-headline + price reaction cross-reference" : "Price reaction analysis (add HUGGINGFACE_API_KEY for FinBERT/DistilRoBERTa)" });
  const t0 = Date.now();

  const result = new Map<string, SentimentSignal>();
  const tickers = Array.from(tickerArticles.keys());

  // Process in parallel batches of 4 (HF rate limit friendly)
  const chunk = (arr: string[], size: number) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));
  for (const batch of chunk(tickers, 4)) {
    await Promise.all(
      batch.map(async ticker => {
        const articles = tickerArticles.get(ticker) ?? [];
        const reactions = tickerReactions.get(ticker.toUpperCase()) ?? [];
        const dayPct = tickerDayChangePct?.get(ticker.toUpperCase());
        const signal = await scoreTickerSentiment(ticker, articles, reactions, hfApiKey, emit, dayPct);
        result.set(ticker, signal);
      })
    );
  }

  emit({ type: "stage_complete", stage: "sentiment", durationMs: Date.now() - t0 });
  return result;
}
