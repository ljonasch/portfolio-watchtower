# Antigravity Handoff

Last updated: 2026-04-04 (America/Los_Angeles)

## Purpose

This file is a self-contained handoff so a new coding agent can continue the Portfolio Watchtower work without re-discovering recent decisions, implemented batches, user preferences, or the current cost/runtime diagnosis.

The immediate next priority is **search-cost reduction with minimal behavioral drift**.

## Hard requirements from the repo/user

From [AGENTS.md](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/AGENTS.md):

- If you make any code change, you must automatically:
  - `git add .`
  - `git commit -m "[description]"`
  - `git push`
- If touching Next.js app code, read the relevant guide in `node_modules/next/dist/docs/` first because this repo uses a breaking-changes version of Next.js.

Working style the user has consistently preferred:

- Keep changes **narrow and architecture-safe**
- Do **not** redesign the pipeline unless explicitly asked
- Prefer **proposal / approval first**, then implementation
- Preserve existing behavior where possible
- Keep diagnostics adapters thin and avoid parallel subsystems
- Keep tests close to the code they own; avoid orchestrator test sprawl over time

## Current HEAD / workspace state

- Current `HEAD`: `ab7cc79239b798266c1e3a79f49e93b8ac6babe0`
- Latest commit message: `harden market-data helper freshness`

Current uncommitted workspace noise when this handoff was written:

- `dev.db`
- `logs/scheduler.log`
- `logs/scheduler-error.log`

These are runtime-noise artifacts and should generally **not** be committed unless the user explicitly asks for DB/log changes.

## Program architecture overall

Portfolio Watchtower is a **bundle-backed portfolio analysis system**. The current architecture is best understood as five layers:

### 1. Input and trigger layer

- Portfolio state enters through persisted snapshots and holdings.
- Runs are started manually or by the daily scheduler.
- Important entrypoints:
  - [src/app/api/analyze/stream/route.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/api/analyze/stream/route.ts)
  - [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)
  - [src/lib/scheduler.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/scheduler.ts)

### 2. Research and evidence layer

- The main coordinator is [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts).
- It assembles:
  - regime
  - gap analysis
  - macro environment
  - environmental gaps
  - candidate search lanes
  - candidate screening
  - ticker news
  - price timelines
  - valuation
  - correlation
  - sentiment inputs
- This is the layer where most provider pressure and freshness logic currently lives.

### 3. Analyzer / recommendation layer

- The primary final-analysis logic lives in [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts).
- It builds the final Stage 3 prompt, runs the main LLM call, validates output, applies deterministic rules, and produces the final recommendation payload.

### 4. Persistence / canonical artifact layer

- `AnalysisRun` tracks execution status.
- `AnalysisBundle` is the canonical modern artifact.
- `PortfolioReport` and `HoldingRecommendation` still exist for compatibility.
- Evidence is intentionally frozen before the final model call so downstream reporting can be bundle-backed and replayable.

### 5. Read-model / delivery layer

- Current reports, archives, exports, and email delivery read increasingly from bundle-backed artifacts.
- Relevant services live under [src/lib/read-models](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models) and [src/lib/services](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services).

### Architectural principles that have been preserved

- Keep changes **narrow and local**
- Prefer **exact-match reuse from finalized immutable bundle evidence**
- Use **bounded freshness windows** to prevent sticky reuse
- Preserve deterministic replay where the architecture already supports it
- Avoid broad cache-platform redesign
- Avoid recommendation-logic redesign when solving runtime/cost problems

### Most important current file to understand first

If a new agent only reads one file first, it should be:

- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)

That file is the clearest map of how the system behaves end-to-end today.

## Changes made recently

The repo has gone through a sequence of **narrow hardening batches**, not a redesign.

### Change theme 1: determinism + reuse

Added exact-match reuse and freshness guards for:

- candidate screening
- structural gap analysis
- macro environment collection
- ticker-news article sets

### Change theme 2: Stage 3 reliability

Added:

- structured context budgeting
- final prompt preflight
- deterministic overflow recovery
- clear abstain path when the final Stage 3 prompt still cannot fit

### Change theme 3: provider-pressure visibility

Added a small shared provider-pressure diagnostics foundation and extended it into:

- gap analysis
- macro environment
- ticker news
- some market-data helper diagnostics

### Change theme 4: market-data helper freshness

Added:

