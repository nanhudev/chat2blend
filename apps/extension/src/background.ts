/**
 * Service worker: owns the token, talks to the loopback bridge, keeps a small
 * amount of state for the popup and other agents.
 */
import { DEFAULT_SETTINGS, type BridgeSnapshot, type Settings } from "./types";

let settings: Settings = { ...DEFAULT_SETTINGS };
let currentJobId: string | undefined;
let lastBridgeOk = false;
let lastError: string | undefined;

async function load(): Promise<void> {
  const got = await chrome.storage.local.get("settings");
  settings = { ...DEFAULT_SETTINGS, ...((got.settings as Partial<Settings>) ?? {}) };
}

async function save(next: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...next };
  await chrome.storage.local.set({ settings });
  broadcastSettings();
}

async function broadcastSettings(): Promise<void> {
  for (const tab of await chrome.tabs.query({})) {
    if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "c2b/settings-updated", settings }).catch(() => undefined);
  }
}

function base(): string {
  return `http://127.0.0.1:${settings.port}`;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-c2b-token": settings.token, ...(init.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json?.error || `http ${res.status}`);
  return json;
}

async function ensureJob(provider: string, title: string): Promise<void> {
  const res = await api<{ jobId: string }>("/api/jobs", {
    method: "POST",
    body: JSON.stringify({ provider, title, mode: "protocol" }),
  });
  currentJobId = res.jobId;
}

async function pushChunk(payload: { name: string; index: number; code: string; final?: boolean }): Promise<void> {
  if (!currentJobId) await ensureJob("unknown", "untitled");
  await api(`/api/jobs/${currentJobId}/chunks`, { method: "POST", body: JSON.stringify(payload) });
}

async function control(action: string): Promise<void> {
  if (!currentJobId) return;
  await api(`/api/jobs/${currentJobId}/control`, { method: "POST", body: JSON.stringify({ action }) });
}

async function snapshot(): Promise<BridgeSnapshot> {
  const snap: BridgeSnapshot = {
    ok: false,
    bridgeUp: false,
    blenderConnected: false,
    autoExecute: settings.autoExecute,
    paired: Boolean(settings.token),
    provider: settings.provider,
  };
  try {
    const health = (await api("/api/status")) as {
      blender: { connected: boolean; blenderVersion?: string; addonVersion?: string };
      jobs: { id: string; status: string; title?: string; chunks: { name?: string; status: string; error?: string }[] }[];
    };
    snap.bridgeUp = true;
    lastBridgeOk = true;
    lastError = undefined;
    snap.blenderConnected = Boolean(health.blender?.connected);
    if (health.blender?.blenderVersion) snap.blenderVersion = health.blender.blenderVersion;
    if (health.blender?.addonVersion) snap.addonVersion = health.blender.addonVersion;
    const job = currentJobId ? health.jobs?.find((j) => j.id === currentJobId) : health.jobs?.[health.jobs.length - 1];
    if (job) {
      snap.job = {
        id: job.id,
        status: job.status,
        ...(job.title ? { title: job.title } : {}),
        chunks: (job.chunks ?? []).map((c, i) => ({ name: c.name ?? `chunk ${i + 1}`, status: c.status, ...(c.error ? { error: c.error } : {}) })),
      };
    }
    snap.ok = true;
  } catch (err) {
    lastBridgeOk = false;
    lastError = (err as Error).message;
    snap.error = lastError;
  }
  return snap;
}

async function heartbeat(): Promise<void> {
  if (!settings.token) return;
  try {
    await api("/api/heartbeat", { method: "POST", body: JSON.stringify({ provider: settings.provider }) });
    lastBridgeOk = true;
  } catch {
    lastBridgeOk = false;
  }
}

// ------------------------------------------------- harness task auto-delivery
const PROVIDER_URLS: Record<string, string> = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app",
};

function providerHosts(provider: string): string[] {
  if (provider === "chatgpt") return ["chatgpt.com", "openai.com"];
  if (provider === "claude") return ["claude.ai"];
  if (provider === "gemini") return ["gemini.google.com"];
  return [];
}

