# Portfolio Watchtower: Project Context for ChatGPT

Generated from the current codebase on 2026-04-03.

This file is meant to give ChatGPT enough context to help with:
- debugging
- prompt design
- code change planning
- architecture questions
- feature design within the current system

It is intentionally practical and code-oriented.

## 1. What This App Is

Portfolio Watchtower is a Next.js app that:
- lets a user upload a brokerage screenshot
- parses holdings into a structured portfolio snapshot
- runs a multi-stage AI-assisted portfolio analysis pipeline
- persists the run as a **bundle-backed artifact**
- renders a report page from that bundle
- runs scheduled daily checks and sends email notifications

The current architecture is **bundle-first**:
- analysis results are finalized into an `AnalysisBundle`
- the report page prefers the bundle-backed artifact
- diagnostics are read from the bundle-owned persisted diagnostics artifact when available
- fallback read-model synthesis exists only for older bundles / legacy data

## 2. Core Technology Stack

From [package.json](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/package.json):

- `next@16.2.1`
- `react@19.2.4`
- `typescript`
- `prisma` with SQLite
- `openai`
- `nodemailer`
- `node-cron`
- `yahoo-finance2`
- Tailwind-based UI
- Jest for tests

## 3. Top-Level Repo Structure

Top-level folders:

- `src/app`
  - Next.js routes, pages, API routes, server actions
- `src/components`
  - reusable UI components
- `src/lib`
  - main business logic
- `prisma`
  - DB schema
- `scripts`
  - scheduler process entrypoint and operational scripts
- `tests`
  - unit/regression tests
- `logs`
  - scheduler/runtime logs

Most important `src/lib` subfolders:

- `research`
  - analysis pipeline stages
- `services`
  - lifecycle finalization, email delivery, concurrency helpers
- `read-models`
  - report + diagnostics read side
- `contracts`
  - typed persisted/report/diagnostics contracts
- `view-models`
  - UI projection helpers
- `policy`
  - recommendation policy layer
- `cache`
  - runtime/frozen evidence caching helpers

## 4. Key Architectural Idea

There are **two eras** in the app:

1. Legacy report era
- `PortfolioReport`
- `HoldingRecommendation`
- older reads from legacy tables

2. Current bundle-backed era
- `AnalysisRun` is the execution record
- `AnalysisBundle` is the canonical finalized artifact
- `reportViewModelJson`, `emailPayloadJson`, `exportPayloadJson`, diagnostics artifact, etc. live in the bundle

The app now strongly prefers the second model.

## 5. Main User Journey

### Step A: Profile and settings

User config lives primarily in:
- [src/app/settings/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/settings/page.tsx)
- [src/app/settings/SettingsForm.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/settings/SettingsForm.tsx)
- [src/app/settings/NotificationsForm.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/settings/NotificationsForm.tsx)
- [src/app/actions.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/actions.ts)

This collects:
- age / birth year
- retirement timing
- employment/income stability
- emergency fund
- separate retirement assets
- account objective
- risk tolerance
- tax status
- investment style
- time horizon
- permitted asset classes
- leverage/options permissions
- max drawdown tolerance
- target number of holdings
- max single position size
- sectors/themes to emphasize or avoid
- freeform notes
- notification settings and recipients

### Step B: Upload portfolio screenshot

Main files:
- [src/app/upload/UploadClient.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/upload/UploadClient.tsx)
- [src/app/actions.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/actions.ts)

Flow:
- user uploads or pastes an image
- `processUpload(formData)` calls `parsePortfolioScreenshot(...)`
- a `PortfolioSnapshot` is created
- parsed holdings are created under that snapshot
- user is redirected to review/update before analysis

### Step C: Review and confirm holdings

The app supports editing holdings before running analysis.

Important action:
- `updateAndConfirmSnapshot(...)` in [src/app/actions.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/actions.ts)

It:
- deletes old holdings for the snapshot
- recreates reviewed holdings
- enriches daily change %
- marks the snapshot confirmed
- either queues the snapshot or redirects to report generation

### Step D: Run analysis

High-level entry:
- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)