- intraday-ish price helper refresh behavior
- daily-ish valuation refresh behavior
- thin helper-local diagnostics

### What has intentionally not been redesigned

- recommendation philosophy
- candidate scoring philosophy
- Stage 3 decision logic
- macro theme / bridge philosophy
- broader cache platform
- a repo-wide search platform redesign

## Recent implementation history

Recent landed commits:

- `ab7cc79` `harden market-data helper freshness`
- `dc21b9c` `harden ticker news reuse`
- `13edb64` `harden macro environment reuse`
- `d1a1136` `remove date framing from gap prompts`
- `822d9c7` `harden gap-analysis provider pressure`
- `7957ebc` `harden stage3 prompt overflow recovery`
- `ed12b38` `default candidate screening to normal`
- `ecbedee` `reduce candidate screening provider pressure`
- `08d034f` `harden stage3 prompt preflight guard`
- `3ade194` `add stage3 context budget guard`

## What is already hardened

### Candidate screening

- Internal `full` = product-facing **Normal**
- Scheduled runs default to Normal/internal `full`
- Manual runs default to Normal/internal `full`
- Lite is manual opt-in only
- Added deterministic screening fingerprinting, finalized-bundle reuse, and diagnostics

Primary files involved:

- [src/lib/research/candidate-screener.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/candidate-screener.ts)
- [src/lib/research/candidate-screening-fingerprint.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/candidate-screening-fingerprint.ts)
- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)

### Stage 3 prompt-budget hardening

- Structured Stage 3 context budgeting exists
- Final prompt preflight exists
- Deterministic overflow-recovery ladder exists
- `STAGE3_PREFLIGHT_BUDGET_EXCEEDED` remains the last-resort abstain path

Primary files involved:

- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)
- [src/lib/research/stage3-context-budget.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/stage3-context-budget.ts)

### Batch 1: gap-analysis provider-pressure hardening

- Shared provider-pressure diagnostics foundation introduced
- Gap-analysis fingerprint + finalized-bundle reuse added
- 72-hour reuse guard added
- Tiny cleanup later removed incidental date framing from structural gap prompts

Primary files involved:

- [src/lib/research/provider-pressure-diagnostics.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/provider-pressure-diagnostics.ts)
- [src/lib/research/gap-analysis-fingerprint.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analysis-fingerprint.ts)
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)

### Batch 2: macro environment hardening

- Reused shared provider-pressure diagnostics
- Added macro-specific diagnostics
- Added replay-context comparability helper
- Added finalized-bundle frozen macro-evidence reuse
- Added 24-hour freshness guard
- Kept deterministic replay for consensus / bridge / environmental gaps / lanes

Primary files involved:

- [src/lib/research/macro-news-environment.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-news-environment.ts)
- [src/lib/research/macro-environment-reuse.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-environment-reuse.ts)
- [src/lib/research/macro-evidence-freeze.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-evidence-freeze.ts)

### Batch 3: ticker-news hardening

- Extended shared provider-pressure diagnostics into ticker news
- Added explicit comparability / reuse helper
- Added finalized-bundle frozen article-set reuse
- Added 6-hour freshness guard
- Kept dedup narrow and local

Primary files involved:

- [src/lib/research/news-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/news-fetcher.ts)
- [src/lib/research/ticker-news-reuse.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/ticker-news-reuse.ts)

### Batch 4: market-data helper freshness hardening

- Price-first
- Added intraday-ish bounded refresh for price helper
- Added daily-ish bounded refresh for valuation helper
- Added thin market-data helper diagnostics adapter
- Left correlation intentionally unchanged unless shared input reuse is clearly justified

Primary files involved:

- [src/lib/research/price-timeline.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/price-timeline.ts)
- [src/lib/research/valuation-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/valuation-fetcher.ts)
- [src/lib/research/market-data-helper-diagnostics.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/market-data-helper-diagnostics.ts)

## Important repo/process notes

### Diagnostics caution

The user explicitly asked to keep:

- [src/lib/research/market-data-helper-diagnostics.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/market-data-helper-diagnostics.ts)

as a **thin adapter**, not a parallel diagnostics framework.

If you extend diagnostics in future batches, prefer reusing:

- [src/lib/research/provider-pressure-diagnostics.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/provider-pressure-diagnostics.ts)

and only add helper wrappers when the shared shape truly cannot support the needed fields cleanly.

### Test ownership caution

The user explicitly asked to watch for **orchestrator test sprawl**. Prefer:

