#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import type { BridgeStatus, JobSummary } from "../../../packages/protocol/src/index.js";
import { buildPrompt } from "../../../packages/protocol/src/index.js";
import {
  defaultStateDir,
  httpBase,
  readState,
  VERSION,
  DEFAULT_BLENDER_PORT,
  DEFAULT_HTTP_PORT,
} from "./config.js";
import { isRunning, startDaemon, stopDaemon, tailLog, waitForHealth } from "./daemon.js";
import { discoverBlender, blenderAddonsPaths } from "./blender-discovery.js";

const STATE_DIR = process.env.C2B_STATE_DIR || defaultStateDir();

const C = {
  ok: "[ok]  ",
  no: "[!!]  ",
  wait: "[..]  ",
  info: "      ",
};

function line(s = ""): void {
  process.stdout.write(s + "\n");
}

function usage(): void {
  line(`Chat2Blend v${VERSION} - use your LLM subscription as the 3D brain, let Blender execute.
`);
  line(`Usage: c2b <command> [options]
`);
  line(`Commands:`);
  line(`  start            Start the local bridge (loopback only)`);
  line(`  stop             Stop the bridge`);
  line(`  status           Show bridge / blender / extension status`);
  line(`  doctor           Diagnose the local installation`);
  line(`  pair             Print a fresh pairing code for the browser extension`);
  line(`  jobs             List recent jobs`);
  line(`  exec <file.py>   Send a python file straight into Blender`);
  line(`  prompt <task>    Print the Chat2Blend modelling prompt for a task`);
  line(`  blender status   Show Blender discovery + connection`);
  line(`  logs             Tail the bridge log`);
  line(`  setup            Guided first-run checklist`);
  line("");
}

function parseArgs(argv: string[]): { cmd: string; args: string[]; flags: Record<string, string> } {
  const [cmd = "", ...rest] = argv;
  const args: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = "true";
    } else args.push(a);
  }
  return { cmd, args, flags };
}

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const state = readState(STATE_DIR);
  if (!state) throw new Error("bridge is not running (state file missing). Run: c2b start");
  const res = await fetch(`${httpBase(state)}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", "x-c2b-token": state.token, ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error((json as { error?: string }).error || `http ${res.status}`);
  return json;
}

function fmtAgo(ms?: number): string {
  if (ms === undefined) return "never";
  if (ms < 1000) return `${ms}ms ago`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s ago`;
  return `${Math.round(ms / 60_000)}m ago`;
}

function printStatus(s: BridgeStatus): void {
  line(`Chat2Blend v${s.version}  (protocol ${s.protocol})`);
  line("");
  line(`${s.blender.connected ? C.ok : C.no}Blender    ${s.blender.connected ? `connected  (Blender ${s.blender.blenderVersion ?? "?"}, addon ${s.blender.addonVersion ?? "?"})` : "not connected - open Blender and enable the Chat2Blend add-on"}`);
  line(`${C.ok}Bridge     running  (pid ${s.bridge.pid}, http ${s.bridge.host}:${s.bridge.httpPort}, blender tcp ${s.bridge.blenderPort}, uptime ${Math.round(s.bridge.uptimeMs / 1000)}s)`);
  line(`${s.extension.connected ? C.ok : C.no}Extension  ${s.extension.connected ? "connected" : `no heartbeat ${s.extension.lastSeenAgoMs !== undefined ? `(${fmtAgo(s.extension.lastSeenAgoMs)})` : ""}`}`);
  line("");
  line(`Stats: ${s.stats.jobsTotal} jobs, ${s.stats.chunksExecuted} chunks executed, ${s.stats.chunksFailed} failed`);
  if (s.jobs.length) {
    line("");
    line("Recent jobs:");
    for (const j of s.jobs.slice(-8).reverse()) printJobLine(j);
  }
}

