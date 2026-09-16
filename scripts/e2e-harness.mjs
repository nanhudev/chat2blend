#!/usr/bin/env node
/**
 * Harness end-to-end test (agent's point of view).
 *
 *   WorkBuddy/Codex (harness)
 *     -> POST /api/harness/tasks   (submit a natural-language task)
 *     -> GET  /api/harness/tasks/:id  (poll compact status, never the code)
 *     -> bridge -> visible Blender GUI -> geometry
 *
 * The chunks are still fed with a delay to prove streaming execution.
 *
 * Usage: node scripts/e2e-harness.mjs [chunkFile] [gapMs] [task]
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { parseC2BChunks } = require("../dist/packages/chunk-parser/src/index.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const HTTP_PORT = 8787;
const BLENDER_PORT = 8788;
const STATE_DIR = path.join(ROOT, ".state", "harness-e2e");
const TOKEN = "e2e-token-do-not-use-in-prod";

const BLENDER_EXE =
  process.env.C2B_BLENDER_EXE || path.join(ROOT, "_tools", "blender-4.2.9-windows-x64", "blender.exe");
const CHUNKS_FILE = process.argv[2] || path.join(ROOT, "examples", "sofa_chunks.py");
const GAP_MS = Number(process.argv[3] ?? 1200);
const TASK = process.argv[4] || "a modern three-seat fabric sofa with rounded cushions";

const DONE_MARKER = path.join(ROOT, ".state", "harness_done");
const REPORT = path.join(ROOT, ".state", "harness_probe.json");
const SHOT = path.join(ROOT, ".state", "harness_probe.png");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanupStale() {
  for (const f of [DONE_MARKER, REPORT, SHOT]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

async function api(pathname, init = {}) {
  const res = await fetch(`http://127.0.0.1:${HTTP_PORT}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", "x-c2b-token": TOKEN, ...(init.headers || {}) },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `http ${res.status}`);
  return json;
}

async function waitFor(predicate, timeoutMs, label, interval = 200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(interval);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function main() {
  cleanupStale();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(path.join(ROOT, ".state"), { recursive: true });

  console.log("[harness-e2e] starting bridge...");
  const bridge = spawn(process.execPath, [path.join(ROOT, "dist", "apps", "bridge", "src", "server.js")], {
    env: {
      ...process.env,
      C2B_STATE_DIR: STATE_DIR,
      C2B_HTTP_PORT: String(HTTP_PORT),
      C2B_BLENDER_PORT: String(BLENDER_PORT),
      C2B_TOKEN: TOKEN,
      C2B_LOG: "debug",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const bridgeLog = [];
  bridge.stdout.on("data", (d) => bridgeLog.push(d.toString()));
  bridge.stderr.on("data", (d) => bridgeLog.push(d.toString()));

  try {
    await waitFor(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/health`);
        return r.ok;
      } catch {
        return false;
      }
    }, 10000, "bridge health");
    console.log("[harness-e2e] bridge up");

    // 1) The agent submits a natural-language task. It writes no bpy code.
    const created = await api("/api/harness/tasks", { method: "POST", body: JSON.stringify({ task: TASK }) });
    const jobId = created.jobId;
    console.log(`[harness-e2e] task submitted: job=${jobId} provider=${created.provider}`);
    console.log(`[harness-e2e] generated prompt: ${created.prompt.length} chars`);

    const pending = await api("/api/harness/pending");
    console.log(`[harness-e2e] pending queue: ${pending.tasks.length} task(s) awaiting the browser extension`);
    if (!pending.tasks.some((t) => t.jobId === jobId)) throw new Error("task missing from pending queue");

    console.log("[harness-e2e] launching Blender GUI:", BLENDER_EXE);
    const blender = spawn(BLENDER_EXE, ["--python", path.join(ROOT, "tests", "blender", "gui_probe.py")], {
      env: {
        ...process.env,
        C2B_PROBE_OUT: REPORT,
        C2B_PROBE_SHOT: SHOT,
        C2B_PROBE_DONE: DONE_MARKER,
        C2B_PROBE_MAX: "180",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const blenderLog = [];
    blender.stdout.on("data", (d) => blenderLog.push(d.toString()));
    blender.stderr.on("data", (d) => blenderLog.push(d.toString()));

    await waitFor(async () => (await api("/api/status")).blender.connected, 60000, "blender add-on to connect", 500);
    const st = await api("/api/status");
    console.log(`[harness-e2e] blender connected: Blender ${st.blender.blenderVersion}, addon ${st.blender.addonVersion}`);

    // 2) Mark the prompt delivered (browser extension would do this)
    await api(`/api/harness/pending/${jobId}/ack`, { method: "POST", body: "{}" });

    // 3) The web LLM "generates" C2B chunks; the extension forwards each one.
    let rawChunks = parseC2BChunks(fs.readFileSync(CHUNKS_FILE, "utf8"));
    console.log(`[harness-e2e] ${rawChunks.length} chunks to stream`);

    for (const c of rawChunks) {
      const payload = { name: c.name, index: c.index, code: c.code, hash: c.hash, final: c.index === rawChunks.length - 1 };
      await api(`/api/jobs/${jobId}/chunks`, { method: "POST", body: JSON.stringify(payload) });
      const s = await api(`/api/harness/tasks/${jobId}`);
      console.log(`[harness-e2e]   chunk ${c.name} -> agent sees: ${s.executedCount}/${s.chunkCount} executed (status=${s.status})`);
      if (GAP_MS > 0) await sleep(GAP_MS);
    }
    await api(`/api/jobs/${jobId}/control`, { method: "POST", body: JSON.stringify({ action: "complete" }) });

    // 4) The agent polls compact status only.
    await waitFor(async () => {
      const s = await api(`/api/harness/tasks/${jobId}`);
      return s.status === "completed" || s.status === "failed" || s.status === "paused";
    }, 60000, "job to finish");

    const final = await api(`/api/harness/tasks/${jobId}`);
    console.log("\n===== AGENT VIEW =====");
    console.log(JSON.stringify(final, null, 2));

    fs.writeFileSync(DONE_MARKER, String(Date.now()));
    await waitFor(() => fs.existsSync(REPORT), 60000, "blender report", 300);
    await sleep(500);
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));

    console.log("\n===== BLENDER REPORT =====");
    console.log(`ok=${report.ok} reason=${report.reason} objects=${report.object_count} elapsed=${report.elapsed_s}s`);
    console.log("objects:", report.objects.map((o) => o.name).join(", "));
    if (report.screenshot) console.log("screenshot:", report.screenshot);

    const ok = report.ok && report.object_count > 0 && final.status === "completed";
    console.log(`\n[harness-e2e] RESULT: ${ok ? "PASS" : "FAIL"}`);

    try {
      blender.kill();
    } catch {
      /* ignore */
    }
    if (!ok) process.exitCode = 1;
  } catch (err) {
    console.error("[harness-e2e] FAILED:", err.message);
    console.error("--- bridge log ---");
    console.error(bridgeLog.join("").slice(-3000));
    process.exitCode = 1;
  } finally {
    try {
      bridge.kill();
    } catch {
      /* ignore */
    }
  }
}

main();
