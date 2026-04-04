# Portfolio Watchtower: Comprehensive ChatGPT Codebase Guide

This document is a detailed handoff for ChatGPT or any external assistant that needs to help with prompt-writing, architecture discussions, feature planning, debugging, or implementation guidance for the current Portfolio Watchtower codebase.

It is intended to be:
- accurate to the current codebase
- comprehensive enough to support serious prompt engineering
- grounded in the current implemented architecture rather than aspirational design

If you use this file as context for ChatGPT, treat it as the primary overview of how the system currently works.

## 1. Product Purpose

Portfolio Watchtower is a portfolio-analysis and recommendation system that:
- ingests a user's portfolio snapshot and holdings
- runs a staged research and analysis pipeline
- generates portfolio recommendations and supporting reasoning
- persists those results into a canonical bundle-backed report artifact
- exposes report, history, archive, diagnostics, and related read surfaces in the app

The product is designed to answer questions like:
- what changed in the portfolio since the last run?
- which current holdings need attention?
- what recommendations should be made now?
- what macro environment matters to current holdings and possible candidates?
- what changed relative to the previous report?

This is not a generic stock screener. It is a portfolio-aware recommendation and monitoring system with deterministic post-processing and strong emphasis on explainability and reproducibility.

## 2. Current High-Level Product Goals

The current system is optimized around these principles:
- preserve portfolio-fit discipline
- avoid unstable recommendation churn
- keep deterministic intermediate structures where possible
- use news as a secondary structured input, not a direct sizing controller
- preserve a canonical bundle-backed read architecture
- keep diagnostics inspectable
- maintain compatibility with some legacy report paths while preferring bundles

In practical terms, this means:
- recommendations should not jump around just because article ordering changed
- macro/news signals can affect evidence quality, scrutiny, candidate discovery direction, and rationale support
- macro/news must not directly determine target-weight math or sizing math
- the final recommendation set still passes through validation and consistency enforcement

## 3. Core Architectural Pattern

The system is now fundamentally **bundle-backed**.

The most important architectural entities are:
- `AnalysisRun`: an execution/run record
- `AnalysisBundle`: the canonical finalized analysis artifact
- `PortfolioReport`: legacy-compatible report record still used in some surfaces and compatibility paths
- `EvidencePacket`: persisted structured evidence bundle associated with an analysis run/bundle

The canonical read direction is:
- generate or finalize an analysis run
- persist a canonical bundle
- read reports/history/export/email payloads from bundle-backed read models when possible

Legacy compatibility still exists, but the intended source of truth for current report behavior is bundle-first.

## 4. Tech Stack

From `package.json`, the current stack includes:
- Next.js `16.2.1`
- React `19.2.4`
- TypeScript
- Prisma `7.6.0`
- SQLite in current local/dev configuration
- OpenAI SDK `6.33.0`
- `node-cron`
- `nodemailer`
- `yahoo-finance2`
- `recharts`
- Tailwind CSS
- Jest

Important note:
- There is an explicit repo instruction warning that this Next.js version has breaking changes relative to older assumptions, and relevant official docs under `node_modules/next/dist/docs/` should be checked before major framework edits.

## 5. Repository Structure

At a practical level, the most important folders are:

- `prisma/`
  - database schema and migrations
- `src/app/`
  - Next.js app routes, pages, server actions, and API routes
- `src/components/`
  - reusable UI components
- `src/lib/`
  - business logic, research pipeline, read models, services, diagnostics, prompt logic, and utilities
- `tests/unit/`
  - unit and behavior-focused tests
- root markdown docs
  - architecture and workflow handoff docs

## 6. Database / Persistence Model

The data model is defined in [prisma/schema.prisma](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/prisma/schema.prisma).

### 6.1 User / Settings / Profile

Important user-facing persistent models:
- `User`
- `UserProfile`
- `AppSettings`
- `NotificationRecipient`
- `NotificationEvent`

These store:
- user identity
- portfolio preferences and profile context
- app/runtime settings
- notification routing/history

### 6.2 Portfolio Snapshot Layer

Portfolio ingestion and snapshot persistence uses:
- `PortfolioSnapshot`
- `Holding`
- `RawExtraction`

