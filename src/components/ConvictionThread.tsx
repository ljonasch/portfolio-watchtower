"use client";

import { useState, useRef, useEffect } from "react";
import {
  Send, Bot, User, Loader2, Trash2, ChevronDown, ChevronUp,
  MessageSquare, Zap, AlertTriangle, CheckCircle2, Clock,
} from "lucide-react";

export type ConvictionMsg = {
  id: string;
  role: "user" | "ai";
  content: string;
  createdAt: string;
  analysisRunId?: string | null;
};

export type ConvictionThreadData = {
  id: string;
  ticker: string;
  rationale: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ConvictionMsg[];
};

type Props = {
  conviction: ConvictionThreadData;
  onRetire?: (ticker: string) => void;
  onMessageSent?: (ticker: string, messages: ConvictionMsg[]) => void;
};

// ─── Date formatter ───────────────────────────────────────────────────────────
function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return iso.split("T")[0];
  }
}

function fmtTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// ─── Parse and render AI message with highlighted sections ───────────────────
function AIMessageContent({ content }: { content: string }) {
  // Split on section markers
  const sections: Array<{ type: "normal" | "acknowledgment" | "counterpoint" | "agreement"; text: string }> = [];

  let remaining = content.trim();

  // Normalize section markers
  const normalized = remaining
    .replace(/\bACKNOWLEDGMENT:/gi, "\n__ACKNOWLEDGMENT__\n")
    .replace(/\bCOUNTERPOINT:/gi, "\n__COUNTERPOINT__\n")
    .replace(/\bAGREEMENT:/gi, "\n__AGREEMENT__\n")
    .replace(/\bSHORT-TERM/gi, "\n**Short-Term**")
    .replace(/\bMID-TERM/gi, "\n**Mid-Term**")
    .replace(/\bLONG-TERM/gi, "\n**Long-Term**");

  const parts = normalized.split(/\n(__ACKNOWLEDGMENT__|__COUNTERPOINT__|__AGREEMENT__)\n/);

  let currentType: "normal" | "acknowledgment" | "counterpoint" | "agreement" = "normal";
  let buffer = "";

  for (const part of parts) {
    if (part === "__ACKNOWLEDGMENT__") {
      if (buffer.trim()) sections.push({ type: currentType, text: buffer.trim() });
      buffer = "";
      currentType = "acknowledgment";
    } else if (part === "__COUNTERPOINT__") {
      if (buffer.trim()) sections.push({ type: currentType, text: buffer.trim() });
      buffer = "";
      currentType = "counterpoint";
    } else if (part === "__AGREEMENT__") {
      if (buffer.trim()) sections.push({ type: currentType, text: buffer.trim() });
      buffer = "";
      currentType = "agreement";
    } else {
      buffer += part;
    }
  }
  if (buffer.trim()) sections.push({ type: currentType, text: buffer.trim() });

  return (
    <div className="space-y-2">
      {sections.map((sec, i) => {
        if (sec.type === "counterpoint") {
          return (
            <div key={i} className="bg-red-950/40 border-l-4 border-red-500 rounded-r-lg px-3 py-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-red-400">
                  AI Counterpoint
                </span>
              </div>
              <p className="text-sm text-red-100/90 leading-relaxed whitespace-pre-wrap">
                {sec.text}
              </p>
            </div>
          );
        }
        if (sec.type === "acknowledgment") {
          return (
            <div key={i} className="bg-emerald-950/30 border-l-4 border-emerald-500/60 rounded-r-lg px-3 py-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">
                  Acknowledged
                </span>
              </div>
              <p className="text-sm text-emerald-100/90 leading-relaxed whitespace-pre-wrap">
                {sec.text}
              </p>
            </div>
          );
        }
        if (sec.type === "agreement") {
          return (
            <div key={i} className="bg-emerald-950/30 border-l-4 border-emerald-500/60 rounded-r-lg px-3 py-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-emerald-400">
                  Agreement
                </span>
              </div>
              <p className="text-sm text-emerald-100/90 leading-relaxed whitespace-pre-wrap">
                {sec.text}
              </p>
            </div>
          );
        }
        // Normal text: render **bold** inline
        const rendered = sec.text.split(/(\*\*[^*]+\*\*)/g).map((chunk, ci) =>
          chunk.startsWith("**") && chunk.endsWith("**")
            ? <strong key={ci} className="font-semibold text-slate-100">{chunk.slice(2, -2)}</strong>
            : <span key={ci}>{chunk}</span>
        );
        return (
          <p key={i} className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
            {rendered}
          </p>
        );
      })}
    </div>
  );
}

