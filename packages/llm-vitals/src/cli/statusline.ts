import { formatDuration, formatRate } from "../format.js";
import { claudeParser } from "../sources/claude.js";
import { summarize } from "../stats.js";
import { readLastLines } from "../tail.js";
import type { Session } from "../types.js";

/** Enough of the transcript tail to cover recent requests without reading huge files. */
const TRANSCRIPT_TAIL_BYTES = 2 * 1024 * 1024;

/** The fields used from Claude Code's status line input. */
export interface StatusInput {
  transcript_path?: string;
  context_window?: { used_percentage?: number | null };
}

/** e.g. "⚡ 62 tok/s · avg 55 tok/s · ctx 41%". */
export function formatStatusline(input: StatusInput, session: Session | undefined, now = Date.now()): string {
  const summary = session ? summarize(session, now) : undefined;
  const parts = [
    summary?.pendingMs === undefined
      ? `⚡ ${formatRate(summary?.lastRate)}`
      : `⏳ ${formatDuration(summary.pendingMs)}`,
  ];
  if (summary?.averageRate !== undefined) parts.push(`avg ${formatRate(summary.averageRate)}`);
  const used = input.context_window?.used_percentage;
  if (typeof used === "number") parts.push(`ctx ${Math.round(used)}%`);
  return parts.join(" · ");
}

export async function loadTranscript(path: string): Promise<Session | undefined> {
  const parser = claudeParser(path);
  const lines = await readLastLines(path, TRANSCRIPT_TAIL_BYTES).catch(() => []);
  for (const line of lines) parser.push(line);
  return lines.length ? parser.session : undefined;
}

/**
 * Reads Claude Code's status line JSON from stdin and prints one line.
 * Never fails: on any error it prints a placeholder, so the status bar is never left broken.
 */
export async function statusline(): Promise<void> {
  let line: string;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as StatusInput;
    const session = input.transcript_path ? await loadTranscript(input.transcript_path) : undefined;
    line = formatStatusline(input, session);
  } catch {
    line = formatStatusline({}, undefined);
  }
  process.stdout.write(`${line}\n`);
}