These models capture:
- uploaded or generated snapshot records
- holdings within a snapshot
- raw extracted upload content and parsing details

### 6.3 Analysis Layer

The main analysis execution layer uses:
- `AnalysisRun`
- `AnalysisBundle`
- `EvidencePacket`

These are the current backbone of the analysis system.

`AnalysisRun` stores run execution context and status.

`AnalysisBundle` stores canonical finalized artifacts such as:
- bundle-backed report view model
- diagnostics references
- export-facing data
- run linkage
- archival state

Important current field:
- `AnalysisBundle.archivedAt`
  - this is the phase-1 source of truth for report archival
  - archived reports remain readable by direct id
  - archived bundles are hidden from `/history`
  - archived bundles are also hidden from obvious latest-report surfaces

`EvidencePacket` stores structured evidence and run inputs/outputs used for reproducibility and downstream rendering/supporting payloads.

### 6.4 Legacy Report Compatibility

Legacy models still present:
- `PortfolioReport`
- `HoldingRecommendation`
- `RecommendationChangeLog`

These still matter because:
- some surfaces and compat paths still reference them
- direct report-resolution can still start from a legacy report id
- some migration/backfill logic persists legacy-compatible rows

But conceptually:
- `PortfolioReport` is not the preferred architectural center anymore
- `AnalysisBundle` is

### 6.5 Other Domain Models

Also important:
- `WatchlistIdea`
- `UserConviction`
- `ConvictionMessage`

These support watchlist and conviction-thread features used in analysis context and UI.

## 7. Canonical Read Model Strategy

The most important read-model file is:
- [src/lib/read-models/bundle-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/bundle-read-service.ts)

Key exported functions:
- `getCurrentBundleRecord`
- `isCurrentBundleId`
- `getRequestedReportArtifact`
- `getCurrentBundleReport`
- `getLatestVisibleReportSurface`
- `getHistoryBundles`
- `getExportPayload`
- `getBundleEmailPayload`

These functions centralize canonical report reads.

### 7.1 Report Read by Id

`getRequestedReportArtifact(...)` handles:
- direct bundle id lookup
- legacy report lookup
- legacy-id-to-bundle upgrade/resolution when possible

This is why direct `/report/[id]` reads still work for archived reports:
- by-id reads do not hide archived bundles
- archival affects visibility in list/latest surfaces, not direct access

### 7.2 History Reads

`getHistoryBundles(...)` powers `/history`.

Important behavior:
- archived bundles are excluded
- bundle-backed rows are canonical
- duplicate suppression accounts for bundle-backed artifacts so legacy duplicates do not reappear

### 7.3 Latest Report Surfaces

`getLatestVisibleReportSurface(...)` is the bundle-aware latest-visible read helper used to keep archived bundles out of homepage/latest-report surfaces.

## 8. Main App Route Structure

The UI is built under `src/app/`.

Important pages and routes:

### 8.1 Core Pages

- `/`
  - dashboard/home page
  - implemented in [src/app/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/page.tsx)
- `/history`
  - reports history page
- `/archive`
  - archive page
- `/report/[id]`
  - canonical report page
- `/report/generate`
  - report generation flow
- `/review/[id]`
  - review flow
- `/settings`
  - settings and notifications config
- `/upload`
  - portfolio upload/import flow
- `/how-it-works`
  - explanatory page

### 8.2 API Routes

Important API routes include:
- `api/analyze/route.ts`
- `api/analyze/stream/route.ts`
- `api/archive/route.ts`
- `api/cron/daily-check/route.ts`
- `api/export/[type]/route.ts`
- `api/notifications/send/route.ts`
- `api/run/manual/route.ts`
- convictions routes
- settings/notification routes
- some data-maintenance routes such as clear-holdings

These are a mix of:
- analysis triggers
- scheduled execution entry points
- exports
- notifications
- maintenance/data actions

## 9. Current UI Structure

### 9.1 Dashboard

The dashboard in [src/app/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/page.tsx) is one of the most important user-facing surfaces.

It currently includes major sections such as:
- `What Changed Since Last Run`
- `Current Holdings`
- `Latest Recommendations`
- `Recent Activity`