// ─── Main thread component ────────────────────────────────────────────────────
export function ConvictionThread({ conviction, onRetire, onMessageSent }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ConvictionMsg[]>(conviction.messages);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Group messages into exchanges (pairs for display)
  const lastMsg = messages[messages.length - 1];
  const awaitingAI = lastMsg?.role === "user" || messages.length === 0;

  useEffect(() => {
    if (expanded) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [messages, expanded]);

  const handleSend = async () => {
    const content = replyText.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/convictions/${conviction.ticker}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) throw new Error(await res.text());
      const newMsg: ConvictionMsg = {
        id: Date.now().toString(),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
        analysisRunId: null,
      };
      const updated = [...messages, newMsg];
      setMessages(updated);
      setReplyText("");
      onMessageSent?.(conviction.ticker, updated);
      textareaRef.current?.focus();
    } catch (e: unknown) {
      setError((e as Error).message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const handleRetire = async () => {
    if (!confirm(`Retire your conviction on ${conviction.ticker}? The conversation is preserved but will no longer be injected into future analyses.`)) return;
    await fetch(`/api/convictions/${conviction.ticker}`, { method: "DELETE" });
    onRetire?.(conviction.ticker);
  };

  const aiCount = messages.filter(m => m.role === "ai").length;

  return (
    <div className="border border-amber-500/40 rounded-2xl overflow-hidden bg-gradient-to-b from-amber-950/20 to-slate-950/40 shadow-xl shadow-amber-500/5">
    {/* ── Header ── */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(e => !e)}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") setExpanded(prev => !prev); }}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-amber-500/10 transition-colors cursor-pointer select-none"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-300 text-base">{conviction.ticker}</span>
              {awaitingAI && messages.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/30">
                  <Clock className="w-2.5 h-2.5" /> Awaiting AI reply
                </span>
              )}
              {aiCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] bg-slate-700/50 text-slate-400 px-2 py-0.5 rounded-full border border-slate-600/40">
                  <Zap className="w-2.5 h-2.5 text-amber-400" /> {aiCount} AI {aiCount === 1 ? "reply" : "replies"}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {messages.length} message{messages.length !== 1 ? "s" : ""} · Started {fmtDate(conviction.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={e => { e.stopPropagation(); handleRetire(); }}
            className="text-slate-600 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10"
            title="Retire this conviction"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-amber-500/60" />
            : <ChevronDown className="w-4 h-4 text-amber-500/60" />
          }
        </div>
      </div>

      {expanded && (
        <div className="border-t border-amber-500/20">
          {/* ── Message thread ── */}
          <div className="max-h-[480px] overflow-y-auto px-4 py-4 space-y-4 scroll-smooth">
            {messages.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-3">
                  <Clock className="w-5 h-5 text-amber-500/60" />
                </div>
                <p className="text-sm text-amber-500/60 font-medium">Waiting for first analysis</p>
                <p className="text-xs text-slate-600 mt-1">Your conviction will be injected into the next analysis run and the AI will respond.</p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isUser = msg.role === "user";
                const isFirst = idx === 0;
                const prevMsg = idx > 0 ? messages[idx - 1] : null;
                const showDateSeparator = !prevMsg ||
                  new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

                return (
                  <div key={msg.id ?? idx}>
                    {/* Date separator */}
                    {showDateSeparator && (
                      <div className="flex items-center gap-3 my-3">
                        <div className="flex-1 h-px bg-slate-800" />
                        <span className="text-[10px] text-slate-600 font-medium uppercase tracking-wider">
                          {fmtDate(msg.createdAt)}
                        </span>
                        <div className="flex-1 h-px bg-slate-800" />
                      </div>
                    )}

                    {/* Message bubble */}
                    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                      {/* Sender label */}
                      <div className={`flex items-center gap-1.5 mb-1.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isUser
                            ? "bg-amber-500/30 border border-amber-500/50"
                            : "bg-slate-700 border border-slate-600"
                        }`}>
                          {isUser
                            ? <User className="w-2.5 h-2.5 text-amber-400" />
                            : <Bot className="w-2.5 h-2.5 text-slate-300" />
                          }
                        </div>
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${
                          isUser ? "text-amber-500/70" : "text-slate-500"
                        }`}>
                          {isUser ? "You" : "AI Analyst"}
                        </span>
                        <span className="text-[10px] text-slate-700">
                          {fmtTime(msg.createdAt)}
                        </span>
                        {!isUser && msg.analysisRunId && (
                          <span className="text-[9px] bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full border border-slate-700">
                            from analysis run
                          </span>
                        )}
                        {isFirst && isUser && (
                          <span className="text-[9px] bg-amber-500/15 text-amber-500/70 px-1.5 py-0.5 rounded-full border border-amber-500/25">
                            original conviction
                          </span>
                        )}
                      </div>

                      {/* Bubble */}
                      <div className={`w-full max-w-[90%] rounded-2xl px-4 py-3 shadow-lg ${
                        isUser
                          ? "bg-gradient-to-br from-amber-600/30 to-amber-700/20 border border-amber-500/40 rounded-tr-sm"
                          : "bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/60 rounded-tl-sm"
                      }`}>
                        {isUser ? (
                          <p className="text-sm text-amber-50 leading-relaxed">
                            {msg.content}
                          </p>
                        ) : (
                          <AIMessageContent content={msg.content} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {/* Awaiting AI reply indicator */}
            {awaitingAI && messages.length > 0 && (
              <div className="flex items-start gap-2 mt-2">
                <div className="w-5 h-5 rounded-full bg-slate-700 border border-slate-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-2.5 h-2.5 text-slate-300" />
                </div>
                <div className="bg-slate-800/60 border border-slate-700/40 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex space-x-1">
                      <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-xs text-slate-500 italic">AI will reply on the next analysis run</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ── Reply input ── */}
          <div className="border-t border-amber-500/20 bg-slate-950/50 px-4 py-3">
            <p className="text-[11px] text-amber-500/50 mb-2.5 flex items-center gap-1.5">
              <Zap className="w-3 h-3" />
              Your reply is injected into the next analysis run — the AI responds to the full conversation thread with date context and current events.
            </p>
            {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
            <div className="flex gap-2.5 items-end">
              <textarea
                ref={textareaRef}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSend();
                }}
                placeholder="Rebut the AI's counterpoint, or add new context… (Ctrl+Enter to send)"
                rows={2}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/20 transition-colors leading-relaxed"
              />
              <button
                onClick={handleSend}
                disabled={!replyText.trim() || sending}
                className="flex-shrink-0 h-10 px-4 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition-colors flex items-center gap-2 text-sm font-semibold shadow-lg shadow-amber-500/20"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
