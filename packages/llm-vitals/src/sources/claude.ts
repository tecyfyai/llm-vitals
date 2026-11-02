import { basename } from "node:path";
import type { Call, Parser, Session } from "../types.js";
import { count, parseLine, toTime } from "./json.js";

/**
 * Claude Code transcript lines (`<config>/projects/<project>/<session>.jsonl`).
 * An `api-request` line is written when a request is sent. Each content block of
 * the reply is then written as its own `assistant` line, all carrying the same
 * message id, the final usage and a `requestRef` back to the request.
 */
interface Line {
  type?: string;
  subtype?: string;
  id?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  querySource?: string;
  requestRef?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens?: number;
      output_tokens_details?: { thinking_tokens?: number };
    };
  };
}

/** Placeholder model Claude Code uses for locally generated messages. */
const SYNTHETIC_MODEL = "<synthetic>";

export function claudeParser(file: string): Parser {
  const session: Session = {
    source: "claude",
    id: basename(file, ".jsonl"),
    file,
    calls: [],
    updatedAt: 0,
  };
  const requestTimes = new Map<string, number>();
  const callsByMessage = new Map<string, Call>();
  // Older versions write no api-request lines; fall back to the last user line.
  let lastUserTime: number | undefined;

  function push(raw: string, cut = false): void {
    if (cut) return; // long lines hold tool results and request bodies, never usage
    const line = parseLine<Line>(raw);
    const time = toTime(line?.timestamp);
    if (!line || Number.isNaN(time)) return;

    if (line.sessionId) session.id = line.sessionId;
    if (line.cwd) session.cwd = line.cwd;
    session.updatedAt = Math.max(session.updatedAt, time);

    if (line.type === "api-request" && line.id) {
      requestTimes.set(line.id, time);
      if (!line.querySource || line.querySource === "repl_main_thread") session.pendingSince = time;
      return;
    }
    if (line.type === "system" && line.subtype === "turn_duration") {
      session.pendingSince = undefined;
      return;
    }
    if (line.type === "user") {
      lastUserTime = time;
      return;
    }

    const message = line.message;
    if (line.type !== "assistant" || !message?.id || !message.usage) return;
    if (message.model === SYNTHETIC_MODEL) return;

    const start = line.requestRef ? requestTimes.get(line.requestRef) : lastUserTime;
    if (start !== undefined && start === session.pendingSince) session.pendingSince = undefined;

    const existing = callsByMessage.get(message.id);
    if (existing) {
      existing.end = Math.max(existing.end, time);
      return;
    }

    const usage = message.usage;
    const call: Call = {
      id: message.id,
      model: message.model,
      start,
      end: time,
      inputTokens: count(usage.input_tokens),
      cacheReadTokens: count(usage.cache_read_input_tokens),
      cacheWriteTokens: count(usage.cache_creation_input_tokens),
      outputTokens: count(usage.output_tokens),
      reasoningTokens: count(usage.output_tokens_details?.thinking_tokens),
    };
    callsByMessage.set(message.id, call);
    session.calls.push(call);
    if (message.model) session.model = message.model;
  }

  return { session, push };
}