This page is not just decorative. It is a read surface over the current latest-visible bundle/report state.

Important current latest-report behavior:
- archived bundle-backed reports are hidden from the obvious latest-report surfaces
- direct archived report reads still work

### 9.2 Report Page

The report page in [src/app/report/[id]/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/[id]/page.tsx) is bundle-backed and authoritative.

Important current behavior:
- reads through bundle-first resolution
- archived reports still render directly by URL
- page includes archive/unarchive actions
- page includes `Estimated Analysis Cost (heuristic)`

The report page is where a user sees:
- the generated recommendation output
- supporting context
- bundle-backed report content
- archive state/actions

### 9.3 History Page

The history page is list-oriented and excludes archived reports by default.

It is a read-model surface, not a client-only filter.

### 9.4 Archive Page

The archive page currently combines:
- archived bundle-backed reports
- archived portfolio snapshots

It shows:
- `Archived Reports`
- `Portfolio Archives`

This is important because report archiving and snapshot archiving are distinct concepts, but both appear in the archive UX.

### 9.5 Upload / Settings / Review

Other important user flows:
- upload/import portfolio data
- adjust settings and notification recipients
- review runs/reports
- manage conviction threads and related context

## 10. Important UI Components

Key components under `src/components/`:

- [GlobalWorkflowNav.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/GlobalWorkflowNav.tsx)
  - global nav/workflow progress links
- [WorkflowSteps.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/WorkflowSteps.tsx)
  - workflow-step visualization
- [SortableHoldingsTable.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/SortableHoldingsTable.tsx)
  - holdings display
- [SortableRecommendationsTable.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/SortableRecommendationsTable.tsx)
  - recommendation display and sorting
- [WeightChart.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/WeightChart.tsx)
  - portfolio/recommendation visualization
- [ConvictionPanel.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/ConvictionPanel.tsx)
- [ConvictionThread.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/ConvictionThread.tsx)
- [DebugPanel.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/DebugPanel.tsx)
- [MissingInfoGate.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/MissingInfoGate.tsx)
- [ReviewForm.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/components/ReviewForm.tsx)

These are important when writing UI prompts because:
- the app is not a single-page visual shell
- it has multiple tightly scoped read-model-backed surfaces
- components tend to expose specific business concepts rather than generic widgets

## 11. Backend / Service Structure

The backend logic is mostly under `src/lib/`.

Main clusters:
- `src/lib/research/`
  - analysis orchestration and intermediate research pipeline
- `src/lib/read-models/`
  - canonical query/read services
- `src/lib/services/`
  - lifecycle services and run-level application services
- other top-level library files
  - analyzer, estimators, contracts, diagnostics, utilities

## 12. Current Analysis Lifecycle

The lifecycle service is in:
- [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)

Key exported functions:
- `finalizeAnalysisRun`
- `persistBackfilledLegacyBundle`
- `runStreamAnalysis`
- `runDailyCheck`

These functions sit above the raw research pipeline and manage:
- run lifecycle
- persistence/finalization
- streaming behavior
- daily check scheduling behavior

## 13. Core Research / Analysis Pipeline

The central orchestrator is:
- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)

This is the heart of the analysis system.

### 13.1 Pipeline Intent

The pipeline collects and synthesizes:
- portfolio context
- market regime
- structural gaps
- macro environment
- candidate ideas
- ticker news
- sentiment/valuation/correlation/price overlays
- analyzer-ready structured context

Then it passes everything through:
- the main Stage 3 analyzer
- deterministic post-processing
- recommendation validation
- finalization into bundle/report/diagnostics

### 13.2 Stage Model

The current workflow conceptually follows:

1. context loading
2. market regime
3. structural gaps
4. macro environment collection
5. macro normalization/dedup/sort
6. macro theme consensus
7. macro exposure bridge
8. environmental gaps
9. macro candidate-search lanes
10. candidate screening
11. news/enrichment overlays
12. Stage 3 analyzer
13. deterministic correction / validation / finalization

## 14. Research Context Loading

Research context is loaded via:
- [src/lib/research/context-loader.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/context-loader.ts)

This stage gathers:
- portfolio state
- holdings
- user profile/constraints
- prior run/report context where needed
- supporting structured inputs for later stages