async function findProviderTab(provider: string): Promise<number | undefined> {
  const hosts = providerHosts(provider);
  const tabs = await chrome.tabs.query({});
  const hit = tabs.find((t) => t.id !== undefined && t.url && hosts.some((h) => t.url!.includes(h)));
  return hit?.id;
}

/**
 * Coding agents submit tasks through `c2b harness "<task>"`. The service worker
 * picks them up and drops the generated C2B prompt into the LLM composer so the
 * user only has to press Send (or enable auto-submit).
 */
async function pollHarness(): Promise<void> {
  if (!settings.token || !settings.harnessAutoDeliver) return;
  try {
    const r = await api<{ tasks: { jobId: string; task: string; prompt: string; provider: string }[] }>("/api/harness/pending");
    for (const task of r.tasks ?? []) {
      let tabId = await findProviderTab(task.provider);
      if (tabId === undefined && settings.harnessAutoOpen) {
        const url = PROVIDER_URLS[task.provider];
        if (url) {
          const tab = await chrome.tabs.create({ url, active: false });
          tabId = tab.id;
        }
      }
      if (tabId === undefined) continue;
      try {
        const res = (await chrome.tabs.sendMessage(tabId, {
          type: "c2b/deliver-prompt",
          prompt: task.prompt,
          autoSubmit: settings.autoSubmit,
        })) as { ok?: boolean } | undefined;
        if (res?.ok) {
          currentJobId = task.jobId;
          await api(`/api/harness/pending/${task.jobId}/ack`, { method: "POST", body: "{}" });
        }
      } catch {
        // content script not injected yet - retry on the next tick
      }
    }
  } catch {
    // bridge down: the heartbeat already reports this
  }
}

// ------------------------------------------------------------------ wiring
chrome.runtime.onInstalled.addListener(() => {
  void load();
  chrome.alarms.create("c2b-heartbeat", { periodInMinutes: 1 });
  chrome.storage.local.set({ settings: DEFAULT_SETTINGS }).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "c2b-heartbeat") void heartbeat();
});

setInterval(() => void heartbeat(), 5000);
setInterval(() => void pollHarness(), 3000);

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const m = msg as { type: string } & Record<string, unknown>;

  const handle = async (): Promise<unknown> => {
    switch (m.type) {
      case "c2b/get-settings":
        return settings;
      case "c2b/set-settings":
        await save((msg as { settings?: Partial<Settings> }).settings ?? {});
        return { ok: true };
      case "c2b/pair": {
        const r = await api<{ token: string }>("/api/pair", {
          method: "POST",
          body: JSON.stringify({ code: (msg as { code: string }).code }),
        });
        await save({ token: r.token });
        return { ok: true };
      }
      case "c2b/job/new":
        await ensureJob((msg as { provider: string }).provider, (msg as { title: string }).title);
        return { jobId: currentJobId };
      case "c2b/chunk": {
        const c = msg as unknown as { name: string; index: number; code: string; final?: boolean };
        await pushChunk(c);
        return { ok: true };
      }
      case "c2b/generation-done":
        await control("complete");
        return { ok: true };
      case "c2b/control":
        await control((msg as { action: string }).action);
        return { ok: true };
      case "c2b/exec": {
        const code = (msg as { code: string }).code;
        const r = await api<{ jobId: string }>("/api/exec", { method: "POST", body: JSON.stringify({ code, provider: "extension", title: "manual exec" }) });
        currentJobId = r.jobId;
        return r;
      }
      case "c2b/snapshot":
        return snapshot();
      case "c2b/manual-send": {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: "no active tab" };
        return chrome.tabs.sendMessage(tab.id, { type: "c2b/manual-send" });
      }
      case "c2b/diagnostics": {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, error: "no active tab" };
        return chrome.tabs.sendMessage(tab.id, { type: "c2b/diagnostics" });
      }
      default:
        return { ok: false, error: "unknown message" };
    }
  };

  handle()
    .then((r) => reply?.(r))
    .catch((err) => reply?.({ ok: false, error: (err as Error).message }));
  return true; // async reply
});

void load();
void (async () => {
  await load();
  const snap = await snapshot();
  chrome.action.setBadgeText({ text: snap.blenderConnected ? "" : "!" });
  chrome.action.setBadgeBackgroundColor({ color: snap.blenderConnected ? "#2e7d32" : "#b71c1c" });
})();
