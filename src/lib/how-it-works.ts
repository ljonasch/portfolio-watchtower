// Last updated: 2026-03-29 (MVP 2)
// Update this file whenever the system architecture or flows change.

export const LAST_UPDATED = "2026-03-29";
export const VERSION = "MVP 2";

export const HOW_IT_WORKS_SECTIONS = [
  {
    id: "what-it-is",
    title: "What is Portfolio Watchtower?",
    body: `Portfolio Watchtower is a personal investment analysis tool that runs entirely on your own computer. It does not place trades, connect to your brokerage, or share your data with anyone. It simply looks at what you tell it you own and gives you thoughtful, personalized recommendations on what to consider buying, selling, or holding — based on real-time news and your personal financial profile.`,
  },
  {
    id: "inputs",
    title: "What does it use as inputs?",
    body: `The app uses two main inputs:

1. **Your portfolio screenshot** — You take a screenshot of your brokerage holdings page and upload (or paste) it into the app. The app reads the image to extract each stock/ETF ticker, how many shares you hold, and the current price.

2. **Your profile** — You fill in details about yourself in the Settings page: your age, risk tolerance, what kind of account this is (taxable brokerage, Roth IRA, etc.), your investment objective, time horizon, and more. Every recommendation is tailored to these settings. If you haven't filled in a setting, the app won't assume anything — it will only use what you've told it.`,
  },
  {
    id: "screenshot-to-holdings",
    title: "How does a screenshot become portfolio data?",
    body: `When you upload a screenshot, the app sends it to OpenAI's vision model (GPT-4o), which reads the image like a human would and extracts each holding's ticker symbol, share count, and price. This is called OCR (Optical Character Recognition) enhanced with AI.

You then get to review what was extracted on the Review screen, correct any mistakes, and add or remove rows before confirming. Once confirmed, the holdings are saved as a "snapshot" — a frozen record of your portfolio at that point in time.`,
  },
  {
    id: "market-context",
    title: "How does the app gather market and news context?",
    body: `Before generating recommendations, the app runs three separate live web searches using a search-capable AI model (GPT-4o with web search):

- **Macro & geopolitical search** — finds news on Fed decisions, inflation data, jobs reports, and geopolitical events that affect markets broadly.
- **Company-specific search** — looks up recent earnings, analyst upgrades/downgrades, and company news for each ticker you hold.
- **Sector & regulatory search** — finds news about the industries your holdings operate in (tech regulation, defense budgets, healthcare policy, etc.).

All three searches run at the same time to save time. The app only uses URLs it finds — it never makes up news sources.`,
  },
  {
    id: "recommendations",
    title: "How does the recommendation engine work?",
    body: `Once the news is gathered, the app passes everything — your holdings, your profile, your age, and all the news — to a powerful reasoning model (GPT-o4) which acts as a financial analyst.

The model follows a two-phase process:
1. **Anchor phase** — It first figures out what an ideal portfolio looks like based only on your profile (risk tolerance, objective, account type, time horizon). This is a stable baseline.
2. **News adjustment phase** — It then reviews the news and only adjusts from the anchor if there's a specific, material reason (like an earnings miss or a Fed rate change). Vague market uncertainty is NOT sufficient reason to recommend a change.

A "no-churn" rule is enforced: if a position is already within ±4% of the ideal weight and there's no specific news event driving a change, the app recommends holding it — not rebalancing just to be thorough.

The model is configured for consistency (temperature = 0), meaning it gives the same answer for the same inputs, making its advice more reliable over time.`,
  },
  {
    id: "snapshots-storage",
    title: "What data is stored?",
    body: `Everything is stored locally on your computer in a SQLite database file (dev.db). Nothing leaves your machine except the API calls to OpenAI (your holdings and profile are sent to OpenAI for analysis). Specifically, the app stores:

- Portfolio snapshots (each upload is saved)
- Extracted holdings per snapshot
- Every analysis report and its recommendations
- A log of every automated and manual analysis run
- A log of every change between consecutive runs
- Notification history (sent emails and in-app alerts)
- Your user profile
- Notification recipient email addresses
- Watchlist ideas suggested by the AI`,
  },
  {
    id: "scheduled-checks",
    title: "How do scheduled checks and notifications work?",
    body: `The app runs a background process called the **Portfolio Watchtower Scheduler**. This process starts automatically when your computer boots and runs invisibly in the background — you can see it in Task Manager with that name.

Every day at your configured time, the scheduler:
1. Loads your latest confirmed portfolio snapshot
2. Loads your current profile
3. Runs a full analysis (live news + AI recommendations)
4. Compares the new recommendations to yesterday's
5. Determines whether anything important changed
6. Sends you an email if the change is meaningful

You'll also get a **weekly summary email** every Sunday (configurable) that recaps the week's runs and key changes — regardless of whether anything changed.

If you just want to trigger a check manually, use the "Run daily check now" button in the Debug section of the dashboard.`,
  },
  {
    id: "profile-effect",
    title: "How do profile settings affect recommendations?",
    body: `Your profile is the most important input to the system. Every recommendation is generated with your profile in context:

- **Risk tolerance** — High risk: the model allows more speculative positions. Low risk: it leans toward stability and diversification.
- **Account objective** — Growth vs. income vs. capital preservation shifts what kinds of holdings are recommended.
- **Tax status** — A Roth IRA gets different advice than a taxable brokerage (e.g., tax-loss harvesting matters more in taxable).
- **Max position size** — The app won't recommend any single stock exceed this weight, and will flag it as an alert if it does.
- **Time horizon** — Longer horizon tolerates more volatility. Shorter horizon prioritizes stability.
- **Age** — Computed automatically from your birth year. The system does not hardcode any assumptions — it only knows what you've told it.

If you update your profile, all future runs use the new profile. Past runs preserve a frozen copy of the profile as it was when they ran.`,
  },
  {
    id: "not-financial-advice",
    title: "Important: what this app does NOT do",
    body: `- ❌ Does not place trades or connect to your brokerage
- ❌ Does not give licensed financial advice
- ❌ Does not guarantee any returns
- ❌ Does not share your data with advertisers or third parties
- ✅ Gives recommendations only — you decide whether to act on them
- ✅ All data stays on your computer (except OpenAI API calls)`,
  },
];
