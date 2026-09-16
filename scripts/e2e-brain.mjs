#!/usr/bin/env node
/**
 * Local-brain end-to-end test.
 *
 *   natural-language task
 *     -> bridge drives the LOCAL ChatGPT desktop app (CDP, no browser/extension)
 *     -> the app answers with C2B chunks
 *     -> bridge -> visible Blender GUI -> geometry
 *
 * No API key, no browser extension, no scraped web page.
 *
 * Usage: node scripts/e2e-brain.mjs ["task text"] [cdpPort]
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const HTTP_PORT = 8787;
const BLENDER_PORT = 8788;
const STATE_DIR = path.join(ROOT, ".state", "brain-e2e");
const TOKEN = "e2e-token-do-not-use-in-prod";

const BLENDER_EXE = process.env.C2B_BLENDER_EXE || path.join(ROOT, "_tools", "blender-4.2.9-windows-x64", "blender.exe");
const TASK = process.argv[2] || "a low-poly wooden side table";
const CDP_PORT = Number(process.argv[3] ?? 9333);

const DONE_MARKER = path.join(ROOT, ".state", "brain_done");
const REPORT = path.join(ROOT, ".state", "brain_probe.json");
const SHOT = path.join(ROOT, ".state", "brain_probe.png");

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

async function waitFor(predicate, timeoutMs, label, interval = 250) {
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

  console.log("[brain-e2e] starting bridge...");
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

  let blender = null;
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${HTTP_PORT}/health`)).ok;
      } catch {
        return false;
      }
    }, 10000, "bridge health");
    console.log("[brain-e2e] bridge up");

    const bs = await api("/api/brain/status?port=" + CDP_PORT);
    console.log(`[brain-e2e] local brain: ${JSON.stringify(bs.brain)}`);

    console.log("[brain-e2e] launching Blender GUI:", BLENDER_EXE);
    blender = spawn(BLENDER_EXE, ["--python", path.join(ROOT, "tests", "blender", "gui_probe.py")], {
      env: {
        ...process.env,
        C2B_PROBE_OUT: REPORT,
        C2B_PROBE_SHOT: SHOT,
        C2B_PROBE_DONE: DONE_MARKER,
        C2B_PROBE_MAX: "240",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const blenderLog = [];
    blender.stdout.on("data", (d) => blenderLog.push(d.toString()));
    blender.stderr.on("data", (d) => blenderLog.push(d.toString()));

    await waitFor(async () => (await api("/api/status")).blender.connected, 90000, "blender add-on to connect", 500);
    const st = await api("/api/status");
    console.log(`[brain-e2e] blender connected: Blender ${st.blender.blenderVersion}, addon ${st.blender.addonVersion}`);

    console.log(`[brain-e2e] submitting task to the local ChatGPT desktop app: "${TASK}"`);
    const created = await api("/api/brain/tasks", { method: "POST", body: JSON.stringify({ task: TASK, port: CDP_PORT }) });
    const jobId = created.jobId;
    console.log(`[brain-e2e] job=${jobId} provider=${created.provider}`);

    const t0 = Date.now();
    let last = null;
    await waitFor(
      async () => {
        last = await api(`/api/brain/tasks/${jobId}`);
        return last.status === "completed" || last.status === "failed" || last.brain.state === "error";
      },
      300000,
      "brain job to finish",
      2000
    );
    const ttff = last.ttffMs !== undefined ? `${(last.ttffMs / 1000).toFixed(1)}s` : "n/a";
    console.log(`[brain-e2e] job ${last.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s | chunks ${last.executedCount}/${last.chunkCount} | TTFF ${ttff}`);
    console.log("\n===== AGENT VIEW =====");
    console.log(JSON.stringify(last, null, 2));

    fs.writeFileSync(DONE_MARKER, String(Date.now()));
    await waitFor(() => fs.existsSync(REPORT), 90000, "blender report", 300);
    await sleep(500);
    const report = JSON.parse(fs.readFileSync(REPORT, "utf8"));

    console.log("\n===== BLENDER REPORT =====");
    console.log(`ok=${report.ok} reason=${report.reason} objects=${report.object_count} elapsed=${report.elapsed_s}s`);
    console.log("objects:", (report.objects || []).map((o) => o.name).join(", "));
    if (report.screenshot) console.log("screenshot:", report.screenshot);

    const ok = report.ok && report.object_count > 0 && last.status === "completed";
    console.log(`\n[brain-e2e] RESULT: ${ok ? "PASS" : "FAIL"}`);
    if (!ok) process.exitCode = 1;
  } catch (err) {
    console.error("[brain-e2e] FAILED:", err.message);
    console.error("--- bridge log (tail) ---");
    console.error(bridgeLog.join("").slice(-3000));
    process.exitCode = 1;
  } finally {
    try {
      blender?.kill();
    } catch {
      /* ignore */
    }
    try {
      bridge.kill();
    } catch {
      /* ignore */
    }
  }
}

main();
