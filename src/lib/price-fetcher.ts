// ─── price-fetcher.ts ──────────────────────────────────────────────────────────
// Root cause of BTC/ETH price bug:
//   Yahoo Finance v7 spark uses bare ticker symbols (AAPL, MSFT).
//   Sending "BTC" to Yahoo spark resolves to an unrelated equity (~$29),
//   NOT bitcoin. Crypto requires "BTC-USD" format on Yahoo.
//   CoinGecko is the correct primary source for crypto — no auth, real-time.

import OpenAI from "openai";

// ─── Crypto ticker registry ────────────────────────────────────────────────────

const CRYPTO_MAP: Record<string, { yahooSymbol: string; coingeckoId: string }> = {
  BTC:   { yahooSymbol: "BTC-USD",   coingeckoId: "bitcoin" },
  ETH:   { yahooSymbol: "ETH-USD",   coingeckoId: "ethereum" },
  SOL:   { yahooSymbol: "SOL-USD",   coingeckoId: "solana" },
  ADA:   { yahooSymbol: "ADA-USD",   coingeckoId: "cardano" },
  DOGE:  { yahooSymbol: "DOGE-USD",  coingeckoId: "dogecoin" },
  XRP:   { yahooSymbol: "XRP-USD",   coingeckoId: "ripple" },
  DOT:   { yahooSymbol: "DOT-USD",   coingeckoId: "polkadot" },
  AVAX:  { yahooSymbol: "AVAX-USD",  coingeckoId: "avalanche-2" },
  LINK:  { yahooSymbol: "LINK-USD",  coingeckoId: "chainlink" },
  LTC:   { yahooSymbol: "LTC-USD",   coingeckoId: "litecoin" },
  MATIC: { yahooSymbol: "MATIC-USD", coingeckoId: "matic-network" },
  UNI:   { yahooSymbol: "UNI-USD",   coingeckoId: "uniswap" },
};

// ─── Source helpers ────────────────────────────────────────────────────────────

/** Bulk equity fetch via Yahoo v7 spark. Only pass non-crypto tickers. */
async function fetchYahooSparkBulk(
  yahooSymbols: string[]
): Promise<Record<string, number>> {
  if (yahooSymbols.length === 0) return {};
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${yahooSymbols.join(",")}&range=1d&interval=1d&t=${Date.now()}`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const out: Record<string, number> = {};
    for (const item of json?.spark?.result ?? []) {
      const sym = item?.symbol?.toUpperCase();
      if (!sym) continue;
      const meta = item?.response?.[0]?.meta;
      const price = meta?.regularMarketPrice ?? meta?.previousClose ?? null;
      if (price && price > 0) out[sym] = Math.round(price * 100) / 100;
    }
    return out;
  } catch { return {}; }
}

/** Single-symbol Yahoo v8 chart. Handles both equities and "BTC-USD" style crypto. */
async function fetchYahooV8Quote(yahooSymbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d&t=${Date.now()}`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice ?? meta?.previousClose ?? null;
    return price && price > 0 ? Math.round(price * 100) / 100 : null;
  } catch { return null; }
}

/** CoinGecko simple price — primary source for crypto. Free, no API key. */
async function fetchCoinGeckoPrices(ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await res.json();
    const out: Record<string, number> = {};
    for (const [id, data] of Object.entries(json)) {
      const price = (data as any)?.usd;
      if (price && price > 0) out[id] = Math.round(price * 100) / 100;
    }
    return out;
  } catch { return {}; }
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * enrichPricesCore — fetch live prices for a list of tickers.
 * Crypto tickers are routed via CoinGecko → Yahoo -USD suffix.
 * Equities are routed via Yahoo spark bulk → Yahoo v8 individual.
 * OpenAI is an absolute last resort for anything still unresolved.
 *
 * @param tickers   - List of ticker symbols (e.g. ["BTC", "ETH", "NVDA"])
 * @param openAIKey - Optional OpenAI API key for the last-resort fallback
 */
export async function enrichPricesCore(
  tickers: string[],
  openAIKey?: string
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  const upperTickers = tickers.map(t => t.toUpperCase());

  const cryptoTickers = upperTickers.filter(t => t in CRYPTO_MAP);
  const equityTickers = upperTickers.filter(t => !(t in CRYPTO_MAP));

  // ── 1a. Equities: bulk spark → individual v8 for failures ─────────────────
  const sparkPrices = await fetchYahooSparkBulk(equityTickers);
  Object.assign(results, sparkPrices);

  const equityMissed = equityTickers.filter(t => !results[t]);
  await Promise.all(equityMissed.map(async t => {
    const p = await fetchYahooV8Quote(t);
    if (p) results[t] = p;
  }));

  // ── 1b. Crypto: CoinGecko first ────────────────────────────────────────────
  if (cryptoTickers.length > 0) {
    const cgIds = cryptoTickers.map(t => CRYPTO_MAP[t].coingeckoId);
    const cgPrices = await fetchCoinGeckoPrices(cgIds);
    for (const ticker of cryptoTickers) {
      const cgId = CRYPTO_MAP[ticker].coingeckoId;
      if (cgPrices[cgId]) results[ticker] = cgPrices[cgId];
    }
  }

  // ── 1c. Crypto CoinGecko missed → Yahoo v8 with -USD suffix ───────────────
  const cryptoMissed = cryptoTickers.filter(t => !results[t]);
  await Promise.all(cryptoMissed.map(async ticker => {
    const p = await fetchYahooV8Quote(CRYPTO_MAP[ticker].yahooSymbol);
    if (p) results[ticker] = p;
  }));

  // ── 2. OpenAI last resort — only for tickers both live sources missed ──────
  const stillFailed = upperTickers.filter(t => !results[t]);
  const openAIResolved: string[] = [];

  if (stillFailed.length > 0 && openAIKey) {
    try {
      const openai = new OpenAI({ apiKey: openAIKey });
      const prompt =
        `You are a financial data tool. Return ONLY a valid JSON object mapping each ticker to its most recent known USD price (numbers only, no markdown).\n` +
        `For crypto use the bare ticker as the key (BTC not BTC-USD).\n` +
        `Tickers: ${stillFailed.join(", ")}\n` +
        `Example: {"BTC": 82000, "ETH": 1800, "AAPL": 213.50}`;
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 300,
      });
      const raw = response.choices[0]?.message?.content?.trim() ?? "{}";
      const cleaned = raw.replace(/```[a-z]*\n?/gi, "").trim();
      const parsed = JSON.parse(cleaned);
      for (const [ticker, price] of Object.entries(parsed)) {
        const t = ticker.toUpperCase().replace(/-USD$/i, "");
        const numPrice = Number(price);
        if (numPrice > 0 && !results[t]) {
          results[t] = Math.round(numPrice * 100) / 100;
          openAIResolved.push(t);
        }
      }
    } catch { /* fallback also failed — caller will surface remaining gaps */ }
  }

  if (Object.keys(results).length === 0) {
    throw new Error(
      `Could not fetch live prices for: ${tickers.join(", ")}. ` +
      `Yahoo Finance and CoinGecko appear unavailable. Please enter prices manually.`
    );
  }

  // Warn only if every single returned price came from OpenAI training data (stale)
  if (openAIResolved.length > 0 && openAIResolved.length === Object.keys(results).length) {
    throw new Error(
      `⚠️ Live price fetch failed. Prices for ${openAIResolved.join(", ")} were estimated by AI (training data, not real-time) — please verify and correct them manually.`
    );
  }

  return results;
}
