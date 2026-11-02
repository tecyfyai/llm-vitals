import { describe, expect, it } from "vitest";
import { codexParser } from "../src/sources/codex.js";
import { summarize } from "../src/stats.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, seconds)).toISOString();
const line = (seconds: number, type: string, payload: object) =>
  JSON.stringify({ timestamp: at(seconds), type, payload });

const usage = (output: number) => ({
  input_tokens: 1000,
  cached_input_tokens: 800,
  cache_write_input_tokens: 0,
  output_tokens: output,
  reasoning_output_tokens: 20,
});

const record = (seconds: number, responseId: string, output: number) =>
  line(seconds, "token_usage_record", { response_id: responseId, usage: usage(output) });

const turn = [
  line(0, "session_meta", { id: "c1", cwd: "/work/api" }),
  line(0, "event_msg", { type: "task_started", model_context_window: 10_000 }),
  line(0, "turn_context", { model: "gpt-test" }),
  line(1, "response_item", { type: "message", role: "user" }),
  record(3, "resp1", 100),
  line(5, "response_item", { type: "function_call_output" }),
  record(9, "resp2", 200),
];

function parse(lines: string[]) {
  const parser = codexParser("/logs/rollout.jsonl");
  for (const entry of lines) parser.push(entry);
  return parser.session;
}

describe("codexParser", () => {
  it("times each response from the input that started it", () => {
    const session = parse(turn);
    expect(session.calls.map((call) => [call.start, call.end])).toEqual([
      [Date.parse(at(1)), Date.parse(at(3))],
      [Date.parse(at(5)), Date.parse(at(9))],
    ]);
    expect(summarize(session)).toMatchObject({ lastRate: 50, averageRate: 50 });
  });

  it("reads session details and separates cached input", () => {
    const session = parse(turn);
    expect(session).toMatchObject({ id: "c1", cwd: "/work/api", model: "gpt-test", contextWindow: 10_000 });
    expect(session.calls[0]).toMatchObject({ inputTokens: 200, cacheReadTokens: 800, reasoningTokens: 20 });
    expect(summarize(session).contextUsed).toBeCloseTo(0.12);
  });

  it("ignores repeated records for one response", () => {
    expect(parse([...turn, record(10, "resp2", 200)]).calls).toHaveLength(2);
  });

  it("is pending between a tool result and the next response", () => {
    expect(parse(turn.slice(0, 6)).pendingSince).toBe(Date.parse(at(5)));
    expect(parse(turn).pendingSince).toBeUndefined();
  });

  it("reads rate limits", () => {
    const limits = line(9, "event_msg", {
      type: "token_count",
      info: null,
      rate_limits: {
        primary: { used_percent: 26, window_minutes: 300, resets_at: 1_800_000_000 },
        secondary: { used_percent: 65, window_minutes: 10_080 },
      },
    });
    expect(parse([...turn, limits]).rateLimits).toEqual([
      { label: "5h", usedPercent: 26, resetsAt: 1_800_000_000_000 },
      { label: "7d", usedPercent: 65, resetsAt: undefined },
    ]);
  });

  it("falls back to token_count events for older logs, without timing", () => {
    const count = (seconds: number, total: number) =>
      line(seconds, "event_msg", {
        type: "token_count",
        info: { last_token_usage: usage(50), total_token_usage: { total_tokens: total } },
      });
    const session = parse([count(1, 1050), count(2, 1050), count(3, 2100)]);
    expect(session.calls).toHaveLength(2);
    expect(summarize(session).lastRate).toBeUndefined();
  });

  it("handles multi-megabyte lines from their opening fields alone", () => {
    const output = "x".repeat(2 * 1024 * 1024);
    // Real logs put other fields, such as "ordinal", between timestamp and type.
    const big = (seconds: number, payload: object) =>
      JSON.stringify({ timestamp: at(seconds), ordinal: 7, type: "response_item", payload: { ...payload, output } });
    const session = parse([
      ...turn.slice(0, 5),
      big(5, { type: "function_call_output" }),
      record(9, "resp2", 200),
      big(10, { type: "message", role: "user" }),
    ]);
    expect(session.calls[1]?.start).toBe(Date.parse(at(5)));
    expect(session.pendingSince).toBe(Date.parse(at(10)));
  });

  it("labels rate limit windows of any length", () => {
    const limits = line(9, "event_msg", {
      type: "token_count",
      rate_limits: { primary: { used_percent: 1, window_minutes: 30 }, secondary: { used_percent: 2 } },
    });
    expect(parse([...turn, limits]).rateLimits?.map((limit) => limit.label)).toEqual(["30m", "limit"]);
  });
});
