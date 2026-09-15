/**
 * Extension popup. Shows bridge/blender status, the current job chunks and a
 * manual fallback "Send Current Code" button.
 */
import { buildPrompt } from "../../../packages/protocol/src/index";
import type { BridgeSnapshot } from "./types";

const $ = (id: string) => document.getElementById(id)!;

let lastSnap: BridgeSnapshot | null = null;
let pauseState = false;

async function send<T>(msg: Record<string, unknown>): Promise<T> {
  const resp = await chrome.runtime.sendMessage(msg);
  if (resp && resp.ok === false) throw new Error(resp.error || "unknown error");
  return resp as T;
}

async function snapshot(): Promise<BridgeSnapshot> {
  const s = await send<BridgeSnapshot>({ type: "c2b/snapshot" });
  lastSnap = s;
  return s;
}

function statusIcon(s: BridgeSnapshot): string {
  if (!s.bridgeUp) return "Bridge down - run `c2b start`";
  if (!s.paired) return "Bridge up / not paired - enter pairing code";
  if (!s.blenderConnected) return "Bridge paired / Blender not connected - open Blender & enable add-on";
  return "Ready: ChatGPT -> Bridge -> Blender";
}

function render(s: BridgeSnapshot): void {
  $("status").textContent = statusIcon(s);
  $("badge").textContent = s.blenderConnected ? "ok" : "!";
  $("badge").className = s.blenderConnected ? "ok" : "warn";
  ($("auto") as HTMLInputElement).checked = s.autoExecute;

  if (s.paired) $("pairPanel").style.display = "none";
  else $("pairPanel").style.display = "";

  const list = $("chunks");
  list.innerHTML = "";
  if (s.job?.chunks?.length) {
    const title = document.createElement("div");
    title.className = "job-title";
    title.textContent = s.job.title || s.job.id;
    list.appendChild(title);
    for (const c of s.job.chunks) {
      const row = document.createElement("div");
      row.className = "chunk-row";
      const icon = c.status === "completed" ? "\u2713" : c.status === "executing" ? "\u25b6" : c.status === "failed" ? "\u2717" : "\u25cb";
      row.innerHTML = `<span class="chunk-icon">${icon}</span><span class="chunk-name">${c.name}</span><span class="chunk-status">${c.status}</span>`;
      list.appendChild(row);
    }
  } else {
    list.textContent = "No chunks yet.";
  }
}

async function tick(): Promise<void> {
  try {
    const s = await snapshot();
    render(s);
  } catch (err) {
    $("status").textContent = `Error: ${(err as Error).message}`;
  }
}

$("btnPair").addEventListener("click", async () => {
  const code = (("value" in $("code")) ? ($("code") as HTMLInputElement).value : "").trim();
  if (!/^\d{6}$/.test(code)) return;
  try {
    $("status").textContent = "Pairing...";
    await send({ type: "c2b/pair", code });
    await tick();
  } catch (err) {
    $("status").textContent = `Pair failed: ${(err as Error).message}`;
  }
});

$("auto").addEventListener("change", async () => {
  try {
    await send({ type: "c2b/set-settings", settings: { autoExecute: ($("auto") as HTMLInputElement).checked } });
  } catch (err) {
    $("status").textContent = `Save failed: ${(err as Error).message}`;
  }
});

$("btnSend").addEventListener("click", async () => {
  try {
    await send({ type: "c2b/manual-send" });
    $("status").textContent = "Code sent";
  } catch (err) {
    $("status").textContent = `Send failed: ${(err as Error).message}`;
  }
});

$("btnPause").addEventListener("click", async () => {
  try {
    pauseState = !pauseState;
    await send({ type: "c2b/control", action: pauseState ? "pause" : "resume" });
    $("btnPause").textContent = pauseState ? "Resume" : "Pause";
  } catch (err) {
    $("status").textContent = `Control failed: ${(err as Error).message}`;
  }
});

$("btnCopy").addEventListener("click", async () => {
  const task = prompt("Modeling task:", "a modern three-seat fabric sofa") || "";
  try {
    await navigator.clipboard.writeText(buildPrompt(task));
    $("status").textContent = "C2B prompt copied";
  } catch (err) {
    $("status").textContent = `Copy failed: ${(err as Error).message}`;
  }
});

// initial load and periodic refresh
tick().catch(() => undefined);
setInterval(() => tick().catch(() => undefined), 1000);
