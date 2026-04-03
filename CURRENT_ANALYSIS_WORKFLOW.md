# Portfolio Watchtower: Current Analysis Workflow

This document describes the **current** end-to-end analysis workflow in Portfolio Watchtower as implemented in the codebase on April 3, 2026.

It is intended to be an exportable architecture and behavior reference for future prompting, onboarding, debugging, and implementation planning. It prioritizes correctness over brevity.

## 1. High-level system shape

Portfolio Watchtower is a **bundle-backed portfolio analysis system**. Its current architecture can be thought of as four major layers:

1. **Input and trigger layer**
   - Portfolio snapshots are uploaded and persisted.
   - Analyses are triggered manually or by the daily scheduler.
   - The main manual streaming entrypoint is [src/app/api/analyze/stream/route.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/api/analyze/stream/route.ts).
   - The main scheduled entrypoint is `runDailyCheck(...)` in [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts).

2. **Research and intermediate-signal layer**
   - Orchestrated in [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts).
   - This layer collects and derives market regime, structural gaps, macro environment, environmental gaps, candidate lanes, candidates, news, sentiment, valuation, correlation, and related diagnostics.

3. **Analyzer / recommendation layer**
   - Implemented in [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts).
   - This layer builds the structured prompt, calls the primary LLM, validates and repairs output, applies deterministic portfolio rules, and returns a finalized recommendation object.

4. **Terminal persistence and read-model layer**
   - Finalization is handled by `finalizeAnalysisRun(...)` in [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts).
   - Current report rendering, history, exports, email delivery, and archive behavior are bundle-first and read through bundle-backed services in [src/lib/read-models/bundle-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/bundle-read-service.ts).

The key current architectural rule is:

- **`AnalysisBundle` is the canonical persisted artifact for current reports**
- `PortfolioReport` still exists for compatibility and legacy read paths
- the UI increasingly resolves bundle-first, then falls back to legacy only when necessary

## 2. Core persisted artifacts

The current analysis system persists multiple related records, but the most important ones are:

### `PortfolioSnapshot`
- Represents an uploaded holdings snapshot.
- Contains holdings.
- Manual analysis generation uses the latest non-archived snapshot from [src/app/report/generate/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/generate/page.tsx).

### `AnalysisRun`
- Represents an execution attempt.
- Tracks status, stage, alert level, failure state, and quality metadata.
- Used by scheduler, recent activity, and run-level lifecycle management.

### `AnalysisBundle`
- The canonical terminal artifact for the modern pipeline.
- Stores:
  - evidence packet JSON
  - report view model JSON
  - export payload JSON
  - email payload JSON
  - validation and determinism snapshots
  - delivery state
  - supersession state
  - archive state via `archivedAt`
- Current archive source of truth is `AnalysisBundle.archivedAt`.

### `PortfolioReport`
- Legacy persisted report artifact.
- Still created for compatibility when a validated run is finalized.
- Some older pages and relations still reference it.
- Bundle-backed views suppress duplicate legacy rows when both bundle and legacy representations exist for the same logical artifact.

### `HoldingRecommendation`
- Legacy row-per-recommendation persistence created alongside `PortfolioReport`.

### `EvidencePacket`
- A frozen pre-LLM input packet.
- Stores core prompt-context ingredients and section hashes/char counts.
- Now also stores frozen macro evidence inside `candidatesJson.macroEvidence`.

## 3. Primary user-facing entrypoints

### Manual analysis flow

The manual analysis experience starts from:
- [src/app/report/generate/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/generate/page.tsx)

That page:
- loads the latest non-archived `PortfolioSnapshot`
- renders `AutoRunner`
- frames the run as:
  - market regime detection
  - gap analysis
  - candidate screening
  - primary AI reasoning
  - deterministic validation

The streaming API used for the actual run is:
- [src/app/api/analyze/stream/route.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/api/analyze/stream/route.ts)

That route:
- accepts `{ snapshotId, customPrompt }`
- opens an SSE stream
- calls `runStreamAnalysis(...)`
- forwards progress events from the orchestrator back to the client

### Scheduled daily analysis flow

The daily scheduler path is implemented in:
- [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)

`runDailyCheck(...)`:
- loads the user and latest snapshot
- clears zombie runs older than 15 minutes
- tries to refresh live prices before the run
- calls `runStreamAnalysis(...)`
- decides whether to send daily email notifications
- renders and sends emails for active recipients

