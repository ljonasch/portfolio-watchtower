import OpenAI from "openai";
// Use a wide type for profile to avoid stale Prisma IDE cache issues — runtime types are always correct
type UserProfileData = Record<string, any>;

export interface Source {
  title: string;
  url: string;
}

export interface MarketFactor {
  factor: string;
  explanation: string;
  sources: Source[];
}

export interface MarketContext {
  shortTerm: MarketFactor[];
  mediumTerm: MarketFactor[];
  longTerm: MarketFactor[];
}

export interface RecommendationResult {
  ticker: string;
  companyName?: string;
  role: string;
  currentShares: number;
  targetShares: number;
  shareDelta: number;
  currentWeight: number;
  targetWeight: number;
  valueDelta: number;
  action: 'Buy' | 'Sell' | 'Hold' | 'Exit' | 'Add';
  confidence: string;
  thesisSummary: string;
  detailedReasoning: string;
  reasoningSources: Source[];
}

export interface PortfolioReportData {
  summary: string;
  reasoning: string;
  marketContext: MarketContext;
  recommendations: RecommendationResult[];
}

interface LiveNewsResult {
  summary: string;
  sources: Source[];
}

/**
 * Direct HTTP fallback to Yahoo Finance API
 */
async function fetchFallbackYahooNews(tickers: string[]): Promise<LiveNewsResult> {
  try {
    const nonCash = tickers.filter(t => t !== 'CASH');
    if (nonCash.length === 0) return { summary: "", sources: [] };
    
    // Pick the top major holdings to prevent massive request spam if portfolio is huge
    const targetTickers = nonCash.slice(0, 10);
    const allTitles: string[] = [];
    const sources: Source[] = [];

    await Promise.all(targetTickers.map(async (ticker) => {
      try {
        const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${ticker}&newsCount=3`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await res.json();
        const news = json?.news ?? [];
        for (const item of news) {
          if (item?.title && item?.link) {
            allTitles.push(`- [${ticker}] ${item.title}`);
            sources.push({ title: item.title, url: item.link });
          }
        }
      } catch (err) {
        /* Ignore individual ticker failures */
      }
    }));

    if (allTitles.length === 0) return { summary: "", sources: [] };

    return {
      summary: `Recent unformatted fallback headlines from Yahoo Finance:\n${allTitles.join("\n")}`,
      sources
    };
  } catch (err) {
    return { summary: "", sources: [] };
  }
}

/**
 * Runs 3 separate targeted gpt-4o-search-preview calls in parallel:
 *   1. Macro / Fed / geopolitics
 *   2. Company-specific earnings, analyst updates per ticker
 *   3. Sector & regulatory themes
 * Results are merged to guarantee a broad, non-repeating source pool.
 */
async function fetchLiveNewsForTickers(
  openai: OpenAI,
  tickers: string[],
  today: string,
  onProgress?: (step: number) => void
): Promise<LiveNewsResult> {
  const nonCash = tickers.filter(t => t !== 'CASH');
  if (nonCash.length === 0) return { summary: "", sources: [] };

  const tickerList = nonCash.join(", ");

  async function searchCall(prompt: string): Promise<LiveNewsResult> {
    try {
      const resp = await (openai.chat.completions.create as Function)({
        model: "gpt-4o-search-preview",
        web_search_options: {},
        messages: [{ role: "user", content: prompt }],
      }) as import("openai").OpenAI.Chat.ChatCompletion;

      const message = resp.choices[0]?.message;
      const textContent = message?.content ?? "";
      const annotations: any[] = (message as any)?.annotations ?? [];
      const sources: Source[] = annotations
        .filter((a: any) => a.type === "url_citation" && a.url_citation?.url)
        .map((a: any) => ({
          title: a.url_citation.title ?? new URL(a.url_citation.url).hostname,
          url: a.url_citation.url,
        }));
      return { summary: textContent, sources };
    } catch (err: any) {
      console.warn("Search call failed:", err?.message);
      return { summary: "", sources: [] };
    }
  }

  // Run 3 distinct searches — fire progress callback as each one actually finishes
  const macroPromise = searchCall(
    `Today is ${today}. Search exclusively for MACROECONOMIC and GEOPOLITICAL news from the last 30 days that affects equity markets broadly and specifically these holdings: ${tickerList}.

You MUST find and cite at least 5–8 distinct real news articles. Search specifically for:
- Federal Reserve rate decisions, FOMC minutes, Fed speaker comments
- CPI, PCE, jobs report (NFP), GDP data releases
- Geopolitical flashpoints: wars, sanctions, tariffs, trade disputes
- Treasury yield movements and dollar strength
- Any energy/commodity shocks (oil, natural gas, metals)

For each item, state which ticker(s) it impacts and how. Cite every source with a real URL.`
  ).then(r => { onProgress?.(0); return r; });

  const companyPromise = searchCall(
    `Today is ${today}. Search for COMPANY-SPECIFIC news from the last 30 days for EACH of these individual stocks: ${tickerList}.

For EACH ticker, find and cite separate, dedicated articles about:
- Latest earnings reports, revenue beats/misses, EPS surprises
- Forward guidance changes, analyst upgrades/downgrades, price target revisions
- Insider buying/selling, share buybacks
- Product launches, partnerships, acquisitions, or legal issues
- CEO/executive changes

Treat each ticker independently. Cite a unique, real article URL for each company. Do not reuse the same sources across different tickers.`
  ).then(r => { onProgress?.(1); return r; });

  const sectorPromise = searchCall(
    `Today is ${today}. Search for SECTOR, REGULATORY, and THEMATIC news from the last 30 days relevant to the industry sectors of these holdings: ${tickerList}.

Focus on:
- AI / semiconductor / cloud computing regulatory news
- Energy transition policy, EPA rules, oil/gas sector trends
- Financial regulatory changes (SEC, banking rules, interest rate policy)
- Healthcare/biotech FDA approvals, drug pricing legislation
- Defense spending bills, government contracts
- Tech antitrust investigations or rulings

For each theme, cite multiple distinct sources. Link specifically to how each news item affects one or more of the listed holdings.`
  ).then(r => { onProgress?.(2); return r; });

  const [macro, company, sector] = await Promise.all([macroPromise, companyPromise, sectorPromise]);

  // Merge summaries and deduplicate sources by URL
  const combinedSummary = [
    macro.summary ? `=== MACRO & GEOPOLITICS ===\n${macro.summary}` : '',
    company.summary ? `=== COMPANY-SPECIFIC NEWS ===\n${company.summary}` : '',
    sector.summary ? `=== SECTOR & REGULATORY ===\n${sector.summary}` : '',
  ].filter(Boolean).join('\n\n');

  const seenUrls = new Set<string>();
  const allSources: Source[] = [...macro.sources, ...company.sources, ...sector.sources].filter(s => {
    if (seenUrls.has(s.url)) return false;
    seenUrls.add(s.url);
    return true;
  });

  return { summary: combinedSummary, sources: allSources };
}

export async function generatePortfolioReport(
  holdings: import('@prisma/client').Holding[],
  profile: UserProfileData,
  settings: Record<string, any>,
  onProgress?: (step: number) => void,
  priorRecommendations?: import('@prisma/client').HoldingRecommendation[]
): Promise<PortfolioReportData> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in your .env file.");
  }
  
  const openai = new OpenAI({ apiKey });
  
  // Use shares*price as fallback so totalValue is never understated
  const totalValue = holdings.reduce((sum, h) => {
    return sum + (h.currentValue || (h.shares * (h.currentPrice || 0)));
  }, 0);
  const currentYear = new Date().getFullYear();
  const age = currentYear - profile.birthYear;
  const today = new Date().toISOString().split("T")[0];
  const tickers = holdings.map(h => h.ticker);

  // Step 1: Fetch real, verified current news — fires onProgress(0/1/2) as each search completes
  // Ensure this doesn't hang forever. Increased timeout to 45s for primary AI web search.
  let liveNews = await Promise.race([
    fetchLiveNewsForTickers(openai, tickers, today, onProgress),
    new Promise<{summary: string, sources: any[]}>((resolve) => setTimeout(() => resolve({ summary: "", sources: [] }), 45000))
  ]);

  if (!liveNews.summary || liveNews.summary.trim() === "") {
    console.log("[Analyzer] Primary news fetch failed or timed out. Switching to Yahoo Finance fallback...");
    liveNews = await fetchFallbackYahooNews(tickers);
  }

  // Step 2 begins — notify that we're now running the AI analysis
  onProgress?.(3);

  const liveNewsSection = liveNews.summary && liveNews.summary.trim() !== ""
    ? `
=== VERIFIED CURRENT NEWS (from live web search, ${today}) ===
The following is real, current news retrieved via web search. Use these facts to ground your analysis.
You MUST use the exact URLs provided below as sources — do NOT invent URLs.

${liveNews.summary}

Verified source URLs you may cite:
${liveNews.sources.map(s => `- ${s.title}: ${s.url}`).join('\n')}

=== END CURRENT NEWS ===
`
    : `[ERROR: Live news fetch failed due to timeouts or API unavailability. Please inform the user in your opening summary that real-time live news was unavailable for this analysis run and you are relying entirely on offline/cached knowledge.]

Note: Live news completely unavailable. Use your best training knowledge, but only cite sources you are confident exist. Prefer search URLs (e.g. https://www.reuters.com/search/news?blob=TICKER) over specific article URLs you are not certain about.`;

  // Pre-compute the actual current weights so the AI has exact, stable input
  const holdingsWithWeights = holdings.map(h => {
    const value = h.currentValue || (h.shares * (h.currentPrice || 0));
    const weight = totalValue > 0 ? Number(((value / totalValue) * 100).toFixed(2)) : 0;
    return { ...h, computedWeight: weight, computedValue: value };
  });

  const priorRecsSection = priorRecommendations && priorRecommendations.length > 0
    ? `
=== PREVIOUS RECOMMENDATIONS (CONVERGENCE TARGET) ===
You previously ran an analysis on this portfolio and generated the following target allocations:
${priorRecommendations.map(r => `${r.ticker}: ${r.targetWeight}% (Target Shares: ${r.targetShares})`).join('\n')}

**CRITICAL RULE FOR CONVERGENCE:** 
The user relies on you for stability. Do NOT constantly change your ideal "anchor" allocations from run to run simply because of random model variation. Use the above prior recommendations as your strict baseline anchor. 
If the user's current shares match your previous target shares perfectly, OR their current weight is within ±1.5% of your previous target weight, you MUST issue a "HOLD" recommendation (action: "hold", targetShares exactly equal to currentShares, targetWeight = currentWeight). 
ONLY deviate from these prior targets if there is a massive breaking event in the LIVE NEWS that explicitly destroys your previous thesis.
`
    : '';

  const prompt = `
You are an expert portfolio manager and market analyst. Today's date is ${today}.

=== USER PROFILE ===
Age: ${age} | Target retirement age: ${profile.targetRetirementAge}
Employment: ${profile.employmentStatus || 'Not specified'} — ${profile.profession || 'Not specified'}
Annual income range: ${profile.annualIncomeRange || 'Not specified'}
Income stability: ${profile.jobStabilityVolatility || 'Not specified'}
Emergency fund: ${profile.emergencyFundMonths != null ? `${profile.emergencyFundMonths} months` : 'Not specified'}

=== THIS ACCOUNT ===
Tax status: ${profile.trackedAccountTaxStatus || 'Not specified'}
Risk tolerance: ${profile.trackedAccountRiskTolerance}
Objective: ${profile.trackedAccountObjective}
Style: ${profile.trackedAccountStyle || 'Not specified'}
Time horizon: ${profile.trackedAccountTimeHorizon || 'Not specified'}
Leverage/options: ${profile.leverageOptionsPermitted || 'None'}
Max drawdown tolerance: ${profile.maxDrawdownTolerancePct != null ? `${profile.maxDrawdownTolerancePct}%` : 'Not specified'}
Target # of holdings: ${profile.targetNumberOfHoldings ?? 'Not specified'}
Max single position: ${profile.maxPositionSizePct != null ? `${profile.maxPositionSizePct}%` : settings.maxSinglePositionWeight || 15}%
Sectors to EMPHASIZE: ${profile.sectorsToEmphasize || 'None specified'}
Sectors to AVOID: ${profile.sectorsToAvoid || 'None specified'}

=== SEPARATE RETIREMENT ASSETS ===
Total value: ${profile.separateRetirementAssetsAmount != null ? `$${profile.separateRetirementAssetsAmount.toLocaleString()}` : 'Not specified'}
Account types: ${profile.separateRetirementAccountsDescription || 'Not specified'}
Asset mix: ${profile.retirementAccountAssetMix || 'Not specified'}

=== ADDITIONAL NOTES ===
${profile.notes || 'None'}

=== CURRENT PORTFOLIO (Total Value: $${totalValue.toLocaleString()}) ===
The "computedWeight" field below is the EXACT current allocation — treat this as ground truth.
${JSON.stringify(holdingsWithWeights.map(h => ({
  ticker: h.ticker,
  shares: h.shares,
  currentPrice: h.currentPrice,
  computedValue: h.computedValue,
  computedWeight: h.computedWeight,
  isCash: h.isCash,
})), null, 2)}

${liveNewsSection}
${priorRecsSection}

ANALYSIS METHODOLOGY — follow these three phases in order:

PHASE 1 — ESTABLISH THE STABLE ANCHOR:
- Given ONLY the user profile, define what an ideal allocation looks like for this portfolio.
- If "PREVIOUS RECOMMENDATIONS" are provided above, adopt them entirely as your baseline anchor. Do not invent a new anchor.

PHASE 2 — APPLY TACTICAL NEWS ADJUSTMENTS:
- Review the current news. Only deviate from the Phase 1 anchor if a specific, material news event justifies it.

PHASE 3 — CONVERGENCE & MINIMAL TRADING:
- Review the user's EXACT current portfolio vs your target. If the current weight matches your target within ±1.5%, you must snap exactly to the user's current position to minimize unnecessary fractional trading. Output 'hold' with identical target shares.

CRITICAL MATH CONSTRAINTS:
1. The sum of all "targetWeight" values across the recommendations array MUST equal exactly 100%.
2. If you reduce the weight of an overweight position, you MUST increase targetShares of another position so no money disappears.
3. For each holding, (targetShares * currentPrice) / totalValue * 100 ≈ targetWeight (except for Cash, where targetShares is dollars).

NEW POSITION CAPABILITY (important):
- You are NOT limited to the current holdings. If the current portfolio is missing exposure to a sector that strongly fits the user's profile and current news, explicitly recommend adding a new stock or ETF.
- For a NEW position: set currentShares = 0, currentWeight = 0, shareDelta = targetShares, action = "Buy", and provide an estimated currentPrice (use your knowledge of approximate current price).
- New positions must come at the expense of existing ones — reduce other targetWeights proportionally so the total remains 100%.
- Be specific. Recommend a real ticker (e.g. "GEO", "PLTR", "XLE") not a vague asset class. Justify with current news.
- If the portfolio already covers all key exposures well, it is fine to propose no new positions.

POSITION TOLERANCE / NO-CHURN RULE (strictly enforced):
- If a holding's computedWeight (shown above) is already within ±4 percentage points of the Phase 1 anchor weight AND there is no specific material news event (not vague macro sentiment) driving a change, set targetShares = currentShares, shareDelta = 0, action = "Hold".
- This tolerance band is intentionally wide to prevent churn. A portfolio that is 4% off-anchor is NOT broken — it does not need rebalancing unless news or profile changes justify it.
- Prefer 0-2 high-conviction changes per run over 5+ small adjustments.

SOURCE RULES (strictly enforced):
- For sources, ONLY use URLs from the verified list above (if available), OR Yahoo Finance quote pages (https://finance.yahoo.com/quote/TICKER), OR major publication homepages (https://www.reuters.com, https://www.bloomberg.com, etc.)
- Do NOT make up article URLs. If you don't have a specific article URL, use a search URL: https://www.reuters.com/search/news?blob=TICKER+keyword
- Your analysis MUST reflect the current news provided above — if news shows a geopolitical event boosting a sector (e.g. oil due to US-Iran tensions), your recommendation MUST account for it
`;
  // Step 2: Run main analysis — temperature=0 for deterministic, consistent output
  const response = await openai.chat.completions.create({
    model: "gpt-5.4",
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "portfolio_report",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            reasoning: { type: "string" },
            marketContext: {
              type: "object",
              properties: {
                shortTerm: { type: "array", items: { type: "object", properties: { factor: { type: "string" }, explanation: { type: "string" }, sources: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } }, additionalProperties: false, required: ["title", "url"] } } }, additionalProperties: false, required: ["factor", "explanation", "sources"] } },
                mediumTerm: { type: "array", items: { type: "object", properties: { factor: { type: "string" }, explanation: { type: "string" }, sources: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } }, additionalProperties: false, required: ["title", "url"] } } }, additionalProperties: false, required: ["factor", "explanation", "sources"] } },
                longTerm: { type: "array", items: { type: "object", properties: { factor: { type: "string" }, explanation: { type: "string" }, sources: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } }, additionalProperties: false, required: ["title", "url"] } } }, additionalProperties: false, required: ["factor", "explanation", "sources"] } },
              },
              additionalProperties: false,
              required: ["shortTerm", "mediumTerm", "longTerm"]
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  ticker: { type: "string" },
                  companyName: { type: "string" },
                  role: { type: "string" },
                  currentShares: { type: "number" },
                  currentPrice: { type: "number" },
                  targetShares: { type: "number" },
                  shareDelta: { type: "number" },
                  currentWeight: { type: "number" },
                  targetWeight: { type: "number" },
                  valueDelta: { type: "number" },
                  action: { type: "string" },
                  confidence: { type: "string" },
                  thesisSummary: { type: "string" },
                  detailedReasoning: { type: "string" },
                  reasoningSources: { type: "array", items: { type: "object", properties: { title: { type: "string" }, url: { type: "string" } }, additionalProperties: false, required: ["title", "url"] } }
                },
                additionalProperties: false,
                required: ["ticker", "companyName", "role", "currentShares", "currentPrice", "targetShares", "shareDelta", "currentWeight", "targetWeight", "valueDelta", "action", "confidence", "thesisSummary", "detailedReasoning", "reasoningSources"]
              }
            }
          },
          additionalProperties: false,
          required: ["summary", "reasoning", "marketContext", "recommendations"]
        }
      }
    },
    messages: [
      {
        role: "system",
        content: "You are a top-tier financial advisor API. Ground all recommendations in the verified current news provided. Never fabricate article URLs — use only the verified URLs given or well-known homepage/search URLs. Be consistent: a well-balanced portfolio should not need to be reshuffled without a specific, material justification.",
      },
      { role: "user", content: prompt },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Failed to generate report");
  
  try {
    const parsed = JSON.parse(content) as PortfolioReportData;
    if (!parsed.marketContext) {
      parsed.marketContext = { shortTerm: [], mediumTerm: [], longTerm: [] };
    }
    // Ensure each recommendation has a reasoningSources array and exact mathematical currentWeight
    for (const rec of parsed.recommendations) {
      if (!Array.isArray(rec.reasoningSources)) {
        rec.reasoningSources = [];
      }

      const holding = holdings.find(h => h.ticker === rec.ticker);
      if (holding && totalValue > 0) {
        // Existing holding — compute real current weight from actual price data
        const actualValue = holding.currentValue || (holding.shares * (holding.currentPrice || (rec as any).currentPrice || 0));
        rec.currentWeight = Number(((actualValue / totalValue) * 100).toFixed(2));
      } else {
        // New position not currently in portfolio
        rec.currentShares = 0;
        rec.currentWeight = 0;
        // shareDelta should equal targetShares for a fully new buy
        if (!rec.shareDelta || rec.shareDelta === 0) {
          rec.shareDelta = rec.targetShares;
        }
      }
    }
    return parsed;
  } catch(e) {
    throw new Error("Failed to parse the OpenAI JSON response for Analyzer.");
  }
}
