import { defaultDirs, findSessionFiles, parsers, type SourceDirs } from "./sources/index.js";
import { LineTail } from "./tail.js";
import type { Parser, Session } from "./types.js";

export interface TrackerOptions {
  dirs?: SourceDirs;
  /** Sessions with no log activity for this long are dropped. Default: 1 hour. */
  activeWindowMs?: number;
  /** How often to look for new session files. Default: 5 seconds. */
  discoverEveryMs?: number;
}

interface Tracked {
  tail: LineTail;
  parser: Parser;
}

/** Follows every active session file and keeps its {@link Session} up to date. */
export class Tracker {
  readonly #dirs: SourceDirs;
  readonly #activeWindowMs: number;
  readonly #discoverEveryMs: number;
  readonly #tracked = new Map<string, Tracked>();
  #lastDiscovery = Number.NEGATIVE_INFINITY;

  constructor(options: TrackerOptions = {}) {
    this.#dirs = options.dirs ?? defaultDirs();
    this.#activeWindowMs = options.activeWindowMs ?? 3_600_000;
    this.#discoverEveryMs = options.discoverEveryMs ?? 5_000;
  }

  /** Reads new log lines and returns active sessions, most recently updated first. */
  async poll(now = Date.now()): Promise<Session[]> {
    const since = now - this.#activeWindowMs;
    if (now - this.#lastDiscovery >= this.#discoverEveryMs) {
      this.#lastDiscovery = now;
      for (const { source, file } of await findSessionFiles(this.#dirs, since)) {
        if (!this.#tracked.has(file)) {
          this.#tracked.set(file, { tail: new LineTail(file), parser: parsers[source](file) });
        }
      }
    }

    await Promise.all(
      [...this.#tracked].map(async ([file, { tail, parser }]) => {
        try {
          await tail.read((line, cut) => parser.push(line, cut));
        } catch {
          this.#tracked.delete(file); // removed or unreadable
        }
      }),
    );

    const sessions: Session[] = [];
    for (const [file, { parser }] of this.#tracked) {
      if (parser.session.updatedAt < since) this.#tracked.delete(file);
      else sessions.push(parser.session);
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