Primary reasoning engine:
- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)

Lifecycle finalization:
- [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)

### Step E: Read and render report

Main files:
- [src/app/report/[id]/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/[id]/page.tsx)
- [src/lib/read-models/bundle-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/bundle-read-service.ts)
- [src/lib/read-models/run-diagnostics-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/run-diagnostics-read-service.ts)

The page:
- resolves the requested id
- prefers the matching bundle-backed artifact
- renders current holdings, recommended final holdings, required changes, reasoning, and diagnostics

## 6. Important Database Models

From [prisma/schema.prisma](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/prisma/schema.prisma):

### User / profile

- `User`
- `UserProfile`
- `NotificationRecipient`
- `UserConviction`
- `ConvictionMessage`

### Portfolio inputs

- `PortfolioSnapshot`
- `Holding`
- `RawExtraction`

### Analysis execution

- `AnalysisRun`
- `EvidencePacket`

### Canonical finalized artifact

- `AnalysisBundle`

### User-facing report artifacts

- `PortfolioReport`
- `HoldingRecommendation`
- `WatchlistIdea`
- `RecommendationChangeLog`
- `NotificationEvent`

## 7. The Analysis Pipeline

The main orchestrator is [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts).

At a high level:

1. validate run preconditions
2. load user + snapshot
3. build research context
4. fetch research inputs in parallel
5. freeze/write evidence packet
6. call primary reasoning engine
7. compare against prior report
8. evaluate alert level
9. finalize into bundle + report records

### Important pipeline stages

#### Stage 0: connectivity / setup

- API connectivity check against OpenAI
- run metadata and progress tracking

#### Stage 1: research collection

Parallel data gathering includes:
- news
- price timelines
- valuation
- correlation matrix

Key files:
- [src/lib/research/news-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/news-fetcher.ts)
- [src/lib/research/price-timeline.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/price-timeline.ts)
- [src/lib/research/valuation-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/valuation-fetcher.ts)
- [src/lib/research/correlation-matrix.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/correlation-matrix.ts)

#### Stage 2: intermediate analysis / signals

- market regime detection
- gap analysis
- candidate screening
- sentiment scoring
- sentiment overlay

Key files:
- [src/lib/research/market-regime.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/market-regime.ts)
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)
- [src/lib/research/candidate-screener.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/candidate-screener.ts)
- [src/lib/research/sentiment-scorer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/sentiment-scorer.ts)
- [src/lib/research/signal-aggregator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/signal-aggregator.ts)

#### Stage 3: primary reasoning

Primary model call:
- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)

This stage:
- builds the final prompt
- injects structured context
- calls GPT with JSON schema
- validates/corrects output
- applies math and policy steps
- attaches metadata

#### Stage 4: finalization

Finalization is handled by:
- [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)

This stage writes:
- `AnalysisBundle`
- bundle-owned recommendation rows
- report view model
- email payload
- export payload
- validation summary
- deterministic metadata
- diagnostics artifact via evidence packet/bundle payload

## 8. Research Context and Prompting

### Research context

The input context is built by:
- [src/lib/research/context-loader.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/context-loader.ts)

It derives:
- age
- total portfolio value
- holdings with computed weights
- constraints such as:
  - max single position %
  - target holding count
  - speculative cap
  - drift tolerance
  - cash target
  - max drawdown tolerance

### Prompt building

`buildAnalysisPrompt(...)` in [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts) injects:
- user profile
- current portfolio
- trusted sources
- news context
- prior recommendations
- conviction dialogue context
- strict schema/math rules

Important prompt behaviors:
- every existing holding must receive a recommendation
- output must be schema-valid JSON
- weights must sum to 100
- share deltas must be mathematically consistent
- conviction tickers must get explicit ongoing dialogue responses

## 9. News Pipeline

Main file:
- [src/lib/research/news-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/news-fetcher.ts)

### Current role of news

News is now a **structured secondary input**, not the sole driver of recommendations.

It contributes to:
- evidence quality
- confidence
- row notes / rationale support
- diagnostics

It does **not** directly control:
- target-weight math
- sizing math
- broad free-form candidate generation from headlines alone