Important current rule:
- scheduled runs currently always email when they run
- manual/debug runs email only for elevated alert levels

## 4. The exact staged analysis pipeline

The main orchestration happens in:
- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)

The current workflow can be described as:

### Stage 0: Run setup and guardrails

Before heavy analysis:
- OpenAI connectivity is checked by `checkApiConnectivity(...)`
- prompt/context length is guarded by `guardContextLength(...)`
- the run is assigned ids and timing metadata
- the latest snapshot, user profile, settings, prior reports, and conviction context are loaded

This stage is about making sure the run either:
- has enough context to proceed safely
- or fails/abstains in a controlled way

### Stage 1: Build deterministic research context

Implemented in:
- [src/lib/research/context-loader.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/context-loader.ts)

`buildResearchContext(...)` converts raw profile + holdings into a deterministic `ResearchContext`.

This includes:
- `today`
- computed user age from `birthYear`
- a frozen profile JSON snapshot
- derived constraints:
  - max single position
  - target holding count
  - speculative cap
  - drift tolerance
  - cash target
  - max drawdown tolerance
- holdings with:
  - computed values
  - computed weights
  - cash flags
- total portfolio value
- prior recommendations
- custom prompt override

This stage is important because it standardizes portfolio math and profile constraints **before** any later LLM call.

### Stage 2: Market regime detection

The orchestrator calls:
- `detectMarketRegime(...)`

The market regime result is one of the core intermediate signals that later affects:
- prompt context
- macro relevance interpretation
- diagnostics
- final reasoning

The regime result is frozen before downstream use so the same run stays internally consistent.

### Stage 3: Structural gap analysis

Implemented in:
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)

The structural gap pass currently runs first and remains **more authoritative** than environmental gaps.

`runStructuralGapAnalysis(...)`:
- summarizes current holdings and weights
- asks search-backed questions about:
  - sector leadership
  - institutional rotation
  - active themes
  - analyst upgrade cycles
  - correlated exposure risks
  - missing opportunities
  - redundant bets
- parses those results into a typed `GapReport`

Current structural gap outputs include:
- `gaps`
- `structuralGaps`
- `searchBrief`
- `profilePreferences`

Structural gap types:
- `critical`
- `opportunity`
- `redundancy`
- `mismatch`

This stage is still partially LLM-assisted, unlike the deterministic phase-1 macro path.

### Stage 4: Macro-news environment collection

Implemented in:
- [src/lib/research/macro-news-environment.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-news-environment.ts)

This phase-1 macro workflow is intentionally bounded and portfolio-neutral at collection time.

It uses a fixed query-family registry:
- `rates_inflation_central_banks`
- `recession_labor_growth`
- `energy_commodities`
- `geopolitics_shipping_supply_chain`
- `regulation_export_controls_ai_policy`
- `credit_liquidity_banking_stress`
- `defense_fiscal_industrial_policy`

Important current constraints:
- raw collection is global, not portfolio-personalized
- freshness windows are fixed
- collection is normalized, deduped, and stable-sorted before interpretation

The normalized article type is:
- `MacroNewsArticle`

The run-level collection result is:
- `MacroNewsEnvironmentResult`

Key normalization fields include:
- `articleId`
- `canonicalUrl`
- `title`
- `publisher`
- `publishedAt`
- `publishedAtBucket`
- `trusted`
- `queryFamily`
- `retrievalReason`
- `topicHints`
- `dedupKey`
- `stableSortKey`
- `evidenceHash`

Stable sort rule:
1. trusted first
2. newest first
3. canonical URL ascending

### Stage 5: Deterministic macro-theme consensus

Implemented in:
- [src/lib/research/macro-theme-consensus.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-theme-consensus.ts)

This stage is deterministic and non-LLM.

The fixed phase-1 theme registry is:
- `higher_for_longer_rates`
- `growth_slowdown_risk`
- `energy_supply_tightness`
- `shipping_disruption`
- `ai_policy_export_controls`
- `credit_liquidity_stress`
- `defense_fiscal_upcycle`

There is no dynamic theme creation in phase 1.

The current actionable-theme gate is controlled by named constants in that module:
- `minSupportingArticles = 3`
- `minTrustedSupportingArticles = 2`
- `minDistinctPublishers = 2`
- `minSupportRatio = 0.7`
- `minRecentSupportingArticles7d = 2`

