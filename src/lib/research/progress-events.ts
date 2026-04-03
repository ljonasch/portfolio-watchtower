// Shared discriminated-union type for all SSE events emitted during analysis.
// The frontend reads these and renders the live progress UI.
//
// F1 fix: removed "o3mini" from model_verdict.model union.
//         removed model_divergence event (dual-LLM only — no longer meaningful).
//         added adjudicator_note event for gated diagnostic output.

import type { AbstainReason, ValidationError } from "./types";

export type ProgressEvent =
  | { type: "stage_start";      stage: string; label: string; detail: string }
  | { type: "stage_complete";   stage: string; durationMs: number }
  | { type: "regime";           riskMode: string; rateTrend: string; dollarTrend: string; vix: string; summary: string }
  | { type: "gap_found";        description: string; severity: "critical" | "opportunity" | "redundancy" | "mismatch"; tickers?: string[] }
  | { type: "candidate_found";  ticker: string; companyName: string; source: "gap_screener" | "macro_lane" | "momentum"; reason: string; catalyst?: string }
  | { type: "candidate_eliminated"; ticker: string; reason: string }
  | { type: "sentiment_score";  ticker: string; direction: "buy" | "hold" | "sell"; magnitude: number; confidence: number; drivingArticle?: string; finbert?: number; fingpt?: number }
  | { type: "price_reaction";   ticker: string; verdict: string; note: string; preEventDrift?: number; reactionPct?: number; sustained?: boolean }
  | { type: "model_verdict";    model: "gpt5"; ticker: string; action: string; confidence: string; keyReason: string }
  | { type: "adjudicator_note"; tickers: string[]; notes: Record<string, { riskFlags: string[]; confidenceAssessment: string; keyUncertainty: string }> }
  | { type: "log";              message: string; level?: "info" | "warn" | "error" }
  | { type: "abstain";          reason: AbstainReason; stage: string; retryCount: number; validationErrors?: ValidationError[]; runId: string; timestamp: string; message: string }
  | { type: "complete";         reportId: string; totalMs: number }
  | { type: "error";            message: string };
