// Shared discriminated-union type for all SSE events emitted during analysis.
// The frontend reads these and renders the live progress UI.

export type ProgressEvent =
  | { type: "stage_start";      stage: string; label: string; detail: string }
  | { type: "stage_complete";   stage: string; durationMs: number }
  | { type: "regime";           riskMode: string; rateTrend: string; dollarTrend: string; vix: string; summary: string }
  | { type: "gap_found";        description: string; severity: "critical" | "opportunity" | "redundancy" | "mismatch"; tickers?: string[] }
  | { type: "candidate_found";  ticker: string; companyName: string; source: "gap_screener" | "momentum"; reason: string; catalyst?: string }
  | { type: "candidate_eliminated"; ticker: string; reason: string }
  | { type: "sentiment_score";  ticker: string; direction: "buy" | "hold" | "sell"; magnitude: number; confidence: number; drivingArticle?: string; finbert?: number; fingpt?: number }
  | { type: "price_reaction";   ticker: string; verdict: string; note: string; preEventDrift?: number; reactionPct?: number; sustained?: boolean }
  | { type: "model_verdict";    model: "gpt5" | "o3mini"; ticker: string; action: string; confidence: string; keyReason: string }
  | { type: "model_divergence"; ticker: string; gpt5Action: string; o3Action: string; sentimentDirection: string; note: string }
  | { type: "aggregated_signal"; ticker: string; finalAction: string; score: number; confidence: number; diverged: boolean; isCandidate: boolean; priceDataMissing?: boolean }
  | { type: "log";              message: string; level?: "info" | "warn" | "error" }
  | { type: "complete";         reportId: string; totalMs: number }
  | { type: "error";            message: string };

