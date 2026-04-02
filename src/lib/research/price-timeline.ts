/**
 * Stage 1-E: Intraday Price Timeline
 * Fixes applied:
 *   F7  — Exchange-aware timezone using IANA strings (handles DST automatically)
 *   W21 — After-hours event handling (pre-market move captured and flagged)
 *   W26 — Market holiday / early-close detection
 */

import type { ProgressEvent } from "./progress-events";

export interface PriceBar {
  time: string;
  price: number;
  volume: number;
}

export interface ArticleReaction {
  articleTitle: string;
  publishedAt: string;
  preEventDrift: { windowMinutes: number; pct: number; significant: boolean };
  reactionWindow: { immediate15min: number; short60min: number; volumeSpike: boolean };
  sustainedWindow: { pct2hr: number; pctClose: number; reversed: boolean; held: boolean };
  verdict:
    | "confirmed_bullish"
    | "confirmed_bearish"
    | "overreaction_faded"
    | "pre_event_stale"
    | "already_priced"
    | "market_closed"   // W26
    | "after_hours_gap" // W21
    | "ignored"
    | "conflicted";
}

export interface PriceTimeline {
  ticker: string;
  date: string;
  prevClose: number;
  preMarket: { open: number; pctFromPrevClose: number } | null;
  bars: PriceBar[];
  afterHours: { price: number; pctFromClose: number } | null;
  dayChangePct: number;
  reactions: ArticleReaction[];
  marketClosed: boolean; // W26
  exchange: string;      // F7
}

// ── F7: Exchange detection ────────────────────────────────────────────────────

type ExchangeInfo = { timezone: string; sessionStart: [number, number]; sessionEnd: [number, number] };

const EXCHANGE_MAP: Record<string, ExchangeInfo> = {
  // US stocks and crypto
  DEFAULT: { timezone: "America/New_York", sessionStart: [9, 30], sessionEnd: [16, 0] },
  // London Stock Exchange
  LSE:     { timezone: "Europe/London",    sessionStart: [8, 0],  sessionEnd: [16, 30] },
  // Toronto Stock Exchange
  TSX:     { timezone: "America/Toronto",  sessionStart: [9, 30], sessionEnd: [16, 0] },
  // Australian Stock Exchange
  ASX:     { timezone: "Australia/Sydney", sessionStart: [10, 0], sessionEnd: [16, 0] },
  // Crypto: 24/7
  CRYPTO:  { timezone: "UTC",             sessionStart: [0, 0],   sessionEnd: [23, 59] },
};

const CRYPTO_TICKERS = new Set(["BTC", "ETH", "SOL", "BNB", "ADA", "DOGE", "XRP", "DOT", "AVAX", "MATIC", "LINK", "UNI"]);

function detectExchange(ticker: string): ExchangeInfo & { name: string } {
  if (CRYPTO_TICKERS.has(ticker.toUpperCase())) return { ...EXCHANGE_MAP.CRYPTO, name: "CRYPTO" };
  if (ticker.endsWith(".L"))  return { ...EXCHANGE_MAP.LSE, name: "LSE" };
  if (ticker.endsWith(".TO")) return { ...EXCHANGE_MAP.TSX, name: "TSX" };
  if (ticker.endsWith(".AX")) return { ...EXCHANGE_MAP.ASX, name: "ASX" };
  return { ...EXCHANGE_MAP.DEFAULT, name: "NYSE/NASDAQ" };
}

