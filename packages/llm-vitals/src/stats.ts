import type { Call, Session } from "./types.js";

/** A request still waiting longer than this is treated as abandoned. */
const PENDING_LIMIT_MS = 10 * 60_000;

export interface Summary {
  calls: number;
  /** Output tokens per second of the latest call with a known duration. */
  lastRate?: number;
  /** Output tokens per second across all calls with a known duration. */
  averageRate?: number;
  outputTokens: number;
  /** All input tokens, cached or not. */
  inputTokens: number;
  /** Share of input tokens read from cache, 0 to 1. */
  cacheHitRate?: number;
  /** Tokens in the context window after the latest call. */
  contextTokens?: number;
  /** Share of the context window in use, 0 to 1. */
  contextUsed?: number;
  /** How long the current request has been waiting for its reply. */
  pendingMs?: number;
}

/** End-to-end output rate: output tokens over the time from request sent to reply logged. */
export function tokensPerSecond(call: Call): number | undefined {
  if (call.start === undefined || call.outputTokens <= 0) return undefined;
  const seconds = (call.end - call.start) / 1000;
  return seconds > 0 ? call.outputTokens / seconds : undefined;
}

export function totalInput(call: Call): number {
  return call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens;
}

export function summarize(session: Session, now = Date.now()): Summary {
  const { calls } = session;
  let outputTokens = 0;
  let inputTokens = 0;
  let cacheRead = 0;
  let timedOutput = 0;
  let timedMs = 0;
  let lastRate: number | undefined;

  for (const call of calls) {
    outputTokens += call.outputTokens;
    inputTokens += totalInput(call);
    cacheRead += call.cacheReadTokens;
    const rate = tokensPerSecond(call);
    if (rate !== undefined && call.start !== undefined) {
      lastRate = rate;
      timedOutput += call.outputTokens;
      timedMs += call.end - call.start;
    }
  }

  const last = calls.at(-1);
  const contextTokens = last ? totalInput(last) + last.outputTokens : undefined;
  const pendingMs = session.pendingSince === undefined ? undefined : now - session.pendingSince;

  return {
    calls: calls.length,
    lastRate,
    averageRate: timedMs > 0 ? timedOutput / (timedMs / 1000) : undefined,
    outputTokens,
    inputTokens,
    cacheHitRate: inputTokens > 0 ? cacheRead / inputTokens : undefined,
    contextTokens,
    contextUsed:
      contextTokens !== undefined && session.contextWindow ? contextTokens / session.contextWindow : undefined,
    pendingMs: pendingMs !== undefined && pendingMs >= 0 && pendingMs < PENDING_LIMIT_MS ? pendingMs : undefined,
  };
}