- focused unit tests near helper/stage modules
- broader orchestrator tests only for actual wiring/integration assertions

## Scheduler / email facts already checked

These may matter later if scheduling or notifications come up:

- Scheduler cron is configured for the stored `dailyCheckHour`
- Current DB settings at time of inspection were:
  - `dailyChecksEnabled: true`
  - `emailNotificationsEnabled: true`
  - `dailyCheckHour: 8`
  - 1 active email recipient
- Scheduled runs use the latest saved `PortfolioSnapshot`; they do **not** require a fresh screenshot upload
- Scheduled runs currently attempt email on successful scheduled execution even when alert level is not elevated

Relevant files:

- [src/lib/scheduler.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/scheduler.ts)
- [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)
- [src/lib/services/email-delivery-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/email-delivery-service.ts)
- [scripts/watchtower-scheduler.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/scripts/watchtower-scheduler.ts)

## Critical token/cost diagnosis

### User-reported symptom

The user showed OpenAI usage screenshots where:

- Apr 3 and Apr 4 had meaningful spend
- `Responses and Chat Completions` input tokens totaled about `4,004,493`
- model breakdown showed:
  - `gpt-5.4-2026-03-05`: about `45.705k` input tokens
  - `gpt-5-search-api-2025-10-14`: about `3.959M` input tokens
- one hourly spike in the screenshot showed about `653,896` input tokens, and the user clarified:
  - **each spike is a run**

### What local repo state confirms

The repo’s persisted final analyzer usage is small by comparison:

- latest validated run bundle stored:
  - `inputTokens: 7861`
  - `outputTokens: 8308`
  - total `16169`

Across local Apr 3 bundles in [dev.db](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/dev.db), persisted `gpt-5.4` bundle usage totaled:

- `74,606` input
- `75,194` output
- `149,800` total

That means the overwhelming cost driver is **not** the final Stage 3 `gpt-5.4` call.

### Main conclusion

The cost center is **search**, specifically `gpt-5-search-api`.

The current repo uses `gpt-5-search-api` in these places:

- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)
  - API connectivity check
- [src/lib/research/market-regime.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/market-regime.ts)
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)
  - 2 retrieval calls + 1 parse/extract call
- [src/lib/research/macro-news-environment.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-news-environment.ts)
  - 7 fixed macro query-family calls
- [src/lib/research/news-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/news-fetcher.ts)
  - for 19 tickers, chunks of 4 means about 5 search batches
- [src/lib/research/candidate-screener.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/candidate-screener.ts)
  - at least 1 structural prompt plus some macro-lane prompts

### Why one run can spike so high

One fresh run can easily produce 15 to 20+ search-model requests before retries:

- regime: `1`
- gap analysis: `3`
- macro environment: `7`
- ticker news: about `5`
- candidate screening: `1+`

And several of those stages have retry loops with 65-second backoffs. Local logs confirmed repeated search-stage rate limits and quota hits in:

- [logs/scheduler.log](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/logs/scheduler.log)
- [.next/dev/logs/next-development.log](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/.next/dev/logs/next-development.log)

This strongly explains the screenshot: **each spike is one full run with many search-backed calls**, not one giant final analyzer prompt.

### Important local limitation

The repo does **not** currently persist per-search-call token counts locally.

So a new agent can strongly diagnose the pattern and the likely source, but cannot derive an exact local per-stage token split without adding instrumentation.

## User’s current goal

The current user request is to make searching more efficient while preserving current behavior, with cost goals:

- target: **< $1 per run**
- preferred: **< $0.50 per run**

The user explicitly wants:

- **narrow changes**
- **minimal risk**
- preserve what the system already does

## Best-practice implementation style requested

The user asked to follow the best practices from:

