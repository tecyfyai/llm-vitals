import { setTimeout as sleep } from "node:timers/promises";
import {
  formatDuration,
  formatPercent,
  formatRate,
  formatTokens,
  modelName,
  projectName,
  sourceName,
} from "../format.js";
import { summarize } from "../stats.js";
import type { Tracker } from "../tracker.js";
import type { Session } from "../types.js";

const HEADERS = ["TOOL", "PROJECT", "MODEL", "NOW", "AVERAGE", "CALLS", "OUTPUT", "CACHE", "CONTEXT"];
const RIGHT_ALIGNED = new Set([3, 4, 5, 6, 7, 8]);

interface Style {
  bold(text: string): string;
  dim(text: string): string;
  yellow(text: string): string;
}

const ansi = (code: number, reset: number) => (text: string) => `\x1b[${code}m${text}\x1b[${reset}m`;
export const colors: Style = { bold: ansi(1, 22), dim: ansi(2, 22), yellow: ansi(33, 39) };
export const plain: Style = { bold: (t) => t, dim: (t) => t, yellow: (t) => t };

/** Renders active sessions as a table. */
export function render(sessions: Session[], now: number, style: Style = plain): string {
  const visible = sessions.filter((session) => session.calls.length > 0 || session.pendingSince !== undefined);
  if (!visible.length) return style.dim("No active Claude Code or Codex sessions.\n");

  const rows = visible.map((session) => {
    const s = summarize(session, now);
    const context = s.contextTokens === undefined ? "—" : formatTokens(s.contextTokens);
    return [
      sourceName(session.source),
      projectName(session),
      modelName(session),
      s.pendingMs === undefined ? formatRate(s.lastRate) : `● ${formatDuration(s.pendingMs)}`,
      formatRate(s.averageRate),
      String(s.calls),
      formatTokens(s.outputTokens),
      formatPercent(s.cacheHitRate),
      s.contextUsed === undefined ? context : `${context} ${formatPercent(s.contextUsed)}`,
    ];
  });

  const widths = HEADERS.map((header, i) => Math.max(header.length, ...rows.map((row) => row[i]?.length ?? 0)));
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (RIGHT_ALIGNED.has(i) ? cell.padStart(widths[i] ?? 0) : cell.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();

  const body = rows.map((row) => {
    const text = line(row);
    return row[3]?.startsWith("●") ? style.yellow(text) : text;
  });
  const note =
    "NOW: speed of the latest reply, or ● time waited for the current one. Speeds include time to first token.";
  return [style.bold(line(HEADERS)), ...body, "", style.dim(note), ""].join("\n");
}

/** Redraws the table until interrupted. */
export async function live(tracker: Tracker, intervalMs: number): Promise<void> {
  const out = process.stdout;
  const style = process.env.NO_COLOR ? plain : colors;
  out.write("\x1b[?1049h\x1b[?25l"); // alternate screen, hide cursor
  const exit = () => {
    out.write("\x1b[?25h\x1b[?1049l");
    process.exit(0);
  };
  process.once("SIGINT", exit);
  process.once("SIGTERM", exit);

  for (;;) {
    const now = Date.now();
    const table = render(await tracker.poll(now), now, style);
    const header = `${style.bold("llm-vitals")} ${style.dim(`· ${new Date(now).toLocaleTimeString()} · Ctrl+C to quit`)}`;
    // Overwrite in place to avoid flicker: clear each line's tail, then the rest.
    out.write(`\x1b[H${[header, "", ...table.split("\n")].join("\x1b[K\n")}\x1b[J`);
    await sleep(intervalMs);
  }
}
