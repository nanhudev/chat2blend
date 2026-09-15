import { sha256 } from "./hash.js";

export interface ParsedFence {
  language: string;
  code: string;
  index: number;
  startOffset: number;
  hash: string;
}

/**
 * Streaming-safe markdown fence parser (Mode B - generic Python).
 *
 * Emits a fence only once its *closing* fence line has been fully received
 * (terminated by a newline), so a partially streamed "``" never truncates code.
 */
export class MarkdownFenceStream {
  private text = "";
  private scannedTo = 0;
  private index = 0;
  private fenceStr: string | null = null;
  private language = "";
  private codeStart = 0;
  private emitted = new Set<string>();

  reset(): void {
    this.text = "";
    this.scannedTo = 0;
    this.index = 0;
    this.fenceStr = null;
    this.language = "";
    this.codeStart = 0;
    this.emitted.clear();
  }

  push(fullText: string): ParsedFence[] {
    if (!fullText.startsWith(this.text)) this.reset();
    this.text = fullText;
    return this.scan(false);
  }

  /** Generation finished/stopped: accept a closing fence without trailing newline. */
  flush(): ParsedFence[] {
    return this.scan(true);
  }

  private scan(final: boolean): ParsedFence[] {
    const out: ParsedFence[] = [];
    const text = this.text;
    const len = text.length;

    while (this.scannedTo < len) {
      const nl = text.indexOf("\n", this.scannedTo);
      const isLastLine = nl === -1;
      if (isLastLine && !final) break;
      const lineEnd = isLastLine ? len : nl;
      const line = text.slice(this.scannedTo, lineEnd);

      if (this.fenceStr === null) {
        const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
        if (open) {
          this.fenceStr = open[2];
          this.language = (open[3] || "").trim().toLowerCase();
          this.codeStart = lineEnd + 1;
        }
      } else {
        const marker = this.fenceStr[0];
        const trimmed = line.trim();
        const isClosing =
          trimmed.length >= this.fenceStr.length &&
          trimmed.split("").every((c) => c === marker) &&
          new RegExp(`^\\s*\\${marker}{${this.fenceStr.length},}\\s*$`).test(line);

        if (isClosing) {
          const code = text.slice(this.codeStart, this.scannedTo).replace(/\s+$/, "");
          if (code.trim().length > 0) {
            const hash = sha256(code.trim() + "\n" + this.language + "\n" + this.index);
            if (!this.emitted.has(hash)) {
              this.emitted.add(hash);
              out.push({ language: this.language, code: code.trim(), index: this.index++, hash, startOffset: this.codeStart });
            }
          }
          this.fenceStr = null;
          this.language = "";
        }
      }

      if (isLastLine) {
        this.scannedTo = len;
        break;
      }
      this.scannedTo = nl + 1;
    }
    return out;
  }
}

export function isPythonLike(language: string): boolean {
  return language === "python" || language === "py" || language === "bpy" || language === "";
}

/** One-shot helper for complete markdown. */
export function extractFences(markdown: string): ParsedFence[] {
  const stream = new MarkdownFenceStream();
  const a = stream.push(markdown);
  const b = stream.flush();
  return [...a, ...b];
}

/** Complete markdown -> python blocks only, in document order. */
export function extractPythonBlocks(markdown: string): string[] {
  return extractFences(markdown).filter((f) => isPythonLike(f.language)).map((f) => f.code);
}
