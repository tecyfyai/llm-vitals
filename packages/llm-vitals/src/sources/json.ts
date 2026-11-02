/** Parses one JSONL line; returns undefined for blank or malformed lines. */
export function parseLine<T>(line: string): T | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === "object" ? (value as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Epoch ms from an ISO timestamp, or NaN. */
export function toTime(timestamp: string | undefined): number {
  return timestamp ? Date.parse(timestamp) : Number.NaN;
}

/** A finite number, or 0. */
export function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
