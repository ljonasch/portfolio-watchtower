/**
 * article-fetcher.ts — F1: Raw Article Fetch via Jina.ai Reader
 *
 * Instead of scoring GPT-summarized text, we fetch the actual article body
 * using the Jina.ai Reader API (r.jina.ai/URL). This eliminates summarizer bias
 * from sentiment scoring.
 *
 * New failure modes addressed:
 *   N8 — Gracefully handles fetch failures per URL; remaining URLs still scored
 */

export interface RawArticle {
  url: string;
  title: string;
  text: string;  // raw body text from Jina reader
  fetchedOk: boolean;
  charCount: number;
}

const JINA_READER_BASE = "https://r.jina.ai/";
const MAX_ARTICLE_CHARS = 4000; // cap to avoid overwhelming HF models

/**
 * Fetch raw article body via Jina.ai Reader API.
 * Timeouts after 8s per article. Returns partial text if truncated.
 */
export async function fetchRawArticle(url: string): Promise<RawArticle> {
  try {
    // Jina reader: prepend r.jina.ai/ to any URL
    const jinaUrl = `${JINA_READER_BASE}${url}`;
    const res = await fetch(jinaUrl, {
      headers: {
        "Accept": "text/plain",
        "X-Return-Format": "text",  // return as plain text, not markdown
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { url, title: "", text: "", fetchedOk: false, charCount: 0 };
    }

    const raw = await res.text();
    // Jina reader returns: Title: ...\nURL: ...\n\nBody text...
    const titleMatch = raw.match(/^Title:\s*(.+)$/m);
    const title = titleMatch?.[1]?.trim() ?? "";

    // Extract body after the header section (skip to double newline)
    const bodyStart = raw.indexOf("\n\n");
    const body = bodyStart !== -1 ? raw.slice(bodyStart + 2) : raw;

    const text = body.slice(0, MAX_ARTICLE_CHARS);

    return {
      url,
      title,
      text: text.trim(),
      fetchedOk: true,
      charCount: text.length,
    };
  } catch {
    return { url, title: "", text: "", fetchedOk: false, charCount: 0 };
  }
}

/**
 * Fetch raw bodies for a batch of URLs in parallel (max 5 concurrent).
 * N8: Each URL is independent — a single failure doesn't block others.
 */
export async function fetchRawArticles(
  urls: string[],
  maxArticles = 5
): Promise<RawArticle[]> {
  const targets = urls.slice(0, maxArticles);

  const results = await Promise.allSettled(
    targets.map(url => fetchRawArticle(url))
  );

  return results
    .map(r => r.status === "fulfilled" ? r.value : null)
    .filter((r): r is RawArticle => r !== null && r.fetchedOk && r.text.length > 100);
}

/**
 * Format fetched articles for injection into sentiment scoring.
 * Returns per-ticker article list with real text (not summaries).
 */
export function buildRawArticleMap(
  tickers: string[],
  rawArticles: RawArticle[],
  sourceTickerMap: Map<string, string[]>  // url → [tickers_mentioned]
): Map<string, { title: string; text: string; publishedAt: string }[]> {
  const result = new Map<string, { title: string; text: string; publishedAt: string }[]>();

  for (const ticker of tickers) {
    const tickerArticles: { title: string; text: string; publishedAt: string }[] = [];
    const upper = ticker.toUpperCase();

    for (const article of rawArticles) {
      const mentionedTickers = sourceTickerMap.get(article.url) ?? [];
      // Include article if it mentions this ticker, or if the ticker appears in the text
      if (
        mentionedTickers.includes(upper) ||
        article.text.toUpperCase().includes(upper)
      ) {
        tickerArticles.push({
          title: article.title,
          text: article.text,
          publishedAt: new Date().toISOString(), // Jina doesn't return publish date reliably
        });
      }
    }

    if (tickerArticles.length > 0) {
      result.set(ticker, tickerArticles);
    }
  }

  return result;
}
