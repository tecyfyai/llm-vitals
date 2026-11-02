import { basename } from "node:path";
import type { Session, Source } from "./types.js";

const SOURCE_NAMES: Record<Source, string> = { claude: "Claude Code", codex: "Codex" };

export function sourceName(source: Source): string {
  return SOURCE_NAMES[source];
}

/** The session's folder name, safe to display. */
export function projectName(session: Session): string {
  return session.cwd ? displayText(basename(session.cwd)) : "—";
}

/** The session's model, safe to display. */
export function modelName(session: Session): string {
  return session.model ? displayText(session.model) : "—";
}

/**
 * Text read from logs, made safe to print: control characters (which could carry terminal
 * escape sequences) and bidirectional overrides are removed, and long values are cut short.
 */
export function displayText(value: string, maxLength = 48): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point.
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

/** 950 → "950", 41_230 → "41.2k", 1_200_000 → "1.2M". */
export function formatTokens(tokens: number): string {
  // Compared after rounding, so 999.6 is "1.0k", not "1000", and 999_960 is "1.0M", not "1000.0k".
  if (tokens < 999.5) return String(Math.round(tokens));
  if (tokens < 999_950) return `${(tokens / 1000).toFixed(1)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function formatRate(rate: number | undefined): string {
  return rate === undefined ? "—" : `${Math.round(rate)} tok/s`;
}

/** 0.413 → "41%". */
export function formatPercent(share: number | undefined): string {
  return share === undefined ? "—" : `${Math.round(share * 100)}%`;
}

/** 4_200 → "4s", 65_000 → "1m 05s". */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
