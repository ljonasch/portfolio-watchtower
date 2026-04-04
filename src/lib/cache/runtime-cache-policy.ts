export const NEWS_SEARCH_FETCHER_VERSION = "news_search_v1";
export const PRICE_SNAPSHOT_PROVIDER_VERSION = "yahoo_chart_v1";
export const VALUATION_SNAPSHOT_PROVIDER_VERSION = "yahoo_quote_summary_v1";
export const SENTIMENT_EXTRACTION_PROMPT_VERSION = "headline_sentiment_v1";

export function buildRuntimeVersionTag(parts: string[]): string {
  return parts.join("::");
}
