import { type FileHandle, open, stat } from "node:fs/promises";

const NEWLINE = 0x0a;
/** Files are read this much at a time, so memory use stays flat however large a log grows. */
const CHUNK_BYTES = 1024 * 1024;
/**
 * Lines longer than this are passed on cut down to their first `HEAD_BYTES`. In both tools'
 * logs such lines hold tool output, pasted files or request bodies; every line carrying usage
 * figures is far smaller. Cutting them keeps multi-megabyte strings out of memory.
 */
const LONG_LINE_BYTES = 256 * 1024;
const HEAD_BYTES = 4 * 1024;

/** Receives one line. `cut` is true when only the line's opening bytes are given. */
export type LineHandler = (line: string, cut: boolean) => void;

/** Reads a growing file, passing on only the complete lines added since the last read. */
export class LineTail {
  #offset = 0;

  constructor(readonly file: string) {}

  /** Calls `onLine` for each new complete line, in order. */
  async read(onLine: LineHandler): Promise<void> {
    const { size } = await stat(this.file);
    if (size < this.#offset) this.#offset = 0; // truncated or replaced
    if (size === this.#offset) return;
    const handle = await open(this.file, "r");
    try {
      this.#offset = await readLines(handle, this.#offset, size, onLine);
    } finally {
      await handle.close();
    }
  }
}

/** The complete lines in the last `maxBytes` of a file, leaving out cut long lines. */
export async function readLastLines(file: string, maxBytes: number): Promise<string[]> {
  const { size } = await stat(file);
  const from = Math.max(0, size - maxBytes);
  const lines: string[] = [];
  const handle = await open(file, "r");
  try {
    let first = from > 0; // the first line may start mid-line
    await readLines(handle, from, size, (line, cut) => {
      if (!first && !cut) lines.push(line);
      first = false;
    });
  } finally {
    await handle.close();
  }
  return lines;
}

/**
 * Passes each complete, non-blank line in `[from, to)` to `onLine` and returns the offset
 * just after the last complete line, where the next read should start.
 */
async function readLines(handle: FileHandle, from: number, to: number, onLine: LineHandler): Promise<number> {
  const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, to - from));
  // The start of a line that runs on into the next chunk, kept up to LONG_LINE_BYTES + 1.
  let carry: Buffer[] = [];
  let carryBytes = 0;
  let lineBytes = 0;
  let position = from;
  let consumed = from;

  const emit = (parts: Buffer[], bytes: number) => {
    const cut = bytes > LONG_LINE_BYTES;
    const line = Buffer.concat(parts, cut ? HEAD_BYTES : bytes).toString("utf8");
    if (line.trim() !== "") onLine(line, cut);
  };

  while (position < to) {
    const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, to - position), position);
    if (bytesRead === 0) break;
    const data = chunk.subarray(0, bytesRead);
    let start = 0;
    for (let newline = data.indexOf(NEWLINE); newline !== -1; newline = data.indexOf(NEWLINE, start)) {
      const piece = data.subarray(start, newline);
      if (carry.length) {
        emit([...carry, piece.subarray(0, Math.max(0, LONG_LINE_BYTES + 1 - carryBytes))], lineBytes + piece.length);
      } else {
        emit([piece], piece.length);
      }
      carry = [];
      carryBytes = 0;
      lineBytes = 0;
      start = newline + 1;
      consumed = position + start;
    }
    if (start < bytesRead) {
      const rest = data.subarray(start);
      lineBytes += rest.length;
      const room = LONG_LINE_BYTES + 1 - carryBytes;
      if (room > 0) {
        const kept = Buffer.from(rest.subarray(0, room)); // a copy: `chunk` is reused
        carry.push(kept);
        carryBytes += kept.length;
      }
    }
    position += bytesRead;
  }
  return consumed;
}
