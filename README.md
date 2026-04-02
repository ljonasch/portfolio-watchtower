# Portfolio Watchtower

A production-grade, deterministic portfolio analysis engine. Runs daily via PM2, analyzes your holdings against live news, market regime, and conviction data, and sends email alerts when action is warranted.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Pipeline: How It Works](#pipeline-how-it-works)
- [Example Run Trace](#example-run-trace)
- [Setup](#setup)
- [AppSettings Reference](#appsettings-reference)
- [Running Locally](#running-locally)
- [Testing](#testing)
- [Deployment (PM2 + Windows)](#deployment-pm2--windows)
- [Error States](#error-states)

---

## Architecture Overview

```
User Holdings (Snapshot)
        │
        ▼
 [EvidencePacket Builder]     ← freezes inputs before LLM
        │  promptHash, perSectionChars
        ▼
 [GPT-4.1 Call]               ← single model, 1 retry on JSON parse failure
        │  finish_reason guard, validation_enforce_block
        ▼
 [Recommendation Validator]   ← deterministic corrections: weights, actions, deltas
        │  anti-churn override (AppSettings threshold)
        ▼
 [AnalysisRun + PortfolioReport]  ← persisted to SQLite via Prisma
        │  qualityMeta, tokenTelemetry, promptHash
        ▼
 [Email Alert]                ← idempotent send (per runId + recipient)
```

**All pipeline failures are absorbed** — the system always writes a run record. If the LLM fails, the run is marked `abstained` with a structured `abstainReason`.

---

## Pipeline: How It Works

### Stage 1 — Snapshot & Pricing
- Load the latest `PortfolioSnapshot` for the user
- Fetch live prices via Yahoo Finance (10s timeout → fall back to DB values)
- Persist corrected prices to DB so the UI stays synced

### Stage 2 — Evidence Collection
- Fetch market regime (VIX, 10Y yield, DXY, sector leadership)
- Fetch 30-day news + 24h breaking news for each ticker
- Score sentiment via FinBERT (or fallback keyword summary)
- Run o3-mini cross-check for conviction signal verification
- Build `EvidencePacket` — frozen, hashed snapshot of all inputs

### Stage 3 — LLM Analysis
- Assemble full prompt: regime + news + sentiment + valuation + correlation + candidates
- Dynamic token budget: `min(holdingCount × 400 + 800, 6000)` tokens
- Single call to `gpt-4.1`, 1 retry on JSON parse failure only
- `finish_reason === "length"` → immediate abort (no corrupt persist)

### Stage 4 — Validation & Corrections
- Validate every recommendation: missing fields, enum ranges, weight sum
- Deterministically override: shareDelta math, action repair, weight normalization
- Anti-churn gate: `|Δweight| < antichurn_threshold_pct` on Trim/Buy → override to Hold
- If `validation_enforce_block = true`: hard errors → AbstainResult

### Stage 5 — Persist
- Update staging `AnalysisRun` (created before LLM call) with final status
- Persist `PortfolioReport` + `HoldingRecommendation[]` + `RecommendationChangeLog[]`
- Update `EvidencePacket.outcome` = `"used"` or `"abstained"`
- Write `qualityMeta` JSON: promptHash, usingFallbackNews, validationWarningCount, token counts

### Stage 6 — Alert & Email
- Determine alert level: `none` | `low` | `yellow` | `red`
- Email sent only when `alertLevel ∈ {yellow, red}`
- Idempotency guard: skip if `NotificationEvent` already exists for this `runId + recipient + type`

---

## Example Run Trace

Below is a real trace of a `manual` trigger run for a 8-holding portfolio. All values are illustrative.

```
[scheduler] Cleaned up 0 zombie run(s).
[scheduler-ai] >>> Starting Stage: Market Intelligence - Fetching live prices
[scheduler-ai] >>> Starting Stage: News Research - Fetching 30-day + 24h breaking news
[scheduler-ai] News fetched: 8 tickers, 42 articles, 3 breaking (24h)
[scheduler-ai] >>> Starting Stage: Sentiment Scoring - FinBERT local inference
[scheduler-ai] Sentiment scored: NVDA 0.82 (high), AAPL 0.05 (neutral), MSFT 0.65 (high)
[scheduler-ai] >>> Starting Stage: Market Regime - VIX/10Y/DXY snapshot
[scheduler-ai] Regime: risk-on | VIX=16.2 | 10Y=4.35% | DXY=103.8 | aggression=1.15
[scheduler-ai] >>> Starting Stage: EvidencePacket - Freezing inputs
[scheduler-ai] EvidencePacket written: id=ep_abc123, promptHash=a1b2c3d4e5f6a1b2, totalInputChars=18450
[scheduler-ai]   perSectionChars: regime=420, breaking24h=1800, news30d=8000, ...
[scheduler-ai] >>> Starting Stage: GPT-4.1 Analysis - Primary LLM call
[scheduler-ai] GPT-4.1 responded: 8 recommendations, finish_reason=stop
[scheduler-ai] Token usage: input=4821, output=1243, model=gpt-4.1
[scheduler-ai] Validation: 0 hard errors, 3 warnings (weight corrections applied)
[scheduler-ai] Anti-churn: AAPL Trim override → Hold (|Δweight|=0.8% < 1.5% threshold)
[scheduler-ai] >>> Starting Stage: Persist - Writing run record
[scheduler-ai] AnalysisRun updated: status=complete, alertLevel=yellow
[scheduler-ai] PortfolioReport created: id=rpt_xyz789
[scheduler-ai] EvidencePacket outcome updated: used
[scheduler] Email sent to lucasjonasch98@gmail.com for run run_def456
```

**Result:** Run ID `run_def456`, Report ID `rpt_xyz789`, alert `yellow`.

### What the email contains
- Alert level badge (yellow = "Review Recommended")
- Top 3 recommendations with dollar delta and rationale
- Market context summary
- Direct link: `http://localhost:3000/report/rpt_xyz789`

### What an AbstainResult looks like

```
[scheduler-ai] GPT-4.1 responded: finish_reason=length (TRUNCATED)
[scheduler-ai] AbstainResult: CONTEXT_TOO_LONG — 14 holdings exceeded token budget (6400 tokens)
[scheduler-ai] AnalysisRun updated: status=abstained, qualityMeta.abstainReason=CONTEXT_TOO_LONG
[scheduler-ai] EvidencePacket outcome updated: abstained
[scheduler] No email sent (analysis abstained)
```

---

## Setup

### Prerequisites
- Node.js 18+
- PM2 (`npm install -g pm2`)
- SMTP credentials for email alerts

### Environment Variables (`.env`)

```env
DATABASE_URL="file:./prisma/dev.db"
OPENAI_API_KEY="sk-..."
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Email (optional — if not set, alerts are stored in-app only)
SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_USER="you@gmail.com"
SMTP_PASS="your-app-password"
SMTP_FROM="Portfolio Watchtower <you@gmail.com>"

# News & Sentiment (optional)
HUGGINGFACE_API_KEY="hf_..."
```

### First-time database setup

```bash
npx prisma migrate dev --name init
npx prisma db seed
npx prisma generate
```

---

## AppSettings Reference

All settings are stored in the `AppSettings` table and can be changed without a code deploy.

| Key | Default | Description |
|---|---|---|
| `validation_enforce_block` | `"false"` | When `"true"`: hard validation errors abort the run (AbstainResult). When `"false"`: log-only, best-effort correction continues. |
| `antichurn_threshold_pct` | `"1.5"` | Trim/Buy actions with `\|Δweight\|` below this % are overridden to Hold. Set to `"0"` to disable. |
| `cache_enabled` | `"false"` | Enable in-process price cache (reduces Yahoo Finance calls). |
| `email_auto_send` | `"true"` | Master switch for outbound email alerts. |
| `portfolio_config` | `"{}"` | Reserved for portfolio-level configuration overrides. |
| `notification_settings` | `{...}` | Email schedule, alert threshold, daily check hour. |

### Update a setting (SQLite)
```sql
UPDATE AppSettings SET value='true', updatedAt=datetime('now')
WHERE key='validation_enforce_block';
```

---

## Running Locally

```bash
# Development server
npm run dev

# Manual analysis trigger (runs full pipeline once)
curl -X POST http://localhost:3000/api/cron/daily-check

# Or use the dashboard button: "Run Analysis Now"
```

---

## Testing

```bash
# Run all unit tests
npx jest tests/unit/ --no-coverage

# Run with coverage
npx jest tests/unit/

# Run a specific suite
npx jest tests/unit/batch9-final.test.ts --no-coverage --verbose
```

**Current count: 192 / 192 passing** across 9 test suites.

| Suite | Tests | Covers |
|---|---|---|
| `retry.test.ts` | Pre-existing | `withRetry` utility |
| `view-model-projections.test.ts` | T20–T26 | ViewModel projection layer |
| `batch5-pipeline.test.ts` | T27–T33 | EvidencePacket, pipeline discipline |
| `batch6-validation.test.ts` | T08, T13, T14, T45–T47 | Validation hardening |
| `batch7-notifications.test.ts` | T40–T44 | Email idempotency, notification VMs |
| `batch8-harness.test.ts` | T55–T57, T63–T65, T68–T69 | Golden packet runner, AppSettings |
| `batch9-final.test.ts` | T04, T37–T39, T47, T59 | Action repair, conviction markers, AbstainReason |

---

## Deployment (PM2 + Windows)

```bash
# Start the Next.js app under PM2
pm2 start npm --name portfolio-watchtower -- run start

# Start the daily cron worker
pm2 start npm --name portfolio-cron -- run cron

# Save PM2 config (persists across reboots)
pm2 save
pm2 startup

# View logs
pm2 logs portfolio-watchtower
pm2 logs portfolio-cron
```

---

## Error States

| State | UI Display | Email Sent? | DB Record |
|---|---|---|---|
| `complete` | Report page loads normally | Yes (if yellow/red) | `status=complete` |
| `abstained` | Red banner with reason | No | `status=abstained`, `qualityMeta.abstainReason` |
| `failed` | Error in run history | No | `status=failed`, `errorMessage` |
| `running` | Loading spinner | No | `status=running` (auto-failed after 15 min) |

### AbstainReason values

| Reason | Cause |
|---|---|
| `CONTEXT_TOO_LONG` | Portfolio too large for token budget (`finish_reason=length`) |
| `LLM_FAILURE` | GPT-4.1 threw a non-length error after retries |
| `VALIDATION_HARD_ERROR` | Report failed hard validation and `enforce_block=true` |
| `finish_reason_length` | Legacy alias for `CONTEXT_TOO_LONG` |
| `empty_response_after_retry` | Model returned no content after 2 attempts |
| `schema_validation_failed_after_retry` | JSON never parsed into valid schema |
| `weight_sum_zero` | All recommendation weights summed to 0 |
| `evidence_packet_persist_failed` | DB write for EvidencePacket failed before LLM call |
| `circuit_breaker_open` | Analysis service temporarily unavailable |
