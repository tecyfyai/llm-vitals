import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";

/**
 * Turns llm-vitals on and off in Claude Code's status line.
 *
 * Safety rules: only the `statusLine` key of `settings.json` is ever changed; a status line
 * that llm-vitals did not write is never replaced or removed; a file that is not valid JSON is
 * never touched; writes are atomic and keep the file's permissions; and the first change
 * leaves a backup of the original next to it.
 */

/** Thrown when settings cannot be changed safely. Nothing has been written when it is thrown. */
export class SetupError extends Error {
  override name = "SetupError";
}

export type StatuslineState =
  /** llm-vitals is the status line. */
  | { status: "enabled" }
  /** No status line is set. */
  | { status: "not-enabled" }
  /** Another status line is set, and llm-vitals leaves it alone. */
  | { status: "other"; command: string };

export interface StatuslinePaths {
  /** Claude Code's config directory. */
  configDir: string;
  settings: string;
  /** Where the status line script is installed. */
  script: string;
}

export interface EnableOptions {
  /** The bundled status line script to install. */
  scriptSource: string;
  /** How to run Node.js; see `nodeCommand`. */
  node: string;
  env?: NodeJS.ProcessEnv;
}

/** Claude Code's config directory, honouring `CLAUDE_CONFIG_DIR`. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

export function statuslinePaths(env: NodeJS.ProcessEnv = process.env): StatuslinePaths {
  const configDir = claudeConfigDir(env);
  return {
    configDir,
    settings: join(configDir, "settings.json"),
    script: join(configDir, "llm-vitals", "statusline.cjs"),
  };
}

/** Whether `settings.json` has llm-vitals, another status line, or none. */
export async function statuslineState(env: NodeJS.ProcessEnv = process.env): Promise<StatuslineState> {
  return stateOf((await readSettings(statuslinePaths(env).settings)).data);
}

/** Installs the script and points Claude Code's status line at it. Never replaces another status line. */
export async function enableStatusline(options: EnableOptions): Promise<StatuslineState> {
  const paths = statuslinePaths(options.env);
  const command = statuslineCommand(options.node, paths.script);
  const settings = await readSettings(paths.settings);
  const state = stateOf(settings.data);
  if (state.status === "other") return state;

  await installScript(options.scriptSource, paths.script);
  // Keep options the user added to the llm-vitals entry, such as `refreshInterval`.
  const current = state.status === "enabled" ? (settings.data.statusLine as Record<string, unknown>) : {};
  if (current.command === command) return state;
  const statusLine = { ...current, type: "command", command };
  await writeSettings(paths.settings, settings, { ...settings.data, statusLine });
  return { status: "enabled" };
}

/** Removes the llm-vitals status line and script. Leaves any other status line in place. */
export async function disableStatusline(env: NodeJS.ProcessEnv = process.env): Promise<StatuslineState> {
  const paths = statuslinePaths(env);
  const settings = await readSettings(paths.settings);
  const state = stateOf(settings.data);
  if (state.status === "enabled") {
    const { statusLine: _, ...rest } = settings.data;
    await writeSettings(paths.settings, settings, rest);
  }
  await rm(paths.script, { force: true });
  await rmdir(dirname(paths.script)).catch(() => {});
  return state.status === "enabled" ? { status: "not-enabled" } : state;
}

/**
 * Re-installs the script when it differs from `scriptSource`, for example after an update.
 * Does nothing unless llm-vitals is the status line and its script was installed by setup.
 */
export async function refreshStatusline(scriptSource: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { script } = statuslinePaths(env);
  if ((await statuslineState(env)).status !== "enabled" || !(await exists(script))) return;
  await installScript(scriptSource, script);
}

/**
 * How to run Node.js from the status line: plain `node` when it is on `PATH`, so it follows the
 * user's Node.js version manager, otherwise the absolute `fallback`. Returns undefined when
 * neither works. Windows needs `node` on `PATH`: PowerShell would not run a quoted program path.
 */