A theme is actionable only if all those thresholds are met and contradiction is not high.

Each article is deterministically classified into:
- theme family
- support / counter / ignore

This means:
- raw article order does not drive decisions
- open-ended interpretation is not used here
- weak/noisy macro themes are recorded as observed or mixed, but do not open candidate lanes

### Stage 6: Deterministic macro exposure bridge

Implemented in:
- [src/lib/research/macro-exposure-bridge.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-exposure-bridge.ts)

This bridge exists so the system can make bounded indirect inferences like:
- shipping corridor disruption -> logistics / supply-chain exposure relevance
- policy action -> regulatory burden or policy-beneficiary exposure relevance
- technology platform shift -> compute / infrastructure relevance
- disaster / weather event -> insurance / grid / recovery sensitivity

Important safeguards:
- fixed registry only
- no dynamic rule creation
- no ticker emission
- direct predefined second-order links only
- no speculative multi-hop chains

Bridge rule families now cover:
- shipping / logistics
- energy supply
- defense procurement
- export controls / compute
- rates / duration
- credit / liquidity
- policy / regulation
- technology / platform shifts
- environment / weather / disaster
- labor / workforce / demographic shocks
- election / regime / political-transition effects

The bridge produces:
- exposure tags
- environmental-gap hints
- lane hints
- sector tags
- sensitivity tags
- provenance via rule ids

This output is typed as:
- `MacroExposureBridgeResult`
- containing `MacroExposureBridgeHit[]`

### Stage 7: Environmental gap derivation

Implemented in:
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)

`deriveEnvironmentalGaps(...)` consumes:
- holdings
- structural gap report
- profile
- market regime
- macro consensus
- macro bridge output

It also infers some current holding exposure tags from known ticker families, for example:
- energy
- defense
- AI infrastructure
- logistics
- liquidity defense
- broad equity beta

Environmental gaps are separate from structural gaps and carry less authority.

Environmental gaps may:
- raise review pressure on current holdings
- raise candidate review priority
- open bounded candidate discovery lanes

Environmental gaps may not:
- directly create tickers
- override durable portfolio construction rules
- alter target-weight math directly

Each `EnvironmentalGap` includes:
- `gapId`
- `themeId`
- `themeKey`
- `bridgeRuleIds`
- `description`
- `urgency`
- `exposureTags`
- `candidateSearchTags`
- `reviewCurrentHoldings`
- `reviewCandidates`
- `openCandidateDiscovery`
- `regimeAlignment`
- `profileAlignment`
- `rationaleSummary`

### Stage 8: Macro candidate-lane derivation

Implemented in:
- [src/lib/research/macro-candidate-lanes.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-candidate-lanes.ts)

This stage converts environmental gaps into a small fixed lane registry. There is no dynamic lane creation in phase 1.

The current lane registry is:
- `rate_resilience`
- `defense_fiscal_beneficiaries`
- `energy_supply_chain`
- `shipping_resilience`
- `ai_infrastructure_policy`
- `liquidity_defense`

Each lane carries:
- `laneId`
- `laneKey`
- `description`
- `allowedAssetClasses`
- `searchTags`
- `priority`
- `sortBehavior`
- `origin`
- `themeIds`
- `environmentalGapIds`
- `bridgeRuleIds`
- `rationaleSummary`

This is where macro can say:
- “search here”

But it still cannot say:
- “recommend this ticker directly”

### Stage 9: Candidate screening

Implemented in:
- [src/lib/research/candidate-screener.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/candidate-screener.ts)

Candidate screening combines:
- the structural search brief
- bounded macro lanes

It does **not** use raw macro article text in ranking or decision logic.

The screener:
- excludes currently held names
- expands aliases so equivalent tickers do not sneak in
- generates bounded prompt-based candidate suggestions
- validates them through live-price checks
- preserves deterministic ordering

Important candidate provenance:
- `source`
- `candidateOrigin`
- `discoveryLaneId`
- `macroThemeIds`
- `environmentalGapIds`

Current candidate origins:
- `structural`
- `macro_lane`

Important invariant:
- macro-origin candidates are **not privileged**
- they go through the same validation path as structural candidates

Deterministic ordering currently uses:
1. source priority
2. lane id
3. ticker
4. company name
5. reason

