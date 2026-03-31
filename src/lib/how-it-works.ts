// Last updated: 2026-03-31 (MVP 3)
// Update this file whenever the system architecture or flows change.

export const LAST_UPDATED = "2026-03-31";
export const VERSION = "MVP 3";

export const HOW_IT_WORKS_SECTIONS = [
  {
    id: "what-it-is",
    title: "What is Portfolio Watchtower?",
    body: `Portfolio Watchtower is a personal investment analysis tool that runs entirely on your own computer. It does not place trades, connect to your brokerage, or share your data with anyone. It looks at what you tell it you own, gathers real current news from the internet, and gives you thoughtful, personalized recommendations on what to consider buying, selling, or holding — based on evidence and your personal financial profile.

The app is decision support only. It never executes trades. Every recommendation is informational, not licensed financial advice.`,
  },
  {
    id: "inputs",
    title: "What does it use as inputs?",
    body: `The app uses three main inputs:

**1. Your portfolio screenshot** — You take a screenshot of your brokerage holdings page and upload it. The app reads the image to extract each stock or ETF ticker, how many shares you hold, and the current price.

**2. Your profile** — You fill in details about yourself in Settings: your age, risk tolerance, what kind of account this is, your investment objective, time horizon, and more. Every recommendation is shaped by these settings. If you haven't filled in a field, the app won't assume it — it only uses what you've told it.

**3. Your conviction notes** — For any position, you can write a note explaining why you hold it or why you disagree with the AI's previous recommendation. These notes persist across every future analysis run, so the AI always knows your reasoning and can respond to it directly.`,
  },
  {
    id: "screenshot-to-holdings",
    title: "How does a screenshot become portfolio data?",
    body: `When you upload a screenshot, the app sends it to OpenAI's vision AI (GPT-4o), which reads the image and extracts each holding's ticker symbol, share count, and price. This is called AI-assisted OCR (Optical Character Recognition).

You then review what was extracted, correct any mistakes, and confirm. Once confirmed, the holdings are saved as a "snapshot" — a frozen record of your portfolio at that moment. Every future analysis run uses the most recent confirmed snapshot.`,
  },
  {
    id: "market-context",
    title: "How does the app gather market and news context?",
    body: `Before generating recommendations, the app runs three separate live web searches using a search-capable AI model:

- **Macro & geopolitical search** — Fed decisions, inflation data, jobs reports, geopolitical events.
- **Company-specific search** — Recent earnings, analyst upgrades/downgrades, and company news for each ticker you hold.
- **Sector & regulatory search** — Industry news relevant to the sectors your holdings operate in.

All three run at the same time. The app then **ranks the sources by quality**: primary sources like Reuters, Bloomberg, the FT, SEC filings, and official company investor-relations pages are rated "high quality." Aggregators and blogs are rated lower or filtered out. This means the AI's reasoning is grounded in more trustworthy evidence.

If live news is unavailable, the app falls back to Yahoo Finance headlines and lowers confidence accordingly.`,
  },
  {
    id: "recommendations",
    title: "How does the recommendation engine work?",
    body: `Once news is gathered, everything is assembled into a structured five-phase analysis:

**Phase 1 — Profile Constraints**: The system reads your profile and derives specific binding rules (maximum position size, total speculative exposure limit, cash target, how many holdings to aim for). These are enforced mathematically — not just as suggestions.

**Phase 2 — Evidence Quality Assessment**: Before recommending anything, the AI honestly rates its own research quality for each holding as HIGH, MEDIUM, or LOW. Recommendations with low evidence are marked as lower confidence.

**Phase 3 — Role Classification**: Every holding is assigned exactly one role — Core, Growth, Tactical, Hedge, Speculative, Income, or Watchlist. This role shapes how the position is sized and how strictly it is held.

**Phase 4 — Portfolio Construction**: The system checks for concentration risk (any position too large?), sector overlap (too much in one theme?), whether speculative positions exceed the cap, and whether cash is at the right level.

**Phase 5 — Recommendations with Attribution**: Every recommendation explains what changed from the prior run, what evidence drove it, and whether the position is underweight, overweight, or on target. If you have a conviction note for a stock, the AI explicitly acknowledges it and — if it disagrees — provides specific counterpoints.

All portfolio math (weights, share deltas, dollar deltas) is verified deterministically by the app's own code after the AI responds, not just trusted from the AI output.`,
  },
  {
    id: "conviction-notes",
    title: "What are conviction notes?",
    body: `Conviction notes let you explain your own reasoning for holding a position — even if the AI recommends selling or reducing it.

For example: "I believe NVDA has a 3-year AI infrastructure tailwind that more than justifies its current premium."

Once saved, this note is re-injected into every future analysis run. The AI must acknowledge your reasoning directly. If it disagrees with your rationale, it will present specific counterpoints with supporting evidence so you can make a more informed decision.

Conviction notes persist indefinitely. You can update or retire them at any time. They are shown with a visible badge on the recommendations table so you always know which positions have active notes attached.`,
  },
  {
    id: "uncertainty",
    title: "How does the app handle uncertainty?",
    body: `MVP 3 introduces explicit uncertainty handling throughout:

- If the AI has limited data on a company, it rates its evidence quality as LOW and lowers the recommendation's confidence accordingly.
- If sources conflict or the conclusion is driven by interpretation rather than hard facts, the reasoning will say so.
- The app avoids making specific claims without a source, and flags inferences clearly.
- Recommendations driven by weak evidence use hedged language — "This appears to suggest..." rather than "This confirms..."

The goal is for the app to be reliable and honest — telling you what it knows, what it is inferring, and what it is uncertain about.`,
  },
  {
    id: "snapshots-storage",
    title: "What data is stored?",
    body: `Everything is stored locally on your computer in a SQLite database file (dev.db). Nothing leaves your machine except the API calls to OpenAI. Specifically, the app stores:

- Portfolio snapshots (each upload is saved permanently)
- Extracted holdings per snapshot
- Every analysis report and its recommendations (including role, confidence, why-changed, dollar deltas, and acceptable ranges)
- A frozen copy of your profile at the time of each run (so old reports remain interpretable even after you update your settings)
- A log of every automated and manual analysis run
- Per-run research quality summaries (how many high/medium/low sources were used)
- Notification history
- Your user profile
- Your conviction notes per ticker
- Watchlist ideas with starter recommendations`,
  },
  {
    id: "scheduled-checks",
    title: "How do scheduled checks and notifications work?",
    body: `The app runs a background process called the **Portfolio Watchtower Scheduler**. It starts automatically when your computer boots and runs invisibly — visible in Task Manager as "Portfolio Watchtower Scheduler."

Every day at your configured time (set in Settings), the scheduler:
1. Loads your latest confirmed portfolio snapshot and refreshes live prices
2. Loads your current profile and active conviction notes
3. Runs the full five-phase analysis (live news + source ranking + AI recommendations)
4. Validates the math and enforces all constraints
5. Compares the new recommendations to the prior run
6. Determines the alert level based on what changed
7. Sends you an email if the change is meaningful

If you change your scheduled time in the Settings UI, the scheduler detects the change within 60 seconds and automatically re-schedules without needing a restart.`,
  },
  {
    id: "profile-effect",
    title: "How do profile settings affect recommendations?",
    body: `Your profile is the most important input. All constraints are derived from it:

- **Risk tolerance** — Determines how much total weight can go into Speculative-role positions (e.g. 0% for low risk, 20% for high, 40% for speculative).
- **Account objective** — Growth vs. income vs. preservation shifts what roles are emphasized.
- **Tax status** — A Roth IRA and a taxable brokerage receive different logic.
- **Max position size** — The app enforces this mathematically, not just as a suggestion.
- **Target number of holdings** — Used to guide diversification.
- **Sectors to emphasize/avoid** — Enforced as hard constraints, not just hints.
- **Age** — Computed dynamically from your birth year every single run. Not stored as a static field.

When you update your profile, all future runs use the new profile. Past runs permanently preserve the profile context that was used when they ran — historical reports remain interpretable.`,
  },
  {
    id: "not-financial-advice",
    title: "Important: what this app does NOT do",
    body: `- ❌ Does not place trades or connect to your brokerage
- ❌ Does not give licensed financial advice
- ❌ Does not guarantee any returns
- ❌ Does not share your data with advertisers or third parties
- ✅ Gives recommendations only — you decide whether to act on them
- ✅ All data stays on your computer (except OpenAI API calls for analysis)
- ✅ Expresses uncertainty honestly — you always know how confident the AI is and why`,
  },
];
