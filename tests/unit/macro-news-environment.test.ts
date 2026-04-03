jest.mock("@/lib/cache", () => ({
  NEWS_SEARCH_FETCHER_VERSION: "test",
  buildNewsSearchCacheKey: () => "macro-cache-key",
  buildRuntimeVersionTag: () => "macro-runtime-tag",
  getOrLoadRuntimeCache: async ({ loader }: { loader: () => Promise<unknown> }) => loader(),
}));

import { collectMacroNewsEnvironment, MACRO_QUERY_FAMILIES } from "@/lib/research/macro-news-environment";

function buildOpenAi(annotationSets: Array<Array<{ title: string; url: string }>>) {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: jest.fn().mockImplementation(async () => {
          const annotations = annotationSets[callIndex] ?? [];
          callIndex += 1;
          return {
            choices: [
              {
                message: {
                  annotations: annotations.map((annotation) => ({
                    type: "url_citation",
                    url_citation: annotation,
                  })),
                },
              },
            ],
          };
        }),
      },
    },
  };
}

function pickStableShape(result: Awaited<ReturnType<typeof collectMacroNewsEnvironment>>) {
  return result.articles.map((article) => ({
    articleId: article.articleId,
    canonicalUrl: article.canonicalUrl,
    trusted: article.trusted,
    stableSortKey: article.stableSortKey,
    queryFamily: article.queryFamily,
  }));
}

describe("macro news environment", () => {
  test("uses the exact fixed global phase-1 macro query families", () => {
    expect(MACRO_QUERY_FAMILIES.map((family) => family.key)).toEqual([
      "rates_inflation_central_banks",
      "recession_labor_growth",
      "energy_commodities",
      "geopolitics_shipping_supply_chain",
      "regulation_export_controls_ai_policy",
      "credit_liquidity_banking_stress",
      "defense_fiscal_industrial_policy",
    ]);
  });

  test("normalizes, dedups, and stable-sorts macro articles deterministically", async () => {
    const commonReuters = {
      title: "Central banks keep pressure on markets",
      url: "https://www.reuters.com/world/us/central-banks-keep-pressure-on-markets/?utm_source=test",
    };
    const commonBlog = {
      title: "Energy markets stay volatile",
      url: "https://macro-blog.example.com/energy-markets-stay-volatile",
    };

    const first = await collectMacroNewsEnvironment(
      buildOpenAi([
        [commonBlog, commonReuters],
        [],
        [{ title: "Energy markets stay volatile", url: commonBlog.url }],
        [],
        [],
        [],
        [],
      ]),
      "2026-04-03",
      jest.fn()
    );

    const second = await collectMacroNewsEnvironment(
      buildOpenAi([
        [commonReuters, commonBlog],
        [],
        [{ title: "Energy markets stay volatile", url: `${commonBlog.url}?utm_campaign=foo` }],
        [],
        [],
        [],
        [],
      ]),
      "2026-04-03",
      jest.fn()
    );

    expect(first.articleCount).toBe(2);
    expect(pickStableShape(first)).toEqual(pickStableShape(second));
    expect(first.articles.map((article) => article.publisher)).toEqual([
      "reuters.com",
      "macro-blog.example.com",
    ]);
  });
});