### Stage 10: Company/news collection and news signals

Implemented mainly in:
- [src/lib/research/news-fetcher.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/news-fetcher.ts)

This stage fetches company/news coverage for analyzed tickers and now produces:
- structured degraded-state instrumentation
- structured typed news signals

Current availability states include:
- `primary_success`
- `primary_empty`
- `primary_transport_failure`
- `primary_rate_limited`
- `fallback_success`
- `no_usable_news`

Important rule:
- news is a **structured secondary input**
- it can affect:
  - evidence quality
  - confidence
  - rationale
  - diagnostics
- it must not directly control:
  - target-weight math
  - sizing math

### Stage 11: Price timelines, valuation, correlation, sentiment

Other Stage 2 research modules include:
- price timelines via `fetchPriceTimelines(...)`
- valuation via `fetchValuationForAll(...)`
- correlation via `buildCorrelationMatrix(...)`
- sentiment via `scoreSentimentForAll(...)`

These outputs become part of the additional Stage 3 prompt context and diagnostics.

There is also a sentiment overlay built by:
- `buildSentimentOverlay(...)`

Candidates can be filtered or scrutinized further based on these intermediate signals before final reasoning.

### Stage 12: Freeze evidence before/around the primary model call

Implemented in:
- [src/lib/research/evidence-packet-builder.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/evidence-packet-builder.ts)
- [src/lib/research/macro-evidence-freeze.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-evidence-freeze.ts)

There are now two related freezing concepts:

#### A. General evidence packet freezing
Before the main LLM call, the orchestrator writes an `EvidencePacket` containing:
- run ids
- prompt hash
- char counts
- truncated news text
- sentiment signals
- article titles
- regime
- candidate text
- valuation text
- correlation text
- macro evidence packet

This packet helps explain what exact context fed the primary recommendation call.

#### B. Frozen macro evidence
Because macro themes can affect candidate lanes, the macro branch now freezes a per-run packet:
- normalized macro environment
- actionable theme ids
- bridge hit ids
- bridge payload
- environmental gap ids
- candidate lane ids

This is used so retries / re-renders / downstream reads can replay the same macro results.

Important current limitation:
- this improves same-run reproducibility
- it does not redesign global caching across separate live-input runs

### Stage 13: Stage 3 analyzer prompt and primary recommendation call

Implemented in:
- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)

This file is the primary LLM reasoning layer.

Key behavior:
- builds a structured research context
- accepts orchestrator-provided `additionalContext`
- accepts a prefetched `NewsResult`
- avoids duplicate news fetches when orchestrator already did the work
- builds a large structured prompt with:
  - user profile
  - binding constraints
  - current portfolio
  - verified news section
  - trusted sources
  - prior recommendations
  - conviction threads
  - five-phase reasoning instructions
- calls the primary model with structured JSON-schema output

Current primary model call:
- `gpt-5.4`

Structured schema requires:
- report summary and reasoning
- evidence quality summary
- market context by horizon
- per-holding recommendations
- watchlist ideas

The analyzer should receive only **normalized macro summaries**, not raw macro articles. The macro interpretation has already been done upstream.

That prevents Stage 3 from becoming a second uncontrolled macro interpreter.

### Stage 14: Recommendation validation and deterministic correction

After the structured output returns, the analyzer applies deterministic post-processing:

- `validatePortfolioReport(...)`
- `enforceSpeculativeCap(...)`
- `enforcePositionCap(...)`
- `enrichRecommendationsWithMath(...)`
- `normalizeWeights(...)`
- authoritative current-weight correction from actual holdings
- `applyAntiChurnOverride(...)`
- `applyLowChurnRecommendationPolicy(...)`
- `enforceFinalRecommendationConsistency(...)`
- `applyStructuredNewsOverlay(...)`

This stage is crucial. The system does not trust the model output raw.

Important consequences:
- model output can be corrected
- weights can be normalized
- below-threshold churn can be collapsed back to Hold
- residual mismatches can be repaired
- degraded news can lower confidence/evidence quality

### Stage 15: Alert evaluation and change detection

Back in the orchestrator, the finalized recommendation set is compared against prior recommendations using:
- `compareRecommendations(...)`

Then:
- `evaluateAlert(...)`

This produces the run’s alert level and alert reason.

### Stage 16: Diagnostics artifact construction

