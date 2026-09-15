#!/usr/bin/env node
/**
 * Real end-to-end test:
 *   bridge (node)  ->  visible Blender GUI  ->  geometry in the scene
 *
 * The C2B chunks are fed with a delay so we can prove *streaming* execution:
 * Blender must already be executing earlier chunks while later ones are still
 * "being generated" by the driver.
 *
 * Usage: node scripts/e2e-blender.mjs [chunkFile] [gapMs]
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { parseC2BChunks } = require("../dist/packages/chunk-parser/src/index.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const HTTP_PORT = 8787;
const BLENDER_PORT = 8788;
const STATE_DIR = path.join(ROOT, ".state", "e2e");
const TOKEN = "e2e-token-do-not-use-in-prod";

const BLENDER_EXE = process.env.C2B_BLENDER_EXE || path.join(ROOT, "_tools", "blender-4.2.9-windows-x64", "blender.exe");
const CHUNKS_FILE = process.argv[2] || path.join(ROOT, "examples", "sofa_chunks.py");
const GAP_MS = Number(process.argv[3] ?? 1500);

const DONE_MARKER = path.join(ROOT, ".state", "gui_done");
const REPORT = path.join(ROOT, ".state", "gui_probe.json");
const SHOT = path.join(ROOT, ".state", "gui_probe.png");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanupStale() {
  for (const f of [DONE_MARKER, REPORT, SHOT]) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

async function api(pathname, init = {}, port = HTTP_PORT) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
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

  console.log("[e2e] starting bridge...");
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
  bridge.stdout.on("data", (d) => { bridgeLog.push(d.toString()); });
  bridge.stderr.on("data", (d) => { bridgeLog.push(d.toString()); });

  try {
    await waitFor(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${HTTP_PORT}/health`);
        return r.ok;
      } catch { return false; }
    }, 10000, "bridge health");
    console.log("[e2e] bridge up");

    console.log("[e2e] launching Blender GUI:", BLENDER_EXE);
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
    console.log(`[e2e] blender connected: Blender ${st.blender.blenderVersion}, addon ${st.blender.addonVersion}`);

    // ---- feed chunks like a streaming LLM would ----
    let rawChunks = parseC2BChunks(fs.readFileSync(CHUNKS_FILE, "utf8"));
    if (!rawChunks.length) {
      // generic python file: one chunk, Mode B
      const code = fs.readFileSync(CHUNKS_FILE, "utf8").trim();
      rawChunks = [{ name: path.basename(CHUNKS_FILE, ".py"), index: 0, code, hash: crypto.createHash("sha256").update(code).digest("hex") }];
    }
    console.log(`[e2e] ${rawChunks.length} chunks parsed from ${path.basename(CHUNKS_FILE)}`);

    const job = await api("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ provider: "chatgpt", title: path.basename(CHUNKS_FILE), mode: "protocol" }),
    });
    const jobId = job.jobId;
    const t0 = Date.now();

    for (const c of rawChunks) {
      const payload = {
        name: c.name,
        index: c.index,
        code: c.code,
        hash: c.hash,
        final: c.index === rawChunks.length - 1,
      };
      const post = await api(`/api/jobs/${jobId}/chunks`, { method: "POST", body: JSON.stringify(payload) });
      console.log(`[e2e]   -> chunk ${c.name} (${c.code.length} chars) duplicate=${post.duplicate}`);
      // re-post the same chunk: dedupe must hold
      await api(`/api/jobs/${jobId}/chunks`, { method: "POST", body: JSON.stringify(payload) });
      if (GAP_MS > 0) await sleep(GAP_MS);
    }
    await api(`/api/jobs/${jobId}/control`, { method: "POST", body: JSON.stringify({ action: "complete" }) });

    await waitFor(async () => {
      const j = await api(`/api/jobs/${jobId}`);
      return j.job.status === "completed" || j.job.status === "failed" || j.job.status === "paused";
    }, 60000, "job to finish");

    const final = await api(`/api/jobs/${jobId}`);
    const ttff = final.job.timing.firstChunkExecutedAt
      ? ((final.job.timing.firstChunkExecutedAt - final.job.timing.createdAt) / 1000).toFixed(2)
      : "n/a";
    console.log(`[e2e] job ${jobId} status=${final.job.status} chunks=${final.job.chunks.length} ttff=${ttff}s`);
    final.job.chunks.forEach((c) =>
      console.log(`[e2e]   ${c.status.padEnd(10)} ${c.name} ${c.durationMs ?? ""}ms ${c.error ? "ERR: " + c.error.split("\n")[0] : ""}`),
    );

    // tell the in-Blender probe to capture + report
    fs.writeFileSync(DONE_MARKER, String(Date.now()));

    await waitFor(() => fs.existsSync(REPORT), 60000, "blender report", 300);
    await sleep(500);
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));

    console.log("\n===== BLENDER REPORT =====");
    console.log(`ok=${report.ok} reason=${report.reason} objects=${report.object_count} elapsed=${report.elapsed_s}s`);
    console.log("objects:", report.objects.map((o) => o.name).join(", "));
    console.log("chunks:", report.chunks.map((c) => `${c.name}:${c.status}`).join(", "));
    if (report.screenshot) console.log("screenshot:", report.screenshot);

    const ok = report.ok && report.object_count > 0 && final.job.status === "completed";
    console.log(`\n[e2e] RESULT: ${ok ? "PASS" : "FAIL"}`);

    try { blender.kill(); } catch { /* ignore */ }
    if (!ok) process.exitCode = 1;
  } catch (err) {
    console.error("[e2e] FAILED:", err.message);
    console.error("--- bridge log ---");
    console.error(bridgeLog.join("").slice(-3000));
    process.exitCode = 1;
  } finally {
    try { bridge.kill(); } catch { /* ignore */ }
  }
}

main();
