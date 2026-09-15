import { C2B_CHUNK_END, C2B_CHUNK_START, C2B_MODE } from "../../protocol/src/index.js";
import { sha256 } from "./hash.js";

export interface ParsedChunk {
  name: string;
  index: number;
  code: string;
  hash: string;
  /** byte offset where the chunk body starts (useful for dedupe/debug) */
  startOffset: number;
}

export interface ParseResult {
  chunks: ParsedChunk[];
  /** chunk currently being streamed (not closed yet) */
  pending?: { name: string; index: number };
  /** true while we are inside a `# C2B:CHUNK` block */
  insideChunk: boolean;
  /** true if the text explicitly declared a mode (CREATE / PATCH) */
  mode?: string;
}

/**
 * Streaming-safe parser for the C2B protocol:
 *
 *   # C2B:CHUNK <name>
 *   ...python...
 *   # C2B:END
 *
 * The parser is fed the **full** text of the assistant message on every DOM
 * mutation (never deltas), which makes it immune to dropped or duplicated
 * mutation events. Only *complete lines* are consumed, so a marker that is
 * still being streamed (`# C2B:CH` -> `# C2B:CHUNK setup`) is never misread.
 *
 * Invariants:
 *  - a chunk is emitted at most once per (name, code) hash
 *  - incomplete trailing content is never emitted
 */
export class C2BChunkStream {
  private text = "";
  /** offset up to which all *complete* lines have been consumed */
  private scannedTo = 0;
  private index = 0;
  private currentName: string | null = null;
  private currentStart = 0;
  private emitted = new Set<string>();
  private mode: string | undefined;
  private lastResult: ParseResult = { chunks: [], insideChunk: false };

  reset(): void {
    this.text = "";
    this.scannedTo = 0;
    this.index = 0;
    this.currentName = null;
    this.currentStart = 0;
    this.emitted.clear();
    this.mode = undefined;
    this.lastResult = { chunks: [], insideChunk: false };
  }

  /** Feed the full accumulated message text. Returns newly completed chunks. */
  push(fullText: string): ParseResult {
    // A replaced/shrunk text means the assistant response was regenerated or
    // edited: the caller must start a new job, we start from scratch.
    if (!fullText.startsWith(this.text)) {
      this.reset();
    }
    this.text = fullText;
    return this.scan(false);
  }

  /**
   * Called when generation finished (or was stopped). Emits a trailing marker
   * that lacks its newline and discards any incomplete chunk body.
   */
  flush(): ParseResult {
    return this.scan(true);
  }

  private scan(final: boolean): ParseResult {
    const chunks: ParsedChunk[] = [];
    const text = this.text;
    const len = text.length;

    while (this.scannedTo < len) {
      const nl = text.indexOf("\n", this.scannedTo);
      const isLastLine = nl === -1;
      const lineEnd = isLastLine ? len : nl;
      const line = text.slice(this.scannedTo, lineEnd);

      if (isLastLine && !final) {
        // partial line, wait for more input
        break;
      }

      const startMatch = C2B_CHUNK_START.exec(line);
      const endMatch = C2B_CHUNK_END.exec(line);
      const modeMatch = C2B_MODE.exec(line);

      if (modeMatch && this.currentName === null) {
        this.mode = modeMatch[1];
      }

      if (this.currentName === null) {
        if (startMatch) {
          this.currentName = startMatch[1];
          this.currentStart = lineEnd + 1;
        }
      } else if (endMatch && !insideTripleQuotedString(text.slice(this.currentStart, this.scannedTo))) {
        const name = this.currentName;
        const code = text.slice(this.currentStart, this.scannedTo);
        const trimmed = code.trim();
        if (trimmed.length > 0) {
          const hash = sha256(trimmed + "\n" + name + "\n" + this.index);
          if (!this.emitted.has(hash)) {
            this.emitted.add(hash);
            chunks.push({ name, index: this.index++, code: trimmed, hash, startOffset: this.currentStart });
          }
        }
        this.currentName = null;
        this.currentStart = 0;
      }

      if (isLastLine) {
        this.scannedTo = len;
        break;
      }
      this.scannedTo = nl + 1;
    }

    const result: ParseResult = {
      chunks,
      insideChunk: this.currentName !== null,
      ...(this.currentName !== null ? { pending: { name: this.currentName, index: this.index } } : {}),
      ...(this.mode !== undefined ? { mode: this.mode } : {}),
    };
    this.lastResult = result;
    return result;
  }

  get lastChunks(): ParsedChunk[] {
    return this.lastResult.chunks;
  }
}

/** Convenience: parse a complete (already finished) answer in one shot. */
export function parseC2BChunks(text: string): ParsedChunk[] {
  const stream = new C2BChunkStream();
  const first = stream.push(text);
  const second = stream.flush();
  return [...first.chunks, ...second.chunks];
}

/**
 * Cheap heuristic: are we currently inside a triple quoted string?
 * Only used to avoid treating a `# C2B:END` written inside a docstring as a
 * real chunk terminator.
 */
function insideTripleQuotedString(src: string): boolean {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < src.length; i++) {
    if (src.startsWith('"""', i)) {
      inDouble = !inDouble;
      i += 2;
    } else if (src.startsWith("'''", i)) {
      inSingle = !inSingle;
      i += 2;
    }
  }
  return inDouble || inSingle;
}
