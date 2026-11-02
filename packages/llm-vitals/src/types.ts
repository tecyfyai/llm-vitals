export type Source = "claude" | "codex";

/** One model request and its reply. */
export interface Call {
  id: string;
  model?: string;
  /** Epoch ms the request was sent. Unknown for some log versions. */
  start?: number;
  /** Epoch ms the last part of the reply was logged. */
  end: number;
  /** Input tokens not served from cache. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Output tokens, reasoning included. */
  outputTokens: number;
  reasoningTokens: number;
}

export interface RateLimit {
  /** Window label, e.g. "5h" or "7d". */
  label: string;
  usedPercent: number;
  /** Epoch ms the window resets. */
  resetsAt?: number;
}

export interface Session {
  source: Source;
  id: string;
  file: string;
  cwd?: string;
  model?: string;
  calls: Call[];
  /** Epoch ms of a request that has been sent and not answered yet. */
  pendingSince?: number;
  contextWindow?: number;
  rateLimits?: RateLimit[];
  /** Epoch ms of the newest log line. */
  updatedAt: number;
}

/** Turns log lines of one session file into a {@link Session}, one line at a time. */
export interface Parser {
  readonly session: Session;
  /** `cut` marks a long line given only by its opening bytes; see `LineTail`. */
  push(line: string, cut?: boolean): void;
}
