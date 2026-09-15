import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { clearState, defaultStateDir, pidAlive, readState, type BridgeStateFile } from "./config.js";

export function serverEntry(): string {
  // dist/apps/bridge/src/daemon.js -> dist/apps/bridge/src/server.js
  return path.join(__dirname, "server.js");
}

export function isRunning(stateDir = defaultStateDir()): BridgeStateFile | undefined {
  const state = readState(stateDir);
  if (!state) return undefined;
  if (!pidAlive(state.pid)) {
    clearState(stateDir);
    return undefined;
  }
  return state;
}

export function startDaemon(stateDir = defaultStateDir(), opts: { httpPort?: number; blenderPort?: number } = {}): { pid: number } {
  const child = spawn(process.execPath, [serverEntry()], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      C2B_STATE_DIR: stateDir,
      ...(opts.httpPort ? { C2B_HTTP_PORT: String(opts.httpPort) } : {}),
      ...(opts.blenderPort ? { C2B_BLENDER_PORT: String(opts.blenderPort) } : {}),
    },
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid ?? 0 };
}

export function stopDaemon(stateDir = defaultStateDir()): boolean {
  const state = readState(stateDir);
  if (!state) return false;
  try {
    process.kill(state.pid);
  } catch {
    /* already gone */
  }
  clearState(stateDir);
  return true;
}

/** Wait until the bridge answers /health (or give up). */
export async function waitForHealth(port: number, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

export function tailLog(stateDir = defaultStateDir(), n = 30): string[] {
  const file = path.join(stateDir, "bridge.log");
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw.trim().split(/\r?\n/).slice(-n);
  } catch {
    return [];
  }
}

export { defaultStateDir };