The orchestrator builds a typed diagnostics artifact with step-by-step transparency.

Current diagnostics cover areas like:
- gap scan
- candidate screening
- macro news collection
- macro theme consensus
- macro exposure bridge
- environmental gaps
- macro candidate lanes
- news sources
- sentiment
- validation and model telemetry

The diagnostics system now includes:
- stable `warningId` values
- narrow aggregation of repeated retry warnings like `primary_rate_limited`
- provenance for macro bridge rule hits and lane generation

### Stage 17: Terminal finalization into bundle/report artifacts

Finalization is handled by:
- `finalizeAnalysisRun(...)` in [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)

This does the following:
- supersedes older active bundles in the same scope
- creates a new `AnalysisBundle`
- writes persisted bundle-aware JSON payloads
- creates a legacy `PortfolioReport` for validated runs
- creates legacy `HoldingRecommendation` rows
- updates the `AnalysisRun`
- stores `qualityMeta`
- stores change logs

If the run fails before terminal bundle creation:
- `AnalysisRun` is updated as failed
- no validated bundle/report is created

## 5. How current reports are read and rendered

The canonical read-model service is:
- [src/lib/read-models/bundle-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/bundle-read-service.ts)

### Direct report by id

`getRequestedReportArtifact(userId, requestedId)`:
- tries `AnalysisBundle` by bundle id first
- if not found, tries `PortfolioReport`
- if the legacy report has `analysisRunId`, it tries to resolve the matching bundle by `sourceRunId`
- returns:
  - bundle-backed artifact if possible
  - legacy-only artifact otherwise

Important current rule:
- archived bundle-backed reports still resolve by id
- direct `/report/[id]` access continues to work even when archived

### Current bundle report

`getCurrentBundleReport(userId)`:
- selects the current bundle using bundle-selection logic
- returns bundle-backed report view model if possible
- falls back to latest legacy report otherwise

### History

`getHistoryBundles(userId)`:
- loads all bundles for the user
- excludes archived bundles from the visible history list
- still uses **all** bundle artifact keys, including archived ones, to suppress matching legacy duplicates

That means:
- archived bundle-backed reports disappear from `/history`
- their matching legacy copies do not pop back into view as duplicates

### Latest visible report surface

`getLatestVisibleReportSurface(userId)`:
- returns the newest non-archived bundle-backed report surface
- falls back to a true legacy-only report only when there is no visible bundle equivalent

This helper now powers:
- homepage latest-report surfaces in [src/app/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/page.tsx)
- layout/nav latest-report links in [src/app/layout.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/layout.tsx)

## 6. Report page behavior

The report page is:
- [src/app/report/[id]/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/[id]/page.tsx)

It is bundle-first.

When bundle-backed:
- it loads typed diagnostics
- it loads the backing snapshot
- it normalizes bundle recommendation rows
- it renders:
  - summary
  - reasoning
  - deep analysis verification
  - recommended final holdings
  - current holdings
  - required changes
  - archive/unarchive controls

When legacy-only:
- it renders the older branch with legacy verification and legacy report shape

Current archive UI behavior:
- archive source of truth is `AnalysisBundle.archivedAt`
- report page shows Archive at the bottom for active bundle-backed reports
- once archived, it shows Unarchive
- direct report rendering still works

## 7. Archive behavior

Current archive behavior is intentionally narrow and bundle-first.

### Source of truth
- `AnalysisBundle.archivedAt`

### Supported operations
- archive bundle-backed report
- unarchive bundle-backed report

### What archive currently affects
- hidden from `/history`
- hidden from homepage latest-report surfaces
- hidden from layout/nav latest-report links
- shown on `/archive` in an “Archived Reports” section

### What archive currently does not change
- direct report access
- notifications
- exports
- scheduler behavior
- recent activity rows on the homepage

The archive page is:
- [src/app/archive/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/archive/page.tsx)

It now shows both:
- bundle-backed archived reports
- older snapshot archive batches

## 8. Homepage and nav read behavior

The dashboard page is:
- [src/app/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/page.tsx)

It uses:
- `getLatestVisibleReportSurface(...)`
- latest snapshot
- latest run
- recent runs
- convictions

This drives:
- What Changed Since Last Run
- Latest Recommendations
- profile-fit reasoning

The layout uses:
- [src/app/layout.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/layout.tsx)

