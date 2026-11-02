import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LineTail, readLastLines } from "../src/tail.js";
import { Tracker } from "../src/tracker.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "llm-vitals-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const MB = 1024 * 1024;

/** Lines read, with cut lines shown as `cut:<length>`. */
async function collect(tail: LineTail): Promise<string[]> {
  const lines: string[] = [];
  await tail.read((line, cut) => lines.push(cut ? `cut:${line.length}` : line));
  return lines;
}

describe("LineTail", () => {
  it("returns only complete, new lines", async () => {
    const file = join(root, "log.jsonl");
    await writeFile(file, "a\nb");
    const tail = new LineTail(file);
    expect(await collect(tail)).toEqual(["a"]);
    await appendFile(file, "c\nd\n");
    expect(await collect(tail)).toEqual(["bc", "d"]);
    expect(await collect(tail)).toEqual([]);
  });

  it("starts over when the file is truncated", async () => {
    const file = join(root, "log.jsonl");
    await writeFile(file, "first line\n");
    const tail = new LineTail(file);
    await collect(tail);
    await writeFile(file, "new\n");
    expect(await collect(tail)).toEqual(["new"]);
  });

  it("joins a multi-byte character split across read chunks", async () => {
    const file = join(root, "log.jsonl");
    // The first line ends 2 bytes before the 1 MB chunk boundary, so the two bytes of "é" straddle it.
    await writeFile(file, `${"d".repeat(MB - 3)}\nxéyy\n`);
    expect(await collect(new LineTail(file))).toEqual(["cut:4096", "xéyy"]);
  });

  it("cuts long lines down to their opening bytes", async () => {
    const file = join(root, "log.jsonl");
    const longInOneChunk = "a".repeat(300 * 1024);
    const longAcrossChunks = "b".repeat(5 * MB);
    await writeFile(file, `before\n${longInOneChunk}\n${longAcrossChunks}\nafter\n`);
    expect(await collect(new LineTail(file))).toEqual(["before", "cut:4096", "cut:4096", "after"]);
  });

  it("keeps a line at the length limit whole", async () => {
    const file = join(root, "log.jsonl");
    const line = "c".repeat(256 * 1024);
    await writeFile(file, `${"d".repeat(MB - 10)}\n${line}\n`); // starts just before a chunk boundary
    expect((await collect(new LineTail(file)))[1]).toBe(line);
  });
});

describe("readLastLines", () => {
  it("drops the line cut by the byte limit", async () => {
    const file = join(root, "log.jsonl");
    await writeFile(file, "aaaa\nbbbb\ncccc\n");
    expect(await readLastLines(file, 8)).toEqual(["cccc"]);
  });
});

describe("Tracker", () => {
  it("finds sessions from both tools and follows new lines", async () => {
    const now = new Date();
    const claudeDir = join(root, "claude", "projects");
    const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0"));
    const codexDay = join(root, "codex", "sessions", ...day);
    await mkdir(join(claudeDir, "project"), { recursive: true });
    await mkdir(codexDay, { recursive: true });

    const claudeFile = join(claudeDir, "project", "s1.jsonl");
    const time = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();
    await writeFile(claudeFile, `${JSON.stringify({ type: "api-request", id: "r1", timestamp: time(-2000) })}\n`);
    await writeFile(
      join(codexDay, "rollout-1.jsonl"),
      `${JSON.stringify({ timestamp: time(-5000), type: "session_meta", payload: { id: "c1" } })}\n`,
    );

    const tracker = new Tracker({ dirs: { claude: [claudeDir], codex: join(root, "codex", "sessions") } });
    const first = await tracker.poll(now.getTime());
    expect(first.map((session) => session.source)).toEqual(["claude", "codex"]);
    expect(first[0]?.pendingSince).toBeDefined();

    const reply = { type: "assistant", timestamp: time(0), requestRef: "r1", message: { id: "m1", usage: {} } };
    await appendFile(claudeFile, `${JSON.stringify(reply)}\n`);
    const [claude] = await tracker.poll(now.getTime());
    expect(claude?.calls).toHaveLength(1);
    expect(claude?.pendingSince).toBeUndefined();
  });
});