export async function nodeCommand(
  fallback?: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  if (await findOnPath("node", env, platform)) return "node";
  return platform === "win32" ? undefined : fallback;
}

/** The first executable named `name` on `PATH`. */
export async function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const path = env.PATH ?? env.Path ?? "";
  const extensions = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const separator = platform === "win32" ? ";" : delimiter;
  const mode = platform === "win32" ? constants.F_OK : constants.X_OK;
  for (const dir of path.split(separator).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(dir, name + extension.toLowerCase());
      if (await isExecutableFile(candidate, mode)) return candidate;
    }
  }
  return undefined;
}

/**
 * The status line command. Claude Code runs it through a shell (sh, bash, Git Bash or
 * PowerShell), so paths are double-quoted and any character those shells could expand
 * inside double quotes is refused rather than escaped.
 */
export function statuslineCommand(node: string, script: string): string {
  const quote = (value: string) => {
    const path = value.replaceAll("\\", "/");
    if (/["'`$!\r\n\0]/.test(path)) {
      throw new SetupError(`Cannot use this path in a shell command safely: ${value}`);
    }
    return `"${path}"`;
  };
  return `${node === "node" ? "node" : quote(node)} ${quote(script)}`;
}

/** A status line belongs to llm-vitals when its command runs the llm-vitals status line. */
export function isLlmVitalsCommand(command: string): boolean {
  return /llm-vitals/i.test(command) && /statusline/i.test(command);
}

interface Settings {
  data: Record<string, unknown>;
  /** The file's text as read, or undefined when it did not exist. */
  text: string | undefined;
}

function stateOf(data: Record<string, unknown>): StatuslineState {
  const statusLine = data.statusLine;
  if (statusLine === undefined || statusLine === null) return { status: "not-enabled" };
  const command = (statusLine as { command?: unknown }).command;
  if (typeof command === "string" && isLlmVitalsCommand(command)) return { status: "enabled" };
  return { status: "other", command: typeof command === "string" ? command : JSON.stringify(statusLine) };
}

async function readSettings(file: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { data: {}, text: undefined };
    throw error;
  }
  let data: unknown;
  try {
    data = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    throw new SetupError(`${file} is not valid JSON, so llm-vitals left it unchanged. Fix it and try again.`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new SetupError(`${file} does not hold a JSON object, so llm-vitals left it unchanged.`);
  }
  return { data: data as Record<string, unknown>, text };
}

async function writeSettings(file: string, before: Settings, data: Record<string, unknown>): Promise<void> {
  // Write through symlinks, so a linked settings file stays linked.
  const target = await realpath(file).catch(() => file);
  const current = await readFile(target, "utf8").catch(() => undefined);
  if (current !== before.text) throw new SetupError(`${file} changed while llm-vitals was updating it. Try again.`);

  const mode = before.text === undefined ? 0o600 : (await stat(target)).mode & 0o777;
  if (before.text !== undefined) {
    // Keep the first original; later runs never overwrite it.
    await copyFile(target, `${target}.llm-vitals-backup`, constants.COPYFILE_EXCL).then(
      () => chmod(`${target}.llm-vitals-backup`, mode),
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
  }
  await atomicWrite(target, `${JSON.stringify(data, null, 2)}\n`, mode);
}

async function installScript(source: string, destination: string): Promise<void> {
  const script = await readFile(source);
  const installed = await readFile(destination).catch(() => undefined);
  if (installed?.equals(script)) return;
  await atomicWrite(destination, script, 0o644);
}

/** Writes to a new temporary file beside `file`, then renames it over `file`. */
async function atomicWrite(file: string, content: string | Buffer, mode: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = join(dirname(file), `.${basename(file)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    // `wx` fails rather than follow anything already at the temporary path.
    await writeFile(temp, content, { mode, flag: "wx" });
    await chmod(temp, mode);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function isExecutableFile(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