It also uses:
- `getLatestVisibleReportSurface(...)`

That powers the nav’s latest report link.

One intentionally deferred exception:
- Recent Activity rows still use `run.reports?.[0]` and may link to archived reports

## 9. Email delivery workflow

Email sending lives in:
- [src/lib/services/email-delivery-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/email-delivery-service.ts)

If sending by `analysisBundleId`:
- the service loads bundle email payload and delivery eligibility from the read model
- sends email through the mailer
- writes a `notificationEvent`
- updates delivery metadata on `AnalysisBundle`

Archive state currently does not alter email eligibility or notification history.

## 10. Determinism and trust guardrails

A major current system priority is determinism and trustworthiness.

Important current guardrails include:

### Deterministic inputs
- research context is built from explicit profile/holdings data
- macro collection uses fixed query families
- macro interpretation is deterministic and rule-based
- macro bridge is fixed-registry only
- candidate lanes are fixed-registry only

### Deterministic ordering
- macro articles are deduped and stable-sorted
- candidate outputs are deterministically sorted
- warning rows have stable `warningId`

### Bounded use of news
- company news is a structured secondary input
- macro news can open candidate-search lanes
- neither can directly control target weights or sizing math

### Bundle-backed canonical rendering
- reports, history, archive, and latest surfaces are increasingly resolved bundle-first

### Frozen evidence
- evidence packet captures prompt ingredients
- macro evidence packet freezes macro inputs/ids for same-run replayability

## 11. Important current limitations

The current workflow is materially stronger and more transparent than earlier versions, but several limitations remain by design:

- structural gap analysis is still LLM-assisted rather than fully deterministic
- live external inputs can still vary between separate runs
- macro evidence freezing is local to the macro branch and run artifact, not a full cache redesign
- archive behavior is narrow and not a full content-status system
- recent activity can still surface archived report links
- legacy artifacts still exist for compatibility, even though bundle-backed reads are preferred

## 12. Key files to understand the current system

If someone wants to understand the current workflow quickly, the most important files are:

- [src/lib/research/analysis-orchestrator.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/analysis-orchestrator.ts)
- [src/lib/analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/analyzer.ts)
- [src/lib/services/analysis-lifecycle-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/services/analysis-lifecycle-service.ts)
- [src/lib/read-models/bundle-read-service.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/read-models/bundle-read-service.ts)
- [src/lib/research/types.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/types.ts)
- [src/lib/research/context-loader.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/context-loader.ts)
- [src/lib/research/gap-analyzer.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/gap-analyzer.ts)
- [src/lib/research/candidate-screener.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/candidate-screener.ts)
- [src/lib/research/macro-news-environment.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-news-environment.ts)
- [src/lib/research/macro-theme-consensus.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-theme-consensus.ts)
- [src/lib/research/macro-exposure-bridge.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-exposure-bridge.ts)
- [src/lib/research/macro-candidate-lanes.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-candidate-lanes.ts)
- [src/lib/research/macro-evidence-freeze.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/macro-evidence-freeze.ts)
- [src/lib/research/evidence-packet-builder.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/lib/research/evidence-packet-builder.ts)
- [src/app/api/analyze/stream/route.ts](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/api/analyze/stream/route.ts)
- [src/app/report/[id]/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/report/[id]/page.tsx)
- [src/app/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/page.tsx)
- [src/app/layout.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/layout.tsx)
- [src/app/archive/page.tsx](C:/Users/Lucas Jonasch/Documents/portfolio-watchtower/src/app/archive/page.tsx)

## 13. Short plain-English summary

The current workflow is:

1. get the latest uploaded portfolio snapshot
2. build deterministic portfolio/profile context
3. detect the market regime
4. analyze structural portfolio gaps
5. collect and normalize macro news
6. convert macro news into deterministic actionable themes
7. bridge those themes into exposure tags and bounded candidate lanes
8. screen candidate securities through the normal validation path
9. collect ticker-level news and market research overlays
10. call the primary analyzer model with normalized context
11. deterministically validate, repair, and constrain the result
12. persist a canonical `AnalysisBundle`
13. render reports, history, latest surfaces, diagnostics, and archive views from bundle-aware read models

The design intent is:
- keep the analysis rich
- keep the final artifacts inspectable
- make degraded inputs visible
- keep candidate discovery bounded
- avoid letting headlines directly drive portfolio math
