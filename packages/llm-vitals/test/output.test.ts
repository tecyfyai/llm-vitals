import { describe, expect, it } from "vitest";
import { plain, render } from "../src/cli/live.js";
import { formatStatusline } from "../src/cli/statusline.js";
import { displayText, formatDuration, formatTokens } from "../src/format.js";
import type { Session } from "../src/types.js";

const NOW = 1_000_000;

const session = (overrides: Partial<Session> = {}): Session => ({
  source: "claude",
  id: "s1",
  file: "/logs/s1.jsonl",
  cwd: "/work/app",
  model: "claude-test",
  updatedAt: NOW,
  calls: [
    {
      id: "m1",
      start: NOW - 4000,
      end: NOW - 2000,
      inputTokens: 100,
      cacheReadTokens: 900,
      cacheWriteTokens: 0,
      outputTokens: 120,
      reasoningTokens: 0,
    },
  ],
  ...overrides,
});

describe("formatting", () => {
  it("abbreviates token counts and durations", () => {
    expect([formatTokens(950), formatTokens(41_230), formatTokens(1_200_000)]).toEqual(["950", "41.2k", "1.2M"]);
    expect([formatTokens(999.6), formatTokens(999_960)]).toEqual(["1.0k", "1.0M"]);
    expect([formatDuration(4200), formatDuration(65_000)]).toEqual(["4s", "1m 05s"]);
  });
});

describe("displayText", () => {
  it("removes terminal escape sequences and direction overrides", () => {
    expect(displayText("evil\u001b]0;pwned\u0007\u001b[2Jname")).toBe("evil]0;pwned[2Jname");
    expect(displayText("abc\u202edef")).toBe("abcdef");
  });

  it("cuts long values short", () => {
    expect(displayText("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("render", () => {
  it("never prints control characters from logs", () => {
    const table = render([session({ cwd: "/p/\u001b[31mred", model: "m\u001b[2J" })], NOW, plain);
    expect(table).not.toContain("\u001b");
  });

  it("shows a row per active session", () => {
    const table = render([session()], NOW);
    expect(table).toContain("Claude Code  app");
    expect(table).toContain("60 tok/s");
    expect(table).toContain("90%");
  });

  it("shows time waited while a request is pending", () => {
    expect(render([session({ pendingSince: NOW - 7000 })], NOW)).toContain("● 7s");
  });

  it("says when nothing is active", () => {
    expect(render([], NOW)).toContain("No active");
  });
});

describe("formatStatusline", () => {
  it("combines speed and context use", () => {
    expect(formatStatusline({ context_window: { used_percentage: 41.4 } }, session(), NOW)).toBe(
      "⚡ 60 tok/s · avg 60 tok/s · ctx 41%",
    );
  });

  it("shows a timer while waiting and a placeholder without data", () => {
    expect(formatStatusline({}, session({ pendingSince: NOW - 3000 }), NOW)).toBe("⏳ 3s · avg 60 tok/s");
    expect(formatStatusline({}, undefined, NOW)).toBe("⚡ —");
  });
});
