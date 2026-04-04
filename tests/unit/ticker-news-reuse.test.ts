import {
  buildTickerNewsReuseDescriptor,
  isTickerNewsArtifactFresh,
  TICKER_NEWS_QUERY_MODE,
  TICKER_NEWS_REUSE_MAX_AGE_HOURS,
  TICKER_NEWS_SELECTION_CONTRACT,
} from "@/lib/research/ticker-news-reuse";

describe("ticker news reuse descriptor", () => {
  test("same material ticker set and same query contract remain reuse-comparable across input reordering", () => {
    const first = buildTickerNewsReuseDescriptor({
      tickers: ["msft", "AAPL", "CASH", "aapl"],
    });
    const second = buildTickerNewsReuseDescriptor({
      tickers: ["AAPL", "MSFT"],
    });

    expect(first).toEqual({
      materialTickerSet: ["AAPL", "MSFT"],
      queryMode: TICKER_NEWS_QUERY_MODE,
      selectionContract: TICKER_NEWS_SELECTION_CONTRACT,
      requestFingerprint: second.requestFingerprint,
    });
    expect(second.materialTickerSet).toEqual(["AAPL", "MSFT"]);
  });

  test("material ticker changes produce a different request fingerprint", () => {
    const first = buildTickerNewsReuseDescriptor({ tickers: ["AAPL", "MSFT"] });
    const second = buildTickerNewsReuseDescriptor({ tickers: ["AAPL", "NVDA"] });

    expect(first.requestFingerprint).not.toBe(second.requestFingerprint);
  });

  test("freshness guard allows recent finalized artifacts and rejects stale ones", () => {
    const now = Date.now();
    const freshFinalizedAt = new Date(now - (2 * 60 * 60 * 1000));
    const staleFinalizedAt = new Date(now - ((TICKER_NEWS_REUSE_MAX_AGE_HOURS + 1) * 60 * 60 * 1000));

    expect(isTickerNewsArtifactFresh(freshFinalizedAt, now)).toBe(true);
    expect(isTickerNewsArtifactFresh(staleFinalizedAt, now)).toBe(false);
  });
});
