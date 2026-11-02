import type { Dirent } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Parser, Source } from "../types.js";
import { claudeParser } from "./claude.js";
import { codexParser } from "./codex.js";

export { claudeParser } from "./claude.js";
export { codexParser } from "./codex.js";

export const parsers: Record<Source, (file: string) => Parser> = {
  claude: claudeParser,
  codex: codexParser,
};

export interface SourceDirs {
  /** Claude Code `projects` directories. */
  claude: string[];
  /** Codex `sessions` directory. */
  codex: string;
}

export interface SessionFile {
  source: Source;
  file: string;
  modifiedAt: number;
}

/** Where each tool keeps its logs, honouring `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. */
export function defaultDirs(env: NodeJS.ProcessEnv = process.env): SourceDirs {
  const home = homedir();
  const claudeRoots = [env.CLAUDE_CONFIG_DIR, join(home, ".claude")].filter((dir): dir is string => !!dir);
  return {
    claude: claudeRoots.map((root) => join(root, "projects")),
    codex: join(env.CODEX_HOME || join(home, ".codex"), "sessions"),
  };
}

/** Session files modified at or after `since` (epoch ms). */
export async function findSessionFiles(dirs: SourceDirs, since: number): Promise<SessionFile[]> {
  const [claude, codex] = await Promise.all([findClaude(dirs.claude), findCodex(dirs.codex, since)]);
  const files = [
    ...claude.map((file) => ({ source: "claude" as const, file })),
    ...codex.map((file) => ({ source: "codex" as const, file })),
  ];
  const stamped = await Promise.all(
    files.map(async (entry) => {
      const modifiedAt = await stat(entry.file).then(
        (s) => s.mtimeMs,
        () => 0,
      );
      return { ...entry, modifiedAt };
    }),
  );
  return stamped.filter((entry) => entry.modifiedAt >= since);
}

async function findClaude(projectDirs: string[]): Promise<string[]> {
  // Config dirs may share one projects dir through a symlink.
  const roots = new Set(await Promise.all(projectDirs.map((dir) => realpath(dir).catch(() => dir))));
  const nested = await Promise.all(
    [...roots].map(async (root) => {
      const projects = (await list(root)).filter((entry) => entry.isDirectory());
      const files = await Promise.all(projects.map((project) => jsonlFiles(join(root, project.name))));
      return files.flat();
    }),
  );
  return nested.flat();
}

/** Codex nests files by local date, so only the days since `since` are listed. */
async function findCodex(sessionsDir: string, since: number): Promise<string[]> {
  const days: string[] = [];
  for (let day = startOfDay(since); day <= Date.now(); day += 86_400_000) {
    const date = new Date(day);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const dayOfMonth = String(date.getDate()).padStart(2, "0");
    days.push(join(sessionsDir, String(date.getFullYear()), month, dayOfMonth));
  }
  return (await Promise.all(days.map(jsonlFiles))).flat();
}

async function jsonlFiles(dir: string): Promise<string[]> {
  return (await list(dir))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(dir, entry.name));
}

async function list(dir: string): Promise<Dirent[]> {
  return readdir(dir, { withFileTypes: true }).catch(() => []);
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