It is foundational because all downstream portfolio-aware logic depends on the typed context it produces.

## 15. Market Regime

Market regime logic lives in:
- [src/lib/research/market-regime.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/market-regime.ts)

This stage produces a typed regime summary that downstream stages use for:
- gap analysis
- candidate reasoning
- analyzer context
- risk framing

The regime summary is considered a core required Stage 3 section.

## 16. Structural Gap Analysis

Gap analysis lives in:
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)

Current role:
- find structural portfolio gaps
- derive gap-driven review pressure
- support candidate-search directions

Important current nuance:
- structural gaps remain more authoritative than environmental gaps
- the system deliberately separates durable structural portfolio issues from macro/news-driven environmental gaps

## 17. Macro Environment Workflow

Portfolio Watchtower now has a bounded macro-news environment flow.

Main files:
- [macro-news-environment.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-news-environment.ts)
- [macro-theme-consensus.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-theme-consensus.ts)
- [macro-exposure-bridge.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-exposure-bridge.ts)
- [macro-candidate-lanes.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-candidate-lanes.ts)
- [macro-evidence-freeze.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-evidence-freeze.ts)

### 17.1 Macro Design Principles

Macro/news in this system:
- is structured secondary input
- can influence evidence quality, review pressure, candidate prioritization, and bounded candidate discovery
- does not directly set target weights or sizing
- does not directly convert headlines into final ticker recommendations

### 17.2 Macro Collection

Macro collection is:
- fixed-family
- portfolio-neutral at search time
- deterministic in normalization/dedup/stable sort

Required fixed query families currently include:
- rates / inflation / central banks
- recession / labor / growth slowdown
- energy / commodities
- geopolitics / war / shipping / supply chain
- regulation / export controls / AI policy
- credit stress / liquidity / banking stress
- defense / fiscal / industrial policy

### 17.3 Macro Theme Consensus

Consensus is deterministic and non-LLM for this phase.

The fixed phase-1 theme family registry is:
- `higher_for_longer_rates`
- `growth_slowdown_risk`
- `energy_supply_tightness`
- `shipping_disruption`
- `ai_policy_export_controls`
- `credit_liquidity_stress`
- `defense_fiscal_upcycle`

Actionability requires deterministic multi-source agreement thresholds rather than vague model impression.

### 17.4 Macro Exposure Bridge

The bridge converts actionable macro themes into:
- exposure tags
- environmental-gap hints
- candidate-lane hints

It is:
- explicit
- typed
- deterministic
- bounded
- non-LLM

It supports indirect inference only through predefined mappings.

The bridge was expanded beyond initial shipping/energy/defense/export-controls/rates/credit coverage to include limited additional families such as:
- policy / regulation
- technology / platform shifts
- environment / weather / disaster
- labor / workforce / demographic shocks
- election / regime / political-transition policy effects

But it remains bounded and does not emit ticker picks.

### 17.5 Environmental Gaps

Environmental gaps are distinct from structural gaps.

They can:
- raise review pressure on current holdings
- affect candidate prioritization
- open bounded candidate-search lanes

They cannot:
- override durable portfolio construction rules on their own
- directly create recommendations

### 17.6 Candidate Lanes

Macro candidate lanes are fixed and deterministic.

The phase-1 lane registry includes:
- `rate_resilience`
- `defense_fiscal_beneficiaries`
- `energy_supply_chain`
- `shipping_resilience`
- `ai_infrastructure_policy`
- `liquidity_defense`

No dynamic lane creation is allowed in this phase.

### 17.7 Macro Evidence Freeze

Macro evidence is now frozen per run.

This preserves:
- normalized macro article ids
- dedup keys
- stable sort order
- actionable theme ids
- bridge hits
- environmental gap ids
- candidate lane ids

This matters because macro now affects candidate-facing decisions and should be reproducible for the same frozen evidence packet.

## 18. Candidate Screening

Candidate screening lives in:
- [src/lib/research/candidate-screener.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/candidate-screener.ts)

Current behavior:
- accepts structural search directions and macro candidate-search lanes
- uses search-backed generation
- validates surfaced candidates through existing checks
- preserves deterministic sorting/dedup behavior