### News statuses

The news pipeline now distinguishes:
- `primary_success`
- `primary_empty`
- `primary_transport_failure`
- `primary_rate_limited`
- `fallback_success`
- `no_usable_news`

### Primary and fallback sources

Primary path:
- OpenAI web-search style query path via chat completions

Fallback path:
- Yahoo Finance headlines

### Structured news signals

Typed in [src/lib/research/types.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/types.ts):
- availability status
- degraded reason
- article count
- trusted source count
- source diversity count
- recent coverage counts
- directional support
- catalyst presence
- risk-event presence
- contradiction level
- news confidence
- per-ticker signal map

### Important recent trustworthiness fixes

The analyzer now accepts the authoritative upstream `newsResult` from the orchestrator.

That matters because previously the analyzer could:
- skip local fetch because orchestrator already fetched news
- but still default to empty local values
- and then incorrectly tell the prompt “no live news”

That bug has been fixed.

## 10. Candidate Generation and Stability

Candidate work happens mainly in:
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)
- [src/lib/research/candidate-screener.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/candidate-screener.ts)

Key recent trust fix:
- candidate validation/order was made deterministic for the same effective inputs
- async completion timing should no longer reorder validated candidates

Important constraint:
- do not make candidate selection depend on unstable raw article order
- if news is used, it should only be a bounded secondary signal after the candidate universe exists

## 11. Recommendation Generation and Post-Processing

Primary file:
- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)

Key phases:

1. fetch or accept prefetched news
2. build prompt
3. call GPT-5.4 with JSON schema
4. parse and validate
5. enforce caps and portfolio math
6. normalize weights if needed
7. apply authoritative current weights
8. apply anti-churn / low-churn policy
9. enforce final action/target consistency
10. enrich recommendations with math again
11. attach metadata

Important helper concepts:

- `applyAntiChurnOverride(...)`
- `applyLowChurnRecommendationPolicy(...)`
- `enforceFinalRecommendationConsistency(...)`
- `applyStructuredNewsOverlay(...)`

Important trust rule:
- final displayed action, targets, deltas, and rationale should not silently contradict each other

## 12. Report Structure

Main file:
- [src/app/report/[id]/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/[id]/page.tsx)

### Bundle-backed report view

When bundle-backed resolution succeeds, the report page renders:

- header / generated date
- Deep Analysis Verification
- Executive Summary
- Strategic Reasoning
- Recommended Final Holdings
- Current Holdings
- Required Changes

### Recommended final holdings

Rendered via:
- [src/components/SortableRecommendationsTable.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/SortableRecommendationsTable.tsx)

Underlying data comes from:
- bundle `reportViewModelJson`

### Current holdings

Rendered via:
- [src/components/SortableHoldingsTable.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/SortableHoldingsTable.tsx)

Underlying data comes from:
- bundle-linked `PortfolioSnapshot`

### Required changes

Derived from normalized recommendation rows:
- [src/app/report/[id]/bundle-report-normalization.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/[id]/bundle-report-normalization.ts)

## 13. Deep Analysis Verification / Diagnostics

The diagnostics surface is typed and backend-driven.

Primary files:
- [src/lib/contracts/diagnostics.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/contracts/diagnostics.ts)
- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)
- [src/lib/read-models/run-diagnostics-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/run-diagnostics-read-service.ts)
- [src/app/report/[id]/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/[id]/page.tsx)

### Diagnostics steps

Current step keys:
- `market_regime`
- `gap_scan`
- `candidate_screening`
- `news_sources`
- `sentiment`
- `gpt5_reasoning`
- `validation_finalization`

### Important current guarantees

- every step has Inputs and Outputs
- bundle-backed diagnostics are authoritative when present
- human-readable inputs/outputs are primary
- hashes/model/version/provenance remain secondary

### Warning behavior

Warnings now include stable typed ids:
- `warningId`

Repeated `news_sources` retry warnings like repeated `primary_rate_limited` are:
- narrowly aggregated
- assigned deterministic `warningId`
- rendered by `warningId` instead of message/code-only keys