// F7: IANA-timezone-aware timestamp parsing (handles DST automatically)
function parseToExchangeMinutes(isoTs: string, timezone: string): number | null {
  try {
    const d = new Date(isoTs);
    if (isNaN(d.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d);
    const hPart = parts.find(p => p.type === "hour");
    const mPart = parts.find(p => p.type === "minute");
    if (!hPart || !mPart) return null;
    return parseInt(hPart.value) * 60 + parseInt(mPart.value);
  } catch {
    return null;
  }
}

// W26: NYSE holiday list (2024-2026 major market closures)
const NYSE_HOLIDAYS = new Set([
  "2024-01-01","2024-01-15","2024-02-19","2024-03-29","2024-05-27","2024-06-19",
  "2024-07-04","2024-09-02","2024-11-28","2024-12-25",
  "2025-01-01","2025-01-20","2025-02-17","2025-04-18","2025-05-26","2025-06-19",
  "2025-07-04","2025-09-01","2025-11-27","2025-12-25",
  "2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19",
  "2026-07-03","2026-09-07","2026-11-26","2026-12-25",
]);

function isMarketHoliday(dateStr: string, exchange: string): boolean {
  if (exchange === "CRYPTO") return false;
  return NYSE_HOLIDAYS.has(dateStr);
}

function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

// ── Price helpers ─────────────────────────────────────────────────────────────

function pricePctChange(from: number, to: number): number {
  if (!from || from === 0) return 0;
  return ((to - from) / from) * 100;
}

function findPriceAtTime(bars: PriceBar[], targetMinutes: number): number | null {
  if (bars.length === 0) return null;
  let best: PriceBar | null = null;
  for (const bar of bars) {
    const parts = bar.time.split(":");
    if (parts.length < 2) continue;
    const barMin = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    if (barMin <= targetMinutes) best = bar;
  }
  return best?.price ?? null;
}

// ── Intraday bar fetch ────────────────────────────────────────────────────────

async function fetchIntradayBars(
  ticker: string,
  exchange: ExchangeInfo & { name: string }
): Promise<{ bars: PriceBar[]; prevClose: number; preMarket: number | null; afterHours: number | null }> {
  try {
    // F8: Map crypto to Yahoo's required -USD suffix for chart data
    const cryptoSymbols = ["BTC", "ETH", "SOL", "ADA", "DOGE", "XRP", "DOT", "AVAX", "LINK", "LTC", "MATIC", "UNI"];
    const yahooTicker = cryptoSymbols.includes(ticker.toUpperCase()) ? `${ticker.toUpperCase()}-USD` : ticker;

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}?interval=5m&range=1d&includePrePost=true`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { bars: [], prevClose: 0, preMarket: null, afterHours: null };
    const json: any = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return { bars: [], prevClose: 0, preMarket: null, afterHours: null };

    const timestamps: number[] = result.timestamp ?? [];
    const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
    const volumes: number[] = result.indicators?.quote?.[0]?.volume ?? [];
    const prevClose: number = result.meta?.previousClose ?? result.meta?.chartPreviousClose ?? 0;
    const regularStart: number = result.meta?.tradingPeriods?.regular?.[0]?.[0]?.start ?? 0;
    const regularEnd: number = result.meta?.tradingPeriods?.regular?.[0]?.[0]?.end ?? 0;

    const bars: PriceBar[] = [];
    let preMarketPrice: number | null = null;
    let afterHoursPrice: number | null = null;

    for (let i = 0; i < timestamps.length; i++) {
      const ts = timestamps[i];
      const price = closes[i];
      if (!price || price === 0) continue;

      // F7: Use IANA timezone for correct local time string
      const d = new Date(ts * 1000);
      const hhmm = new Intl.DateTimeFormat("en-US", {
        timeZone: exchange.timezone,
        hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(d);

      if (ts < regularStart) {
        preMarketPrice = price;
      } else if (ts > regularEnd) {
        afterHoursPrice = price;
      } else {
        bars.push({ time: hhmm, price, volume: volumes[i] ?? 0 });
      }
    }

    return { bars, prevClose, preMarket: preMarketPrice, afterHours: afterHoursPrice };
  } catch (err: any) {
    // F3: Log the actual error so price fetch failures are visible in server logs
    console.warn(`[price-timeline] ${ticker}: bar fetch failed — ${err?.message ?? String(err)}`);
    return { bars: [], prevClose: 0, preMarket: null, afterHours: null };
  }
}

// ── Reaction assessment ───────────────────────────────────────────────────────

function assessReactions(
  bars: PriceBar[],
  prevClose: number,
  articles: { title: string; publishedAt: string }[],
  timezone: string,
  sessionStartMin: number,
  sessionEndMin: number,
  marketClosed: boolean
): ArticleReaction[] {
  if (marketClosed) {
    return articles.map(a => ({
      articleTitle: a.title,
      publishedAt: a.publishedAt,
      preEventDrift: { windowMinutes: 0, pct: 0, significant: false },
      reactionWindow: { immediate15min: 0, short60min: 0, volumeSpike: false },
      sustainedWindow: { pct2hr: 0, pctClose: 0, reversed: false, held: false },
      verdict: "market_closed" as const,
    }));
  }

  const reactions: ArticleReaction[] = [];

  for (const article of articles) {
    const pubMinutes = parseToExchangeMinutes(article.publishedAt, timezone);
    if (pubMinutes === null) continue;

    // W21: After-hours articles — flag as after_hours_gap
    if (pubMinutes > sessionEndMin) {
      const afterHoursBar = bars[bars.length - 1];
      const prevCloseLocal = prevClose > 0 ? prevClose : afterHoursBar?.price ?? 0;
      const ahPct = afterHoursBar ? pricePctChange(prevCloseLocal, afterHoursBar.price) : 0;
      reactions.push({
        articleTitle: article.title,
        publishedAt: article.publishedAt,
        preEventDrift: { windowMinutes: 0, pct: 0, significant: false },
        reactionWindow: { immediate15min: 0, short60min: 0, volumeSpike: false },
        sustainedWindow: { pct2hr: 0, pctClose: ahPct, reversed: false, held: Math.abs(ahPct) > 1 },
        verdict: "after_hours_gap",
      });
      continue;
    }

    if (pubMinutes < sessionStartMin || pubMinutes > sessionEndMin) continue;

    const priceAtPub = findPriceAtTime(bars, pubMinutes);
    if (!priceAtPub) continue;

    const preBar30price = findPriceAtTime(bars, pubMinutes - 30);
    const preEventPct = preBar30price ? pricePctChange(preBar30price, priceAtPub) : 0;

    const price15min = findPriceAtTime(bars, pubMinutes + 15);
    const price60min = findPriceAtTime(bars, pubMinutes + 60);
    const price2hr   = findPriceAtTime(bars, pubMinutes + 120);
    const priceClose = bars[bars.length - 1]?.price ?? priceAtPub;

    const react15   = price15min ? pricePctChange(priceAtPub, price15min) : 0;
    const react60   = price60min ? pricePctChange(priceAtPub, price60min) : 0;
    const react2hr  = price2hr   ? pricePctChange(priceAtPub, price2hr)   : 0;
    const reactClose = pricePctChange(priceAtPub, priceClose);

    const reversed = Math.abs(react15) > 0.5 && Math.sign(reactClose) !== Math.sign(react15) && Math.abs(reactClose) < Math.abs(react15) * 0.3;
    const held     = Math.abs(react15) > 0.5 && Math.abs(reactClose) >= Math.abs(react15) * 0.5;

    let verdict: ArticleReaction["verdict"];
    if (Math.abs(preEventPct) > 1.5) verdict = "pre_event_stale";
    else if (Math.abs(react60) < 0.3) verdict = "ignored";
    else if (reversed) verdict = "overreaction_faded";
    else if (react60 > 0.3 && held)  verdict = "confirmed_bullish";
    else if (react60 < -0.3 && held) verdict = "confirmed_bearish";
    else                              verdict = "conflicted";

    reactions.push({
      articleTitle: article.title,
      publishedAt: article.publishedAt,
      preEventDrift: { windowMinutes: 30, pct: preEventPct, significant: Math.abs(preEventPct) > 1.5 },
      reactionWindow: { immediate15min: react15, short60min: react60, volumeSpike: false },
      sustainedWindow: { pct2hr: react2hr, pctClose: reactClose, reversed, held },
      verdict,
    });
  }

  return reactions;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function fetchPriceTimelines(
  tickers: string[],
  articleMap: Map<string, { title: string; publishedAt: string }[]>,
  today: string,
  emit: (e: ProgressEvent) => void
): Promise<Map<string, PriceTimeline>> {
  emit({ type: "stage_start", stage: "price_timeline", label: "Intraday Price Timeline", detail: `Fetching 5-min bars for ${tickers.length} tickers + exchange-aware timestamp cross-reference` });
  const t0 = Date.now();

  const result = new Map<string, PriceTimeline>();

  const chunk = (arr: string[], size: number) =>
    Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, (i + 1) * size));

  for (const batch of chunk(tickers, 8)) {
    await Promise.all(
      batch.map(async (ticker) => {
        const exchange = detectExchange(ticker);
        const sessionStartMin = exchange.sessionStart[0] * 60 + exchange.sessionStart[1];
        const sessionEndMin   = exchange.sessionEnd[0]   * 60 + exchange.sessionEnd[1];

        // W26: Detect market holiday or weekend
        const marketClosed = exchange.name !== "CRYPTO" && (isMarketHoliday(today, exchange.name) || isWeekend(today));

        const { bars, prevClose, preMarket, afterHours } = await fetchIntradayBars(ticker, exchange);
        const articles = articleMap.get(ticker.toUpperCase()) ?? [];
        const reactions = assessReactions(bars, prevClose, articles, exchange.timezone, sessionStartMin, sessionEndMin, marketClosed);

        const openPrice  = bars[0]?.price ?? 0;
        const closePrice = bars[bars.length - 1]?.price ?? 0;
        const dayChangePct = prevClose > 0 ? pricePctChange(prevClose, closePrice || openPrice) : 0;

        const tl: PriceTimeline = {
          ticker,
          date: today,
          prevClose,
          preMarket: preMarket ? { open: preMarket, pctFromPrevClose: pricePctChange(prevClose, preMarket) } : null,
          bars,
          afterHours: afterHours ? { price: afterHours, pctFromClose: pricePctChange(closePrice, afterHours) } : null,
          dayChangePct,
          reactions,
          marketClosed,
          exchange: exchange.name,
        };
        result.set(ticker.toUpperCase(), tl);

        // F3: Log bar count per ticker for diagnosability
        emit({
          type: "log",
          message: `${ticker} (${exchange.name}): ${bars.length} price bars${marketClosed ? " [market closed]" : ""}${reactions.length > 0 ? `, ${reactions.length} article reactions` : ""}`,
          level: bars.length === 0 && !marketClosed ? "warn" : "info",
        });

        if (marketClosed) {
          emit({ type: "log", message: `${ticker}: market closed today (holiday/weekend)`, level: "info" });
        }

        // Emit noteworthy reactions
        for (const r of reactions) {
          if (r.verdict !== "ignored" && r.verdict !== "market_closed") {
            emit({
              type: "price_reaction",
              ticker,
              verdict: r.verdict,
              note: `"${r.articleTitle.slice(0, 60)}" → ${r.verdict.replace(/_/g, " ")} (${r.reactionWindow.short60min.toFixed(1)}% 60min)`,
              preEventDrift: r.preEventDrift.significant ? r.preEventDrift.pct : undefined,
              reactionPct: r.reactionWindow.short60min,
              sustained: r.sustainedWindow.held,
            });
          }
        }
      })
    );
  }

  emit({ type: "stage_complete", stage: "price_timeline", durationMs: Date.now() - t0 });
  return result;
}