Important constraints:
- macro-origin candidates are not privileged
- raw article text is not used in ranking/screening
- every candidate still must pass the same validation path

Current practical issue:
- this stage can be rate-limit heavy
- repeated retries can add multi-minute delays before price validation
- this is one of the current best targets for narrow optimization

## 19. Ticker News, Sentiment, and Other Overlays

Important supporting modules:
- [news-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/news-fetcher.ts)
- [sentiment-scorer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/sentiment-scorer.ts)
- [valuation-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/valuation-fetcher.ts)
- [price-timeline.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/price-timeline.ts)
- [correlation-matrix.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/correlation-matrix.ts)
- [signal-aggregator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/signal-aggregator.ts)

These stages provide additional evidence and overlays that enrich:
- holding review
- candidate review
- analyzer context

They matter a lot for final quality, but they are not the primary architectural center of the system.

## 20. Stage 3 Analyzer

The primary analyzer is:
- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)

This is the main reasoning/model stage that turns structured context into the portfolio recommendation output.

### 20.1 Current Model

The primary Stage 3 model is:
- `gpt-5.4`

This is the most expensive model stage in the pipeline.

### 20.2 Analyzer Role

The analyzer receives:
- holdings
- constraints
- current portfolio state
- previous recommendations context
- news and research summaries
- candidate context
- macro/regime context

And returns a structured report-like recommendation payload.

### 20.3 Stage 3 Context Budgeting

Because the analyzer prompt grew large enough to cause `CONTEXT_TOO_LONG` / `finish_reason_length` failures, the system now has two narrow safeguards.

#### Layer 1: Additional Context Budget

Implemented in:
- [src/lib/research/stage3-context-budget.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/stage3-context-budget.ts)

This budgets the orchestrator-built `additionalContext` in explicit sections such as:
- regime
- macro environment
- breaking news
- valuation
- correlation
- candidates

Current budget constants include:
- `STAGE3_CONTEXT_BUDGET.maxTotalChars = 16000`

Current preserved sections:
- `regime`
- `candidates`

Candidate handling is special-cased so compaction does not silently collapse to an empty/useless block when candidates exist.

#### Layer 2: Full Final Prompt Preflight

Implemented in:
- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)

This is the more important corrective guard.

Current constant:
- `STAGE3_FULL_PROMPT_BUDGET.maxTotalChars = 32000`

The analyzer now:
- builds the actual final prompt that will go to the model
- measures that full prompt before calling the model
- verifies required section markers are present
- throws a typed preflight error if the full prompt is still too large

The distinct typed preflight failure is:
- `Stage3PreflightBudgetExceededError`

And the run-level typed reason path now distinguishes:
- `STAGE3_PREFLIGHT_BUDGET_EXCEEDED`
from later post-call truncation paths like:
- `finish_reason_length`

### 20.4 Required Sections Protected in Stage 3

The current corrective budget logic explicitly protects or verifies the presence of:
- full holdings
- binding constraints
- prior recommendations
- final candidate list
- structured news status
- core regime summary

This was added because the first budget pass was insufficiently strict from a production reliability perspective.

### 20.5 Output Guidance

The analyzer prompt was not broadly redesigned, but its verbosity guidance was tightened to reduce output-length pressure.

This is intentionally narrow:
- same model
- same schema
- same downstream validation path
- same overall reasoning contract

## 21. Deterministic Post-Processing and Validation

Downstream of the analyzer, the system preserves a deterministic safety and consistency stack.

Important supporting modules include:
- [portfolio-constructor.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/portfolio-constructor.ts)
- [recommendation-validator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/recommendation-validator.ts)

These stages help enforce:
- portfolio consistency
- recommendation validity
- anti-churn / low-churn behavior already present in the product
- final report coherence

Important product rule:
- news and macro inputs do not directly control target-weight math or sizing math

## 22. Diagnostics Architecture

Diagnostics are an important part of the system.

The architecture intentionally preserves backend-authored diagnostics rather than pushing business logic into the client.

Important areas include:
- contracts under `src/lib/contracts/`
- read logic under `src/lib/read-models/`
- run diagnostics surfaces
- progress event reporting via [progress-events.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/progress-events.ts)