## 14. Bundle-Backed Read Model

The report page should not recompute business logic client-side.

Main read-model files:
- [src/lib/read-models/bundle-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/bundle-read-service.ts)
- [src/lib/read-models/run-diagnostics-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/run-diagnostics-read-service.ts)

### Important behavior

`getRequestedReportArtifact(userId, requestedId)`:
- if `requestedId` is a bundle id and belongs to the user:
  - returns bundle-backed artifact
- else if it is a legacy report id with a matching bundle by `analysisRunId`:
  - upgrades to bundle-backed artifact
- else:
  - returns legacy report path

This is why legacy navigation can still resolve to bundle-backed content.

## 15. Daily Check / Scheduler / Email

### Main files

- [scripts/watchtower-scheduler.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/scripts/watchtower-scheduler.ts)
- [src/lib/scheduler.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/scheduler.ts)
- [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)
- [src/lib/services/email-delivery-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/email-delivery-service.ts)
- [src/lib/mailer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/mailer.ts)

### Scheduler behavior

The scheduler:
- runs as a separate PM2-managed process
- loads notification settings from the DB
- binds a cron task to the configured `dailyCheckHour`
- also performs a startup check if today’s scheduled run has not completed yet
- retries once later if a run collides with an already-active run

### Current daily email behavior

Scheduled daily checks now send an email every time, even when stable.

That means:
- scheduled runs no longer require `yellow` or `red` alert level to send
- stable runs can still send “stable” emails

Manual/debug behavior may still be different depending on eligibility rules.

### Email sending

`sendEmailNotification(...)`:
- fetches the authoritative `emailPayload` from the bundle when `analysisBundleId` is supplied
- sends via Nodemailer
- records a `NotificationEvent`
- updates bundle delivery fields