function printJobLine(j: JobSummary): void {
  const ttff =
    j.timing.firstChunkExecutedAt && j.timing.createdAt
      ? ` ttff=${((j.timing.firstChunkExecutedAt - j.timing.createdAt) / 1000).toFixed(1)}s`
      : "";
  const title = j.title ? ` "${j.title}"` : "";
  line(`${C.info}${j.id}  ${j.status.padEnd(10)} ${j.provider.padEnd(9)} chunks ${j.executedCount}/${j.chunkCount}${j.failedCount ? ` failed=${j.failedCount}` : ""}${title}${ttff}`);
}

async function main(): Promise<void> {
  const { cmd, args, flags } = parseArgs(process.argv.slice(2));

  switch (cmd) {
    case "":
    case "help":
    case "-h":
    case "--help":
      usage();
      return;

    case "start": {
      const running = isRunning(STATE_DIR);
      if (running) {
        line(`${C.ok}Bridge already running (pid ${running.pid}) on http://127.0.0.1:${running.httpPort}`);
        return;
      }
      const httpPort = Number(flags["port"] ?? DEFAULT_HTTP_PORT);
      const blenderPort = Number(flags["blender-port"] ?? DEFAULT_BLENDER_PORT);
      const { pid } = startDaemon(STATE_DIR, { httpPort, blenderPort });
      const healthy = await waitForHealth(httpPort);
      if (!healthy) {
        line(`${C.no}Bridge did not become healthy. Last log lines:`);
        tailLog(STATE_DIR, 20).forEach((l) => line(C.info + l));
        process.exitCode = 1;
        return;
      }
      const state = readState(STATE_DIR);
      line(`${C.ok}Bridge running (pid ${pid})`);
      line(`${C.info}http    http://127.0.0.1:${httpPort}`);
      line(`${C.info}blender tcp://127.0.0.1:${blenderPort}`);
      line(`${C.info}state   ${path.join(STATE_DIR, "bridge.json")}`);
      line(`${C.info}pairing code: ${state ? "(run: c2b pair)" : "?"}`);
      return;
    }

    case "stop": {
      if (stopDaemon(STATE_DIR)) line(`${C.ok}Bridge stopped`);
      else line(`${C.no}Bridge was not running`);
      return;
    }

    case "status": {
      const running = isRunning(STATE_DIR);
      if (!running) {
        line(`${C.no}Bridge is not running. Start it with: c2b start`);
        process.exitCode = 1;
        return;
      }
      const s = await api<BridgeStatus>("/api/status");
      if (flags.json) line(JSON.stringify(s, null, 2));
      else printStatus(s);
      return;
    }

    case "jobs": {
      const s = await api<{ jobs: JobSummary[] }>("/api/jobs");
      if (flags.json) {
        line(JSON.stringify(s.jobs, null, 2));
        return;
      }
      if (!s.jobs.length) {
        line("No jobs yet. Ask ChatGPT for a model, or run: c2b exec examples/cube.py");
        return;
      }
      s.jobs.forEach(printJobLine);
      return;
    }

    case "pair": {
      const r = await api<{ code: string }>("/api/pair/rotate", { method: "POST", body: "{}" });
      line(`${C.ok}Pairing code: ${r.code}`);
      line(`${C.info}Open the Chat2Blend extension popup and enter it. Valid 10 minutes.`);
      return;
    }

    case "exec": {
      const target = args[0];
      if (!target) {
        line(`${C.no}Usage: c2b exec <file.py>`);
        process.exitCode = 1;
        return;
      }
      const code = target === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(target), "utf8");
      const r = await api<{ jobId: string }>("/api/exec", {
        method: "POST",
        body: JSON.stringify({ code, title: path.basename(target), provider: "cli" }),
      });
      line(`${C.ok}Sent to bridge: job ${r.jobId}`);
      return;
    }

    case "prompt": {
      const task = args.join(" ") || "a modern three-seat fabric sofa";
      line(buildPrompt(task));
      return;
    }

    case "blender": {
      const sub = args[0] ?? "status";
      const installs = discoverBlender();
      if (sub === "status") {
        if (!installs.length) line(`${C.no}No Blender installation found on this machine.`);
        else installs.forEach((b) => line(`${C.ok}Blender ${b.version ?? "?"}  ${b.path}`));
        try {
          const s = await api<BridgeStatus>("/api/status");
          line(s.blender.connected ? `${C.ok}Blender add-on connected (${s.blender.blenderVersion})` : `${C.wait}Blender found on disk but not connected - open Blender, enable Chat2Blend, click Connect`);
        } catch {
          line(`${C.wait}Bridge not running - cannot check live connection`);
        }
        return;
      }
      line(`${C.no}Unknown: c2b blender ${sub}`);
      return;
    }

    case "logs": {
      const lines = tailLog(STATE_DIR, Number(flags.n ?? 40));
      if (!lines.length) line("(no log yet)");
      lines.forEach((l) => line(l));
      return;
    }

    case "doctor": {
      await doctor();
      return;
    }

    case "setup": {
      await doctor();
      line("");
      line("Next steps:");
      line("  1. Blender: Edit > Preferences > Add-ons > Install... > dist/chat2blend-blender.zip");
      line("     (or, for development: copy blender_addon/chat2blend into Blender's scripts/addons folder)");
      line("  2. Enable 'Chat2Blend' and click Connect in the N-panel (Chat2Blend tab)");
      line("  3. Chrome/Edge: chrome://extensions > Developer mode > Load unpacked > apps/extension");
      line("  4. Run `c2b pair` and paste the 6-digit code into the extension popup");
      line("  5. Open ChatGPT, paste the prompt from `c2b prompt \"a modern sofa\"`, turn Auto Execute ON");
      return;
    }

    default:
      line(`${C.no}Unknown command: ${cmd}`);
      usage();
      process.exitCode = 1;
  }
}