Diagnostics currently cover areas such as:
- macro-news collection
- macro-theme consensus
- macro exposure bridge
- environmental gaps
- macro candidate-search lanes
- candidate screening outcomes by provenance
- Stage 3 prompt preflight details

For Stage 3 specifically, diagnostics now need to be interpreted as:
- preflight budget failure before model call
- or model-call truncation after invocation

That distinction now exists explicitly.

## 23. Evidence Packet and Reproducibility

Evidence packet writing happens via:
- [src/lib/research/evidence-packet-builder.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/evidence-packet-builder.ts)

This supports:
- bundle finalization
- export payloads
- reproducibility of run evidence
- macro evidence freezing

The system does not currently do a broad cache redesign, but it does freeze critical macro evidence locally per run because macro influences candidate-facing decisions.

## 24. Finalization and Bundle Persistence

Finalization is handled through the lifecycle service and related persistence paths.

Key ideas:
- analysis executes through `AnalysisRun`
- finalized canonical artifact becomes `AnalysisBundle`
- compatibility/backfill behavior may also persist legacy-compatible report rows

This architecture is why report pages, history, archive, and exports prefer bundle-backed reads.

## 25. Archive Behavior

Current report archive behavior is intentionally narrow.

Source of truth:
- `AnalysisBundle.archivedAt`

Phase-1 behavior:
- archive/unarchive is bundle-first
- archived reports disappear from `/history`
- archived reports also disappear from obvious latest-report surfaces
- direct `/report/[id]` access still works
- underlying report/bundle is not deleted

The archive page also shows archived bundle-backed reports separately from archived snapshots.

## 26. Scheduler / Daily Check Behavior

There is scheduled execution behavior via:
- [src/app/api/cron/daily-check/route.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/api/cron/daily-check/route.ts)
- lifecycle service methods such as `runDailyCheck`

Important current fact:
- scheduled runs currently still send email when they run
- the system has not yet fully shifted to a lite-vs-full scheduled optimization mode

This matters when prompting about future optimization work:
- avoid assuming daily checks are already cheap or lite-gated unless specifically implemented

## 27. Current Cost / Runtime Hotspots

The most expensive stages in practice are currently:

1. Stage 3 analyzer (`gpt-5.4`)
2. candidate screening
3. structural gap analysis
4. ticker news fetch
5. macro environment collection
6. sentiment/valuation/correlation/price overlays combined

Recent practical pain point:
- candidate screening can hit repeated upstream rate limits
- backoff/retry behavior can add multi-minute latency without total run failure

This is a good example of where the system is functioning correctly but still operationally expensive.

## 28. Current Analysis Cost Estimate

The report page now shows:
- `Estimated Analysis Cost (heuristic)`

Important interpretation:
- this is explicitly heuristic
- it is not billing-grade
- it does not affect recommendation logic

The estimate logic lives separately in:
- [src/lib/report-cost-estimator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/report-cost-estimator.ts)

## 29. Current Prompting Guidance for ChatGPT

If ChatGPT is helping with this repo, it should reason with the following constraints in mind.

### 29.1 Architecture Constraints to Respect

Do not casually assume:
- client-side hiding instead of canonical read-model filtering
- a redesign away from bundle-backed architecture
- news directly controlling target weights
- direct ticker creation from headlines
- broad cache redesigns
- schema rewrites as first resort

Prefer:
- narrow typed additions
- reuse of existing read models
- deterministic intermediate structures
- bundle-first persistence
- diagnostics-preserving changes

### 29.2 Analysis-System Constraints

When proposing prompt or pipeline changes:
- preserve deterministic post-processing
- preserve recommendation validation
- preserve analyzer output contract unless explicitly asked to change it
- preserve macro as structured secondary input
- preserve same-input determinism where the code already guarantees it

### 29.3 UI Constraints

When proposing UI work:
- prefer minimal server-backed changes
- avoid introducing client-side business logic recomputation
- keep bundle/read-model behavior authoritative
- preserve archive/history/report consistency

### 29.4 What Good Prompt Help Looks Like

