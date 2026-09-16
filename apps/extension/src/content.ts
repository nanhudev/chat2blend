/**
 * Content script: watches the provider DOM and streams completed chunks to the
 * bridge while the LLM is still writing the rest of the answer.
 *
 * It never talks to the network itself - all bridge traffic goes through the
 * service worker (which owns the token and can set the Origin header).
 */
import { C2BChunkStream, isPythonLike } from "../../../packages/chunk-parser/src/index";
import { detectAdapter, type CodeBlock } from "./providers";
import { DEFAULT_SETTINGS, type Settings } from "./types";

const DEBOUNCE_MS = 150;

const adapter = detectAdapter();
let settings: Settings = { ...DEFAULT_SETTINGS };

const chunkStreams = new Map<string, C2BChunkStream>();
let currentMessageId = "";
let wasGenerating = false;
let chunkIndex = 0;
let sawC2BChunk = false;
let timer: number | undefined;

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log("[C2B]", ...args);
}

function send(msg: Record<string, unknown>): void {
  chrome.runtime.sendMessage(msg).catch((err) => log("send failed", err));
}

function loadSettings(): void {
  chrome.runtime.sendMessage({ type: "c2b/get-settings" }).then((s: Settings) => {
    if (s) settings = { ...DEFAULT_SETTINGS, ...s };
  }).catch(() => undefined);
}

function idOf(el: HTMLElement): string {
  if (!el.dataset.c2bId) el.dataset.c2bId = "m" + Math.random().toString(36).slice(2, 9);
  return el.dataset.c2bId;
}

function startNewJob(): void {
  chunkStreams.clear();
  chunkIndex = 0;
  sawC2BChunk = false;
  const title = adapter.lastUserPrompt() || document.title.slice(0, 40) || "Chat2Blend task";
  send({ type: "c2b/job/new", provider: adapter.id, title });
  log("new response detected:", title);
}

function emitChunk(name: string, code: string, final = false): void {
  if (!settings.autoExecute) return; // manual mode: the popup button does it
  send({ type: "c2b/chunk", name, index: chunkIndex++, code, ...(final ? { final: true } : {}) });
  log("chunk ->", name, `${code.length} chars`);
}

function pythonBlocks(): CodeBlock[] {
  const msg = adapter.currentMessage();
  if (!msg) return [];
  return adapter.codeBlocks(msg).filter((b) => isPythonLike(b.language) || /import bpy|bpy\./.test(b.code));
}

function scan(): void {
  const msg = adapter.currentMessage();
  if (!msg) return;
  const id = idOf(msg);
  if (id !== currentMessageId) {
    currentMessageId = id;
    startNewJob();
  }

  const blocks = pythonBlocks();
  blocks.forEach((block, i) => {
    const key = `${id}:${i}`;
    let stream = chunkStreams.get(key);
    if (!stream) {
      stream = new C2BChunkStream();
      chunkStreams.set(key, stream);
    }
    // feed the full block text; a trailing newline makes the final line safe
    const result = stream.push(block.code.endsWith("\n") ? block.code : block.code + "\n");
    for (const chunk of result.chunks) {
      sawC2BChunk = true;
      emitChunk(chunk.name, chunk.code);
    }
  });

  const generating = adapter.isGenerating();
  if (wasGenerating && !generating) {
    finishGeneration("complete");
  }
  wasGenerating = generating;
}

function finishGeneration(reason: "complete" | "stopped"): void {
  for (const stream of chunkStreams.values()) {
    const flushed = stream.flush();
    for (const chunk of flushed.chunks) {
      sawC2BChunk = true;
      emitChunk(chunk.name, chunk.code, true);
    }
  }
  // Mode B fallback: no C2B protocol -> execute the finished python block(s)
  if (!sawC2BChunk) {
    const blocks = pythonBlocks();
    blocks.forEach((b, i) => emitChunk(`block${i + 1}`, b.code, i === blocks.length - 1));
    log("generic mode: sending", blocks.length, "python block(s)");
  }
  send({ type: "c2b/generation-done", reason });
  log("generation", reason, "-", chunkIndex, "chunk(s) sent");
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(scan, DEBOUNCE_MS) as unknown as number;
}

// ---------------------------------------------------------------- messages
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "c2b/settings-updated") {
    settings = { ...DEFAULT_SETTINGS, ...(msg.settings as Settings) };
    return;
  }
  if (msg?.type === "c2b/manual-send") {
    // Manual fallback: send whatever python is currently on screen.
    chunkStreams.clear();
    chunkIndex = 0;
    const title = adapter.lastUserPrompt() || "manual send";
    send({ type: "c2b/job/new", provider: adapter.id, title });
    const blocks = pythonBlocks();
    blocks.forEach((b, i) =>
      send({ type: "c2b/chunk", name: `block${i + 1}`, index: i, code: b.code, final: i === blocks.length - 1 }),
    );
    send({ type: "c2b/generation-done", reason: "complete" });
    reply?.({ ok: true, blocks: blocks.length });
    return;
  }
  if (msg?.type === "c2b/deliver-prompt") {
    // Harness path: the agent submitted a task, drop the C2B prompt into the composer.
    const text = String(msg.prompt ?? "");
    const filled = adapter.fillPrompt(text);
    let submitted = false;
    if (filled && msg.autoSubmit === true && settings.autoSubmit) {
      submitted = adapter.submitPrompt();
      if (submitted) {
        // a new response is coming: reset local dedupe state for the fresh job
        chunkStreams.clear();
        chunkIndex = 0;
      }
    }
    reply?.({ ok: filled, filled, submitted });
    return;
  }
  if (msg?.type === "c2b/diagnostics") {
    reply?.({ provider: adapter.id, label: adapter.label, generating: adapter.isGenerating(), ...adapter.diagnostics() });
  }
  reply?.({ ok: true });
});

function boot(): void {
  loadSettings();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  scan();
  log(`content script active on ${document.location.hostname} (provider=${adapter.id})`);
}

if (document.body) boot();
else window.addEventListener("DOMContentLoaded", boot);