async function doctor(): Promise<void> {
  line(`Chat2Blend doctor`);
  line("");

  const node = process.versions.node.split(".").map(Number);
  const nodeOk = (node[0] ?? 0) >= 20;
  line(`${nodeOk ? C.ok : C.no}Node.js ${process.versions.node} ${nodeOk ? "" : "(>= 20 required)"}`);

  const state = readState(STATE_DIR);
  const running = isRunning(STATE_DIR);
  line(`${running ? C.ok : C.no}Bridge ${running ? `running (pid ${running.pid})` : "not running - run: c2b start"}`);

  if (running) {
    line(`${C.ok}Token present: ${state?.token ? "yes" : "no"}`);
    try {
      const s = await api<BridgeStatus>("/api/status");
      line(`${C.ok}HTTP API reachable on 127.0.0.1:${s.bridge.httpPort} (loopback only)`);
      line(`${s.blender.connected ? C.ok : C.no}Blender transport ${s.blender.connected ? `connected (Blender ${s.blender.blenderVersion})` : "no add-on connected"}`);
      line(`${s.extension.connected ? C.ok : C.no}Extension heartbeat ${s.extension.connected ? "recent" : "none (open ChatGPT with the extension installed)"}`);
    } catch (err) {
      line(`${C.no}HTTP API error: ${(err as Error).message}`);
    }
  }

  const installs = discoverBlender();
  line(`${installs.length ? C.ok : C.no}Blender installations found: ${installs.length}`);
  installs.forEach((b) => line(`${C.info}- ${b.version ?? "?"}  ${b.path}`));

  const addonPaths = blenderAddonsPaths();
  line(`${addonPaths.length ? C.ok : C.wait}Blender add-on folders: ${addonPaths.length ? addonPaths.join(", ") : "none detected (install Blender once, or install the add-on manually)"}`);

  const extDist = path.resolve(__dirname, "..", "..", "..", "extension", "dist", "manifest.json");
  line(`${fs.existsSync(extDist) ? C.ok : C.no}Extension build ${fs.existsSync(extDist) ? "present (apps/extension/dist)" : "missing - run: npm run build:extension"}`);

  const addonSrc = path.resolve(__dirname, "..", "..", "..", "..", "blender_addon", "chat2blend", "__init__.py");
  line(`${fs.existsSync(addonSrc) ? C.ok : C.no}Blender add-on source ${fs.existsSync(addonSrc) ? "present" : "missing"}`);
}

main().catch((err) => {
  line(`${C.no}${(err as Error).message}`);
  process.exitCode = 1;
});
