import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the built command, so `npm run build` comes first (as in `npm run check`).
const CLI = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));

interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: NodeJS.ProcessEnv): Promise<Result> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      resolve({ code: error ? Number(error.code) : 0, stdout, stderr });
    });
  });
}

let root: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "llm-vitals-cli-"));
  // HOME too, so the real ~/.claude and ~/.codex are never read.
  env = { HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: join(root, "claude"), CODEX_HOME: join(root, "codex") };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("llm-vitals command", () => {
  it("prints its version", async () => {
    const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    expect(await run(["--version"], env)).toMatchObject({ code: 0, stdout: `${version}\n` });
  });

  it.each([[["--undo"]], [["--interval", "0"]], [["--window", "-5"]], [["unknown"]], [["--nope"]]])(
    "rejects %j with exit code 2",
    async (args) => {
      const result = await run(args, env);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("--help");
    },
  );

  it("prints an empty table and JSON when nothing is active", async () => {
    expect((await run(["--once"], env)).code).toBe(0);
    expect(await run(["--json"], env)).toMatchObject({ code: 0, stdout: "[]\n" });
  });

  it("leaves another status line alone and prints it without control characters", async () => {
    const settings = join(root, "claude", "settings.json");
    await mkdir(join(root, "claude"));
    const original = `${JSON.stringify({ statusLine: { type: "command", command: "other \u001b[2J tool" } })}\n`;
    await writeFile(settings, original);
    const result = await run(["setup"], env);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("other [2J tool");
    expect(result.stderr).not.toContain("\u001b");
    expect(await readFile(settings, "utf8")).toBe(original);
  });

  it("sets up and removes the status line", async () => {
    const settings = join(root, "claude", "settings.json");
    expect((await run(["setup"], env)).code).toBe(0);
    expect(JSON.parse(await readFile(settings, "utf8")).statusLine.command).toContain("llm-vitals");
    expect((await run(["setup", "--undo"], env)).code).toBe(0);
    expect(JSON.parse(await readFile(settings, "utf8"))).toEqual({});
  });

  it("updates an installed status line script on any run", async () => {
    expect((await run(["setup"], env)).code).toBe(0);
    const script = join(root, "claude", "llm-vitals", "statusline.cjs");
    const current = await readFile(script, "utf8");
    await writeFile(script, "// an older version\n");
    expect((await run(["--once"], env)).code).toBe(0);
    expect(await readFile(script, "utf8")).toBe(current);
  });

  it("prints a status line even from bad input", async () => {
    const result = await new Promise<string>((resolve) => {
      const child = execFile(process.execPath, [CLI, "statusline"], { env: { ...process.env, ...env } }, (_e, out) =>
        resolve(out),
      );
      child.stdin?.end("not json");
    });
    expect(result).toBe("⚡ —\n");
  });
});