Useful ChatGPT help for this repo includes:
- prompt-budget reduction plans
- typed architecture proposals
- bundle/read-model-safe UI feature designs
- narrow determinism-preserving optimization plans
- test plans for staged analysis features
- diagnostics and provenance design

Less useful or risky help includes:
- broad “rewrite everything” advice
- replacing model reasoning with unsupported heuristics
- ignoring the bundle-backed canonical read path
- introducing unstable headline-driven behavior

## 30. How to Explain the System Succinctly

If ChatGPT needs a short mental model:

Portfolio Watchtower is a **bundle-backed portfolio analysis system** that:
- loads a portfolio snapshot and user context
- runs staged research and analysis
- incorporates bounded deterministic macro/news workflows
- screens and validates candidates
- calls a primary Stage 3 analyzer (`gpt-5.4`)
- applies deterministic validation/consistency controls
- finalizes a canonical `AnalysisBundle`
- serves report/history/archive/export surfaces through bundle-first read models

## 31. Most Important Files to Read First

If an assistant needs to go deeper, these are the highest-value files:

### Product / Architecture
- [CHATGPT_PROJECT_CONTEXT.md](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/CHATGPT_PROJECT_CONTEXT.md)
- [CURRENT_ANALYSIS_WORKFLOW.md](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/CURRENT_ANALYSIS_WORKFLOW.md)
- [prisma/schema.prisma](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/prisma/schema.prisma)

### Core Orchestration
- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)
- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)
- [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)

### Macro Workflow
- [src/lib/research/macro-news-environment.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-news-environment.ts)
- [src/lib/research/macro-theme-consensus.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-theme-consensus.ts)
- [src/lib/research/macro-exposure-bridge.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-exposure-bridge.ts)
- [src/lib/research/macro-candidate-lanes.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-candidate-lanes.ts)
- [src/lib/research/macro-evidence-freeze.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-evidence-freeze.ts)

### Read Models / Report Surfaces
- [src/lib/read-models/bundle-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/bundle-read-service.ts)
- [src/app/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/page.tsx)
- [src/app/report/[id]/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/[id]/page.tsx)
- [src/app/history/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/history/page.tsx)
- [src/app/archive/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/archive/page.tsx)

### Candidate / Gap / News
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)
- [src/lib/research/candidate-screener.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/candidate-screener.ts)
- [src/lib/research/news-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/news-fetcher.ts)

## 32. Current Limitations and Known Cautions

Important current limitations:
- candidate screening can still be provider-rate-limit heavy
- Stage 3 preflight uses character budgeting, which is deterministic but not tokenizer-exact
- some legacy compatibility paths still exist and must be treated carefully
- scheduled runs are not yet fully optimized into lite/full reuse patterns
- the cost estimate is heuristic, not actual billing

Important caution when prompting ChatGPT:
- ask for narrow, reversible changes
- tell it to preserve bundle-backed read behavior
- tell it whether a change must remain deterministic
- tell it whether macro/news is allowed to influence only evidence/review/lane generation rather than weights

## 33. Best Prompting Template for ChatGPT

When asking ChatGPT for help on this codebase, a good prompt shape is:

1. state the feature or problem
2. state the architectural constraints
3. name the specific files/modules likely involved
4. say whether you want approach only or implementation
5. say whether determinism/reproducibility must be preserved
6. say what is out of scope

Example framing:

“Portfolio Watchtower is a bundle-backed portfolio analysis app with canonical `AnalysisBundle` read behavior, deterministic macro evidence structures, and a large Stage 3 analyzer. I want a narrow change to X. Preserve bundle-backed read models, final validation, and diagnostics. Do not redesign the pipeline. Relevant files are Y and Z. First give approach only.”

## 34. Final Takeaway

The key to understanding this codebase is:

- it is not just a prompt-to-report app
- it is a staged analysis system with persistent artifacts, read models, deterministic intermediate structures, and carefully bounded uses of macro/news
- the safest changes usually preserve:
  - bundle-first canonical reads
  - typed intermediate data
  - deterministic post-processing
  - narrow, local persistence changes
  - diagnostics clarity

If ChatGPT keeps those principles in view, it can be very helpful on this repo without drifting into unsafe or architecture-breaking advice.
