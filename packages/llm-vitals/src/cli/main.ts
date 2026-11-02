#!/usr/bin/env node
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { displayText } from "../format.js";
import {
  disableStatusline,
  enableStatusline,
  nodeCommand,
  refreshStatusline,
  SetupError,
  statuslinePaths,
} from "../setup.js";
import { summarize } from "../stats.js";
import { Tracker } from "../tracker.js";
import { live, plain, render } from "./live.js";
import { statusline } from "./statusline.js";

const HELP = `llm-vitals: live tokens per second for Claude Code and Codex

Usage
  llm-vitals               Live view of active sessions
  llm-vitals --once        Print the table once
  llm-vitals --json        Print active sessions as JSON
  llm-vitals setup         Show speed in Claude Code's status line
  llm-vitals setup --undo  Remove it again
  llm-vitals statusline    Claude Code status line (reads its JSON on stdin)

Options
  --window <minutes>     Show sessions active in the last N minutes (default 60)
  --interval <ms>        Refresh interval for the live view (default 1000, at least 100)
  -h, --help             Show this help
  -v, --version          Show the version
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      once: { type: "boolean" },
      json: { type: "boolean" },
      window: { type: "string", default: "60" },
      interval: { type: "string", default: "1000" },
      undo: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });

  if (values.help) return void process.stdout.write(HELP);
  if (values.version) {
    const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };
    return void process.stdout.write(`${version}\n`);
  }

  const command = positionals[0];
  if (command === "statusline") return statusline();
  // After an update, bring an installed status line script up to date too. Never fails a command.
  await refreshStatusline(SCRIPT_SOURCE).catch(() => {});
  if (command === "setup") return setup(values.undo ?? false);
  if (values.undo) throw new UsageError("--undo only works with llm-vitals setup");
  if (command !== undefined) throw new UsageError(`Unknown command: ${command}`);

  const windowMinutes = positiveNumber(values.window, "--window");
  const intervalMs = Math.max(MIN_INTERVAL_MS, positiveNumber(values.interval, "--interval"));
  const tracker = new Tracker({ activeWindowMs: windowMinutes * 60_000 });
  if (values.json) {
    const now = Date.now();
    const sessions = (await tracker.poll(now)).map((session) => ({ ...session, summary: summarize(session, now) }));
    return void process.stdout.write(`${JSON.stringify(sessions, null, 2)}\n`);
  }
  if (values.once || !process.stdout.isTTY) {
    const now = Date.now();
    return void process.stdout.write(render(await tracker.poll(now), now, plain));
  }
  await live(tracker, intervalMs);
}

async function setup(undo: boolean): Promise<void> {
  const { settings } = statuslinePaths();
  const node = undo ? undefined : await nodeCommand(process.execPath);
  if (!undo && !node) throw new SetupError("Claude Code's status line needs Node.js on your PATH.");
  const state = undo
    ? await disableStatusline()
    : await enableStatusline({
        scriptSource: SCRIPT_SOURCE,
        node: node ?? "node",
      });
  if (state.status === "other") {
    process.stderr.write(
      `Claude Code already has a status line, so llm-vitals left it unchanged:\n  ${displayText(state.command, 500)}\n` +
        `To use llm-vitals instead, remove "statusLine" from ${settings} and run llm-vitals setup again.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    undo
      ? `llm-vitals is no longer in Claude Code's status line (${settings}).\n`
      : `Claude Code's status line now shows tokens per second (${settings}).\nUndo with: llm-vitals setup --undo\n`,
  );
}

/** The bundled status line script that setup installs. */
const SCRIPT_SOURCE = fileURLToPath(new URL("../statusline.cjs", import.meta.url));

/** The live view never redraws more often than this. */
const MIN_INTERVAL_MS = 100;

class UsageError extends Error {}

function positiveNumber(value: string | undefined, flag: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new UsageError(`${flag} must be a positive number`);
  return number;
}

main().catch((error: unknown) => {
  if (error instanceof SetupError) {
    process.stderr.write(`llm-vitals: ${error.message}\n`);
    process.exit(1);
  }
  const usage = error instanceof UsageError || (error as { code?: string } | null)?.code?.startsWith("ERR_PARSE_ARGS");
  process.stderr.write(`llm-vitals: ${error instanceof Error ? error.message : String(error)}\n`);
  if (usage) process.stderr.write("Run llm-vitals --help for usage.\n");
  process.exit(usage ? 2 : 1);
});
