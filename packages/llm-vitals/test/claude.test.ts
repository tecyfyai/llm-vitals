import { describe, expect, it } from "vitest";
import { claudeParser } from "../src/sources/claude.js";
import { summarize } from "../src/stats.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, seconds)).toISOString();

const request = (id: string, seconds: number, querySource = "repl_main_thread") =>
  JSON.stringify({ type: "api-request", id, timestamp: at(seconds), sessionId: "s1", querySource });

const reply = (messageId: string, requestRef: string, seconds: number, output: number, model = "claude-test") =>
  JSON.stringify({
    type: "assistant",
    timestamp: at(seconds),
    sessionId: "s1",
    cwd: "/work/app",
    requestRef,
    message: {
      id: messageId,
      model,
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 90,
        output_tokens: output,
        output_tokens_details: { thinking_tokens: 50 },
      },
    },
  });

function parse(lines: string[]) {
  const parser = claudeParser("/logs/s1.jsonl");
  for (const line of lines) parser.push(line);
  return parser.session;
}

describe("claudeParser", () => {
  it("times a call from request sent to last content block", () => {
    const session = parse([request("r1", 0), reply("m1", "r1", 2, 400), reply("m1", "r1", 4, 400)]);
    expect(session.calls).toHaveLength(1);
    expect(session.calls[0]).toMatchObject({ start: Date.parse(at(0)), end: Date.parse(at(4)), outputTokens: 400 });
    expect(summarize(session).lastRate).toBe(100);
  });

  it("counts usage once per message, not once per content block", () => {
    const session = parse([request("r1", 0), reply("m1", "r1", 1, 100), reply("m1", "r1", 2, 100)]);
    expect(summarize(session).outputTokens).toBe(100);
  });

  it("reads session details and token kinds", () => {
    const session = parse([request("r1", 0), reply("m1", "r1", 1, 100)]);
    expect(session).toMatchObject({ id: "s1", cwd: "/work/app", model: "claude-test" });
    expect(session.calls[0]).toMatchObject({
      inputTokens: 10,
      cacheReadTokens: 900,
      cacheWriteTokens: 90,
      reasoningTokens: 50,
    });
    expect(summarize(session).cacheHitRate).toBeCloseTo(0.9);
  });

  it("marks a request pending until its reply arrives", () => {
    expect(parse([request("r1", 0)]).pendingSince).toBe(Date.parse(at(0)));
    expect(parse([request("r1", 0), reply("m1", "r1", 3, 10)]).pendingSince).toBeUndefined();
  });

  it("ignores background requests and synthetic messages", () => {
    const session = parse([request("t1", 0, "title"), reply("m0", "t1", 1, 5, "<synthetic>")]);
    expect(session.pendingSince).toBeUndefined();
    expect(session.calls).toHaveLength(0);
  });

  it("falls back to the last user line when requests are not logged", () => {
    const user = JSON.stringify({ type: "user", timestamp: at(0), sessionId: "s1" });
    const session = parse([user, reply("m1", "", 5, 250)]);
    expect(summarize(session).lastRate).toBe(50);
  });

  it("skips malformed lines", () => {
    expect(parse(["not json", "{}", "null"]).calls).toHaveLength(0);
  });
});
