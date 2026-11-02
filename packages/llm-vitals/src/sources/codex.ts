import { basename } from "node:path";
import type { Parser, RateLimit, Session } from "../types.js";
import { count, parseLine, toTime } from "./json.js";

/**
 * Codex rollout lines (`<CODEX_HOME>/sessions/YYYY/MM/DD/rollout-*.jsonl`).
 * Each model response writes a `token_usage_record`. A response starts when its
 * input arrives: the turn starting, a user message or a tool result.
 * Older versions only write cumulative `token_count` events.
 */
interface Line {
  timestamp?: string;
  type?: string;
  payload?: Payload;
}

interface Payload {
  type?: string;
  id?: string;
  cwd?: string;
  model?: string;
  role?: string;
  response_id?: string;
  usage?: Usage;
  model_context_window?: number;
  info?: {
    last_token_usage?: Usage;
    total_token_usage?: Usage;
    model_context_window?: number;
  } | null;
  rate_limits?: { primary?: Limit | null; secondary?: Limit | null } | null;
}

interface Usage {
  /** Total input, cached tokens included. */
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  /** Output, reasoning included. */
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface Limit {
  used_percent?: number;
  window_minutes?: number;
  /** Epoch seconds. */
  resets_at?: number;
}

const TOOL_OUTPUTS = new Set(["function_call_output", "custom_tool_call_output", "local_shell_call_output"]);

/** Lines that carry figures. They are always short, so they are never cut. */
const FULL_PARSE_TYPES = new Set(["session_meta", "turn_context", "token_usage_record"]);
const FULL_PARSE_EVENTS = new Set(["task_started", "token_count"]);

export function codexParser(file: string): Parser {
  const session: Session = {
    source: "codex",
    id: basename(file, ".jsonl"),
    file,
    calls: [],
    updatedAt: 0,
  };
  const seen = new Set<string>();
  let inputTime: number | undefined;
  let lastEnd: number | undefined;
  let hasUsageRecords = false;
  let lastTotal: number | undefined;

  function markInput(time: number): void {
    inputTime = time;
    session.pendingSince = time;
  }

  function addCall(id: string, usage: Usage, time: number, start: number | undefined): void {
    if (seen.has(id)) return;
    seen.add(id);
    const cached = count(usage.cached_input_tokens);
    const written = count(usage.cache_write_input_tokens);
    session.calls.push({
      id,
      model: session.model,
      start,
      end: time,
      inputTokens: Math.max(0, count(usage.input_tokens) - cached - written),
      cacheReadTokens: cached,
      cacheWriteTokens: written,
      outputTokens: count(usage.output_tokens),
      reasoningTokens: count(usage.reasoning_output_tokens),
    });
    inputTime = undefined;
    lastEnd = time;
    session.pendingSince = undefined;
  }

  function push(raw: string, cut = false): void {
    const line = cut ? peek(raw) : parseLine<Line>(raw);
    const time = toTime(line?.timestamp);
    if (!line || Number.isNaN(time)) return;
    const payload = line.payload ?? {};
    session.updatedAt = Math.max(session.updatedAt, time);

    switch (line.type) {
      case "session_meta":
        if (payload.id) session.id = payload.id;
        if (payload.cwd) session.cwd = payload.cwd;
        break;
      case "turn_context":
        if (payload.model) session.model = payload.model;
        break;
      case "response_item":
        if (TOOL_OUTPUTS.has(payload.type ?? "") || (payload.type === "message" && payload.role === "user")) {
          markInput(time);
        }
        break;
      case "token_usage_record":
        hasUsageRecords = true;
        if (payload.usage) {
          addCall(payload.response_id ?? `record-${time}`, payload.usage, time, inputTime ?? lastEnd);
        }
        break;
      case "event_msg":
        handleEvent(payload, time);
        break;
    }
  }

  function handleEvent(payload: Payload, time: number): void {
    switch (payload.type) {
      case "task_started":
        markInput(time);
        if (payload.model_context_window) session.contextWindow = payload.model_context_window;
        break;
      case "task_complete":
      case "turn_aborted":
        inputTime = undefined;
        session.pendingSince = undefined;
        break;
      case "token_count": {
        const info = payload.info;
        if (info?.model_context_window) session.contextWindow = info.model_context_window;
        const limits = [payload.rate_limits?.primary, payload.rate_limits?.secondary]
          .filter((limit): limit is Limit => limit != null)
          .map(toRateLimit);
        if (limits.length) session.rateLimits = limits;
        // Fallback for versions without usage records. These events are not tied
        // to a response's start, so the call gets no duration.
        const total = info?.total_token_usage?.total_tokens;
        if (!hasUsageRecords && info?.last_token_usage && total !== lastTotal) {
          lastTotal = total;
          addCall(`count-${time}`, info.last_token_usage, time, undefined);
        }
        break;
      }
    }
  }

  return { session, push };
}

/**
 * The opening fields of a cut line, which are all that tool output and message lines need.
 * Fields are found by name, since their order varies between Codex versions.
 */
function peek(raw: string): Line | undefined {
  const head = raw.slice(0, 1024);
  const at = head.indexOf('"payload":{');
  if (at < 0) return undefined;
  const outer = head.slice(0, at);
  const inner = head.slice(at);
  const type = field(outer, "type");
  const payloadType = field(inner, "type");
  if (!type || FULL_PARSE_TYPES.has(type) || (type === "event_msg" && FULL_PARSE_EVENTS.has(payloadType ?? ""))) {
    return undefined;
  }
  return { timestamp: field(outer, "timestamp"), type, payload: { type: payloadType, role: field(inner, "role") } };
}

function field(text: string, name: string): string | undefined {
  return new RegExp(`"${name}":"([^"\\\\]*)"`).exec(text)?.[1];
}

function toRateLimit(limit: Limit): RateLimit {
  const minutes = count(limit.window_minutes);
  const label =
    minutes <= 0
      ? "limit"
      : minutes >= 1440 && minutes % 1440 === 0
        ? `${minutes / 1440}d`
        : minutes >= 60
          ? `${Math.round(minutes / 60)}h`
          : `${minutes}m`;
  return {
    label,
    usedPercent: count(limit.used_percent),
    resetsAt: limit.resets_at ? limit.resets_at * 1000 : undefined,
  };
}