- [Vibe Coding Best Practices: Avoid the Doom Loop with Planning and Code Reviews](https://www.producttalk.org/vibe-coding-best-practices/?ref=product-talk-articles-newsletter)

Key takeaways to apply here:

- use a **plan-review-fix** cycle before coding
- use an **implement-review-fix** cycle after coding
- work in **small iterative batches**
- avoid solving requirement ambiguity in code when it can be resolved in markdown first
- keep implementation scope tight and review for drift, gaps, and over-engineering

## Recommended next step: Search Cost Reduction Batch A

This is the next best implementation batch. It is the safest and highest-leverage one.

### Batch A goal

Reduce search spend by removing search usage where the code does not truly need live retrieval.

### Why Batch A first

- highest savings with lowest risk
- no broader architecture change
- no recommendation-logic change
- no cache redesign
- no prompt-family redesign

### Exact recommended changes

#### 1. Remove or cheapen the search-based connectivity check

Current issue:

- [analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts) uses `gpt-5-search-api` for `checkApiConnectivity(...)`

Safer change:

- replace with a cheap non-search check
- or remove the preflight ping and rely on the first real stage call

#### 2. Keep gap retrieval search-backed, but move gap parsing off search

Current issue:

- [gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)
  - two real retrieval calls use search
  - the final JSON extraction/parse call also uses `gpt-5-search-api`

Safer change:

- keep the two retrieval calls as-is
- move the parse/extract call to a plain non-search model

This should preserve behavior closely because the parse step does not need new web retrieval.

#### 3. Only use search for market regime if live index fetch failed

Current issue:

- [market-regime.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/market-regime.ts)
  already fetches:
  - `^VIX`
  - `^TNX`
  - `DX-Y.NYB`

Safer change:

- when those values are present, use a plain non-search model to classify the regime
- only use search if one or more live values are unavailable

This preserves the current regime output contract while avoiding unnecessary search usage when deterministic live inputs already exist.

### Explicit non-goals for Batch A

Do **not**:

- change candidate scoring
- change Stage 3 behavior
- redesign macro logic
- redesign ticker-news logic
- change search prompts materially
- introduce Lite/Full behavior
- redesign the cache platform

### Expected impact

Batch A should:

- remove at least 2 to 3 search-model uses from a fresh run
- preserve stage behavior closely
- reduce risk with minimal architecture movement

## Recommended later batches after Batch A

Only after Batch A is implemented, reviewed, and verified:

### Batch B

Switch retrieval-only search stages to a cheaper search model, one stage at a time.

Order:

1. macro environment
2. ticker news

Keep prompts, selection logic, freezing, reuse, and fallback behavior unchanged.

### Batch C

Further search call-count control without behavior redesign:

- add intraday regime reuse if justified
- tighten “reuse before fresh search” guarantees
- add in-flight coalescing only if identical local duplicate searches are clearly happening

## Why `< $0.50/run` may be difficult for fully fresh runs

The current run shape still performs many fresh search calls. Even after hardening, a fully fresh run may struggle to land under `< $0.50` unless:

- search call count falls materially
- retrieval-heavy stages move to cheaper search models successfully
- reuse hits on reruns become common

This means:

- `< $1/run` looks realistic with narrow staged work
- `< $0.50/run` is more realistic for reuse-heavy reruns than for every fully fresh run

## Suggested acceptance criteria for Batch A

- same stage contracts and downstream payload shapes
- no recommendation-logic changes
- fewer search-model calls per run
- no new user-visible degradation in gap/regime behavior
- focused tests only

## Files most likely to matter next

Immediate next-batch files:

- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)
- [src/lib/research/market-regime.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/market-regime.ts)

Likely supporting files:

- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)
- [src/lib/research/types.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/types.ts)
- focused tests near the touched stage files

## Verification expectations

For any future code batch:

- run focused tests for touched files
- run `npx tsc --noEmit`
- run `npm run build`

And because of the user preference:

- `git add .`
- commit with a descriptive message
- `git push`

Be careful to avoid accidentally committing:

- [dev.db](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/dev.db)
- [logs/scheduler.log](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/logs/scheduler.log)
- [logs/scheduler-error.log](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/logs/scheduler-error.log)

## If you need quick situational awareness first

Read these in order:

1. [AGENTS.md](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/AGENTS.md)
2. [CURRENT_ANALYSIS_WORKFLOW.md](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/CURRENT_ANALYSIS_WORKFLOW.md)
3. [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)
4. [src/lib/research/news-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/news-fetcher.ts)
5. [src/lib/research/macro-news-environment.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-news-environment.ts)
6. [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)
7. [src/lib/research/market-regime.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/market-regime.ts)

## Final instruction to the next agent

Do not start with a broad repo-wide cost-cutting pass.

Start with a **proposal-only Batch A plan**, or if already approved by the user, implement **only Batch A**:

- cheapen/remove search connectivity ping
- move gap parsing off search
- use non-search regime classification when deterministic live indices are already available

Keep the batch narrow, testable, and low risk.
