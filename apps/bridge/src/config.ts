import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";

export const VERSION = "0.1.0";

export const DEFAULT_HTTP_PORT = 8787;
export const DEFAULT_BLENDER_PORT = 8788;

/** Loopback only. Binding to 0.0.0.0 is never allowed in v1. */
export const HOST = "127.0.0.1";

export interface BridgeConfig {
  httpPort: number;
  blenderPort: number;
  host: string;
  stateDir: string;
  token: string;
  verbose: boolean;
}

export interface BridgeStateFile {
  pid: number;
  token: string;
  httpPort: number;
  blenderPort: number;
  startedAt: number;
  version: string;
}

export function defaultStateDir(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "chat2blend");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "chat2blend");
  }
  return path.join(os.homedir(), ".config", "chat2blend");
}

export function stateFile(stateDir: string = defaultStateDir()): string {
  return path.join(stateDir, "bridge.json");
}

export function logFile(stateDir: string = defaultStateDir()): string {
  return path.join(stateDir, "bridge.log");
}

export function newToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function ensureStateDir(dir: string = defaultStateDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readState(dir: string = defaultStateDir()): BridgeStateFile | undefined {
  try {
    const raw = fs.readFileSync(stateFile(dir), "utf8");
    return JSON.parse(raw) as BridgeStateFile;
  } catch {
    return undefined;
  }
}

export function writeState(state: BridgeStateFile, dir: string = defaultStateDir()): void {
  ensureStateDir(dir);
  fs.writeFileSync(stateFile(dir), JSON.stringify(state, null, 2), "utf8");
}

export function clearState(dir: string = defaultStateDir()): void {
  try {
    fs.unlinkSync(stateFile(dir));
  } catch {
    /* ignore */
  }
}

export function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function resolveConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    httpPort: overrides.httpPort ?? DEFAULT_HTTP_PORT,
    blenderPort: overrides.blenderPort ?? DEFAULT_BLENDER_PORT,
    host: HOST,
    stateDir: overrides.stateDir ?? defaultStateDir(),
    token: overrides.token ?? newToken(),
    verbose: overrides.verbose ?? process.env.C2B_LOG === "debug",
  };
}

export function httpBase(cfg: Pick<BridgeConfig, "httpPort">): string {
  return `http://127.0.0.1:${cfg.httpPort}`;
}
