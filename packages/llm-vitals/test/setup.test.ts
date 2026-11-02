import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  disableStatusline,
  enableStatusline,
  findOnPath,
  nodeCommand,
  refreshStatusline,
  SetupError,
  statuslineCommand,
  statuslinePaths,
  statuslineState,
} from "../src/setup.js";

const posix = process.platform !== "win32";

let root: string;
let env: NodeJS.ProcessEnv;
let source: string;
let settings: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "llm-vitals-setup-"));
  env = { CLAUDE_CONFIG_DIR: join(root, "claude") };
  source = join(root, "statusline.cjs");
  settings = statuslinePaths(env).settings;
  await writeFile(source, "// script v1\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const enable = () => enableStatusline({ scriptSource: source, node: "node", env });
const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8"));

describe("enableStatusline", () => {
  it("creates settings and installs the script when Claude Code has none", async () => {
    expect(await enable()).toEqual({ status: "enabled" });
    const { script } = statuslinePaths(env);
    expect(await readJson(settings)).toEqual({
      statusLine: { type: "command", command: statuslineCommand("node", script) },
    });
    expect(await readFile(script, "utf8")).toBe("// script v1\n");
    expect(await statuslineState(env)).toEqual({ status: "enabled" });
  });

  it("keeps every other setting and backs up the original", async () => {
    await mkdir(join(root, "claude"));
    const original = `${JSON.stringify({ model: "opus", hooks: { Stop: [] } }, null, 2)}\n`;
    await writeFile(settings, original);
    await enable();
    expect(await readJson(settings)).toMatchObject({ model: "opus", hooks: { Stop: [] } });
    expect(await readFile(`${settings}.llm-vitals-backup`, "utf8")).toBe(original);
  });

  it("never replaces another status line", async () => {
    await mkdir(join(root, "claude"));
    const original = JSON.stringify({ statusLine: { type: "command", command: "~/my-line.sh" } });
    await writeFile(settings, original);
    expect(await enable()).toEqual({ status: "other", command: "~/my-line.sh" });
    expect(await readFile(settings, "utf8")).toBe(original);
    await expect(stat(statuslinePaths(env).script)).rejects.toThrow();
  });

  it("refuses a file that is not valid JSON and leaves it as is", async () => {
    await mkdir(join(root, "claude"));
    await writeFile(settings, "{ broken");
    await expect(enable()).rejects.toBeInstanceOf(SetupError);
    expect(await readFile(settings, "utf8")).toBe("{ broken");
  });

  it("refuses JSON that is not an object", async () => {
    await mkdir(join(root, "claude"));
    await writeFile(settings, "[]");
    await expect(enable()).rejects.toBeInstanceOf(SetupError);
  });

  it("updates an older llm-vitals command and keeps options the user added", async () => {
    await mkdir(join(root, "claude"));
    const old = { type: "command", command: "llm-vitals statusline", refreshInterval: 1 };
    await writeFile(settings, JSON.stringify({ statusLine: old }));
    await enable();
    expect((await readJson(settings)).statusLine).toEqual({
      type: "command",
      command: statuslineCommand("node", statuslinePaths(env).script),
      refreshInterval: 1,
    });
  });

  it("does not rewrite settings when already enabled", async () => {
    await enable();
    const before = await stat(settings);
    expect(await enable()).toEqual({ status: "enabled" });
    expect((await stat(settings)).mtimeMs).toBe(before.mtimeMs);
  });

  it.runIf(posix)("keeps the settings file's permissions", async () => {
    await mkdir(join(root, "claude"));
    await writeFile(settings, "{}");
    await chmod(settings, 0o600);
    await enable();
    expect((await stat(settings)).mode & 0o777).toBe(0o600);
    expect((await stat(`${settings}.llm-vitals-backup`)).mode & 0o777).toBe(0o600);
  });

  it.runIf(posix)("writes through a symlinked settings file", async () => {
    await mkdir(join(root, "claude"));
    const real = join(root, "real-settings.json");
    await writeFile(real, "{}");
    await symlink(real, settings);
    await enable();
    expect((await readJson(real)).statusLine).toBeDefined();
    expect(await readFile(settings, "utf8")).toBe(await readFile(real, "utf8"));
  });
});

describe("disableStatusline", () => {
  it("removes the llm-vitals status line and script, keeping other settings", async () => {
    await mkdir(join(root, "claude"));
    await writeFile(settings, JSON.stringify({ model: "opus" }));
    await enable();
    expect(await disableStatusline(env)).toEqual({ status: "not-enabled" });
    expect(await readJson(settings)).toEqual({ model: "opus" });
    await expect(stat(statuslinePaths(env).script)).rejects.toThrow();
  });

  it("leaves another status line in place", async () => {
    await mkdir(join(root, "claude"));
    const original = JSON.stringify({ statusLine: { type: "command", command: "~/my-line.sh" } });
    await writeFile(settings, original);
    expect(await disableStatusline(env)).toMatchObject({ status: "other" });
    expect(await readFile(settings, "utf8")).toBe(original);
  });

  it("does nothing when Claude Code has no settings", async () => {
    expect(await disableStatusline(env)).toEqual({ status: "not-enabled" });
    await expect(stat(settings)).rejects.toThrow();
  });
});

describe("refreshStatusline", () => {
  it("updates the installed script only while llm-vitals is enabled", async () => {
    await writeFile(source, "// script v2\n");
    await refreshStatusline(source, env);
    await expect(stat(statuslinePaths(env).script)).rejects.toThrow();

    await enable();
    await writeFile(source, "// script v3\n");
    await refreshStatusline(source, env);
    expect(await readFile(statuslinePaths(env).script, "utf8")).toBe("// script v3\n");
  });
});

describe("statuslineCommand", () => {
  it("quotes paths and uses forward slashes", () => {
    expect(statuslineCommand("node", "/Users/a b/.claude/llm-vitals/statusline.cjs")).toBe(
      'node "/Users/a b/.claude/llm-vitals/statusline.cjs"',
    );
    expect(statuslineCommand("C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\a\\s.cjs")).toBe(
      '"C:/Program Files/nodejs/node.exe" "C:/Users/a/s.cjs"',
    );
  });

  it.each(['/tmp/a"b', "/tmp/$(id)", "/tmp/`id`", "/tmp/a'b", "/tmp/a\nb"])("refuses %j", (path) => {
    expect(() => statuslineCommand("node", path)).toThrow(SetupError);
  });
});

describe.runIf(posix)("findOnPath", () => {
  it("finds executable files only", async () => {
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "tool"), "#!/bin/sh\n");
    expect(await findOnPath("tool", { PATH: bin })).toBeUndefined();
    await chmod(join(bin, "tool"), 0o755);
    expect(await findOnPath("tool", { PATH: `/nonexistent:${bin}` })).toBe(join(bin, "tool"));
  });
});

describe("nodeCommand", () => {
  it("prefers node on PATH", async () => {
    const bin = join(root, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "node.exe"), "");
    expect(await nodeCommand("/opt/node", { PATH: bin }, "win32")).toBe("node");
  });

  it("falls back to the given path on macOS and Linux", async () => {
    expect(await nodeCommand("/opt/node", { PATH: join(root, "none") }, "linux")).toBe("/opt/node");
  });

  it("gives nothing on Windows without node on PATH", async () => {
    expect(await nodeCommand("C:\\node\\node.exe", { PATH: join(root, "none") }, "win32")).toBeUndefined();
  });
});