SMTP config comes from env vars:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_FROM`

## 16. Dashboard / Home Page

Main file:
- [src/app/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/page.tsx)

The dashboard shows:
- latest alert status
- portfolio value
- profile completeness
- notifications status
- recent changes
- holdings weight chart
- current holdings
- latest recommendations
- profile fit summary
- recent activity

Important note:
- the dashboard still leans on some legacy/latest-report reads in places
- the report page itself is the most bundle-accurate detailed surface

## 17. Important Contracts

### Diagnostics

- [src/lib/contracts/diagnostics.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/contracts/diagnostics.ts)

### View models

- [src/lib/contracts/view-models.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/contracts/view-models.ts)

Important report row fields:
- `action`
- `actionBadgeVariant`
- `currentShares`
- `targetShares`
- `shareDelta`
- `currentWeight`
- `targetWeight`
- `acceptableRangeLow`
- `acceptableRangeHigh`
- `confidence`
- `positionStatus`
- `evidenceQuality`
- `thesisSummary`
- `detailedReasoning`
- `whyChanged`
- `systemNote`
- `sources`

## 18. Key Components and What They Do

From `src/components`:

- [SortableRecommendationsTable.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/SortableRecommendationsTable.tsx)
  - main recommendation table
- [SortableHoldingsTable.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/SortableHoldingsTable.tsx)
  - holdings display
- [ConvictionThread.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/ConvictionThread.tsx)
  - user/AI conviction dialogue display
- [MissingInfoGate.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/MissingInfoGate.tsx)
  - warns about incomplete profile / notification setup
- [WeightChart.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/WeightChart.tsx)
  - current vs target weight chart

## 19. Parsing / Ingestion

Upload parsing entry:
- [src/app/actions.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/actions.ts)

It delegates to:
- `parsePortfolioScreenshot(...)` in the parser layer

The parser is responsible for:
- ticker/company extraction
- shares
- current price/value
- cash detection

Then the review flow lets the user correct it before analysis.

## 20. Caching / Frozen Evidence Concept

The app distinguishes runtime cache from frozen run evidence.

Important concept:
- fetchers can use runtime cache to avoid repeated expensive work
- once a run reaches the evidence packet stage, the relevant evidence is frozen into run-owned persisted artifacts

Helpful related files:
- `src/lib/cache/*`
- `freezeRunEvidenceSet(...)` in [analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)

Do not broadly redesign caching unless explicitly intended.

## 21. Legacy vs Current System: What to Prefer

When reasoning about changes, prefer:

1. canonical typed bundle-backed artifacts
2. bundle read-models
3. persisted diagnostics artifact
4. fallback read synthesis only when no canonical artifact exists

Avoid:
- client-side recomputation of business logic
- reviving legacy-only report logic just to make UI work
- bypassing lifecycle finalization and writing directly to older report tables

## 22. Current Trustworthiness / Quality Themes

These are active concerns the code has recently been hardened around:

- bundle-backed report resolution must stay authoritative
- diagnostics should be human-readable, not just structural
- candidate selection should be deterministic for same effective inputs
- news must be secondary and structured, not headline-chasing
- final recommendation action/targets/rationale must remain internally consistent
- scheduled email delivery should be reliable and explicit

## 23. Current “Gotchas” ChatGPT Should Know

### 1. Report page is bundle-backed
Do not assume the report page should read only legacy `PortfolioReport`.

### 2. Diagnostics are backend-produced
Do not move diagnostics logic into client rendering.

### 3. News has explicit degraded states
“No live news from primary source” does **not** mean “no news exists.”
It may mean:
- primary returned empty
- primary had connection failure
- primary was rate-limited
- fallback was used
- neither primary nor fallback produced usable news

### 4. Low-churn work exists but may not be the current priority
Check the current user request before changing churn policy.

### 5. Stable ids matter in diagnostics rendering
Warnings now use typed `warningId`; do not regress to content-only keys.

### 6. Preserve no-net-cash accounting semantics
Recommendation changes should not invent/destroy money unless that path is explicitly designed.

## 24. Useful Entry Points by Topic

### “How does a run start?”
- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)
- [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)

### “How is the prompt built?”
- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)

### “How is news fetched and normalized?”
- [src/lib/research/news-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/news-fetcher.ts)

### “How are reports read?”
- [src/lib/read-models/bundle-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/bundle-read-service.ts)

### “How are diagnostics read?”
- [src/lib/read-models/run-diagnostics-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/run-diagnostics-read-service.ts)

### “How is the report UI built?”
- [src/app/report/[id]/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/[id]/page.tsx)

### “How does daily email work?”
- [scripts/watchtower-scheduler.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/scripts/watchtower-scheduler.ts)
- [src/lib/services/email-delivery-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/email-delivery-service.ts)

## 25. Suggested Prompting Guidance for ChatGPT

If you use this project as context in ChatGPT, it will help to ask with constraints like:

- “Stay within the current bundle-backed architecture.”
- “Prefer canonical diagnostics generation first.”
- “Do not redesign caches or the full recommendation engine.”
- “Prefer read-model normalization before UI-only fixes.”
- “Keep changes typed, testable, reversible.”
- “Do not add client-side business-logic recomputation.”

Good prompts usually specify:
- the exact user-visible bug or trust issue
- which part of the pipeline is in scope
- what is explicitly out of scope
- whether you want:
  - approach only
  - code changes
  - tests
  - a root-cause analysis

## 26. Safe-Change Rules for This Repo

When suggesting or making changes, ChatGPT should generally:

- preserve bundle-backed report resolution
- preserve lifecycle-service finalization boundary
- preserve typed contracts
- keep diagnostics authoritative from backend artifacts
- keep news secondary, structured, and deterministic
- avoid UI-only fixes when the real problem is upstream data shape

## 27. If ChatGPT Needs a Short Summary

Short summary:

Portfolio Watchtower is a Next.js + Prisma + OpenAI app that parses uploaded brokerage screenshots into portfolio snapshots, runs a staged research-and-recommendation pipeline, finalizes the results into a canonical `AnalysisBundle`, renders a bundle-backed report page with typed diagnostics, and sends scheduled daily emails. The most important architecture rules are: bundle-backed artifacts are the source of truth, diagnostics should be backend-produced and human-readable, news is a structured secondary input, and changes should stay narrow, typed, testable, and avoid broad redesigns.

