import * as fs from "node:fs";
import { logFile, ensureStateDir } from "./config.js";

type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  private readonly lines: string[] = [];
  private readonly max = 500;
  private fileEnabled = false;
  private fileDir: string;
  public level: Level = (process.env.C2B_LOG as Level) || "info";

  constructor(stateDir?: string) {
    this.fileDir = stateDir ?? "";
  }

  enableFile(stateDir: string): void {
    this.fileDir = stateDir;
    this.fileEnabled = true;
    ensureStateDir(stateDir);
  }

  private emit(level: Level, msg: string): void {
    if (ORDER[level] < ORDER[this.level]) return;
    const line = `[C2B] ${new Date().toISOString().slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${msg}`;
    this.lines.push(line);
    if (this.lines.length > this.max) this.lines.shift();
    try {
      (level === "error" ? process.stderr : process.stdout).write(line + "\n");
    } catch {
      /* ignore */
    }
    if (this.fileEnabled && this.fileDir) {
      try {
        fs.appendFileSync(logFile(this.fileDir), line + "\n", "utf8");
      } catch {
        /* ignore */
      }
    }
  }

  debug(m: string) { this.emit("debug", m); }
  info(m: string) { this.emit("info", m); }
  warn(m: string) { this.emit("warn", m); }
  error(m: string) { this.emit("error", m); }

  recent(n = 100): string[] {
    return this.lines.slice(-n);
  }
}
