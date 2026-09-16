import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as net from "node:net";

import { CdpClient, WsClient, cdpReachable, listTargets, type CdpTarget } from "./cdp.js";

/**
 * Drives the *local ChatGPT desktop app* (Windows: `OpenAI.Codex_*\app\ChatGPT.exe`).
 *
 * The desktop app is a Chromium/Electron app, so we attach to its local
 * debugging port and talk CDP. The app itself owns the ChatGPT session and the
 * network path — there is no browser extension, no scraped page and no API key.
 */

const CANDIDATE_DIRS = [
  "C:\\Program Files\\WindowsApps",
  path.join(os.homedir(), "AppData", "Local", "Programs"),
  path.join(os.homedir(), "AppData", "Local"),
];

/** Higher score = more likely to be the interactive chat window. */
function scoreTarget(t: CdpTarget): number {
  if (t.url.includes("detached-window")) return 3;
  if (/new chat/i.test(t.title)) return 2;
  if (t.url.includes("index.html")) return 1;
  return 0;
}

export const DEFAULT_CDP_PORT = 9333;
export const CHATGPT_BRAIN_PROFILE = path.join(os.homedir(), ".cache", "c2b-chatgpt-brain");

/** Best-effort discovery of the ChatGPT desktop executable. */
export function findChatGptExe(): string | undefined {
  const roots = [path.join(process.env.ProgramFiles ?? "C:\\Program Files", "WindowsApps")];
  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/openai|chatgpt|codex/i.test(name)) continue;
      for (const rel of ["app\\ChatGPT.exe", "ChatGPT.exe"]) {
        const p = path.join(root, name, rel);
        try {
          if (fs.statSync(p).isFile()) return p;
        } catch {
          /* keep looking */
        }
      }
    }
  }
  for (const dir of CANDIDATE_DIRS) {
    const p = path.join(dir, "ChatGPT", "ChatGPT.exe");
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

export function portOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host });
    s.setTimeout(1200);
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
    s.once("timeout", () => {
      s.destroy();
      resolve(false);
    });
  });
}

export interface DesktopStatus {
  exePath?: string;
  cdpPort: number;
  attached: boolean;
  browser?: string;
  title?: string;
  composerFound: boolean;
  loggedIn?: boolean;
}

export interface AskResult {
  text: string;
  elapsedMs: number;
  firstTokenMs?: number;
  completed: boolean;
}

const COMPOSER_SELECTOR = 'div.ProseMirror[contenteditable="true"], [role="textbox"][contenteditable="true"], textarea, #prompt-textarea';

export class ChatGptDesktop {
  private cdp: CdpClient | null = null;
  private target: CdpTarget | null = null;

  constructor(readonly cdpPort: number = DEFAULT_CDP_PORT) {}

  /** Attach to an already-debuggable instance, or launch one with a debug port. */
  async attach(opts: { launch?: boolean; exePath?: string; timeoutMs?: number } = {}): Promise<DesktopStatus> {
    if (!(await cdpReachable(this.cdpPort))) {
      if (opts.launch === false) throw new Error(`ChatGPT desktop is not exposing CDP on port ${this.cdpPort}`);
      await this.launch(opts.exePath, opts.timeoutMs ?? 45_000);
    }
    // The app exposes several page targets (main shell, detached windows,
    // overlay popups). Score each one and keep the real conversation window.
    const pages = (await listTargets(this.cdpPort)).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    let best: { t: CdpTarget; score: number } | null = null;
    for (const t of pages) {
      const s = await this.probeScore(t);
      if (!best || s > best.score) best = { t, score: s };
    }
    const fallback = best?.t;
    if (!fallback) throw new Error(`no page target on CDP port ${this.cdpPort}`);
    const ws = await WsClient.connect(fallback.webSocketDebuggerUrl!);
    this.cdp = new CdpClient(ws);
    this.target = fallback;
    await this.cdp.send("Runtime.enable", {}, 10_000);
    if (best!.score < 4) await this.ensureReady(opts.timeoutMs ?? 45_000);
    return this.status();
  }

  /** How good is this target for driving a conversation? (higher is better) */
  private async probeScore(t: CdpTarget): Promise<number> {
    if (!t.webSocketDebuggerUrl) return -1;
    const ws = await WsClient.connect(t.webSocketDebuggerUrl);
    const cdp = new CdpClient(ws);
    try {
      await cdp.send("Runtime.enable", {}, 8000);
      const r = await cdp.evaluate<any>(
        `(() => {
          const composer = document.querySelector('${COMPOSER_SELECTOR}');
          const rect = composer ? composer.getBoundingClientRect() : null;
          const usable = !!rect && rect.width > 80 && rect.height > 14;
          const thread = !!document.querySelector('[class*="thread-scroll-container"]');
          const main = !!document.querySelector('main');
          const overlay = location.href.includes('avatar-overlay');
          return { score: (overlay ? -2 : 0) + (usable ? 4 : 0) + (thread ? 2 : 0) + (main ? 1 : 0) };
        })()`,
        8000
      );
      return typeof r?.score === "number" ? r.score : -1;
    } catch {
      return -1;
    } finally {
      cdp.close();
    }
  }

  /** Open a fresh chat so the answer is not mixed with previous context. */
  async newChat(): Promise<boolean> {
    const cdp = this.requireCdp();
    const r = await cdp.evaluate<any>(`(() => {
      const nodes = [...document.querySelectorAll('button, a, div[role="button"]')];
      const b = nodes.find((x) => /^(new chat|新聊天)$/i.test((x.getAttribute('aria-label') || x.innerText || '').trim()))
        || nodes.find((x) => /^(new chat|新聊天)$/i.test((x.getAttribute('data-testid') || '').replace(/[-_]/g, ' ')));
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (r) await new Promise((res) => setTimeout(res, 2500));
    return !!r;
  }

  /** Launch the desktop app with a remote debugging port (detached). */
  async launch(exePath?: string, timeoutMs = 45_000): Promise<void> {
    const exe = exePath ?? findChatGptExe();
    if (!exe) throw new Error("ChatGPT desktop app not found (expected OpenAI.Codex_*\\app\\ChatGPT.exe)");
    fs.mkdirSync(CHATGPT_BRAIN_PROFILE, { recursive: true });
    const child = spawn(exe, [`--remote-debugging-port=${this.cdpPort}`, `--user-data-dir=${CHATGPT_BRAIN_PROFILE}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await cdpReachable(this.cdpPort)) {
        // give the app time to render its first conversation
        await new Promise((r) => setTimeout(r, 8000));
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`ChatGPT desktop started but CDP port ${this.cdpPort} never opened (an already-running instance may be blocking it)`);
  }

  async status(): Promise<DesktopStatus> {
    const exePath = findChatGptExe();
    if (!this.cdp) return { exePath, cdpPort: this.cdpPort, attached: false, composerFound: false };
    const info = await this.cdp.evaluate<any>(`(() => {
      const composer = document.querySelector('${COMPOSER_SELECTOR}');
      const body = document.body ? document.body.innerText : '';
      return {
        title: document.title,
        url: location.href,
        composerFound: !!composer,
        loggedIn: !/log in|sign up/i.test(body.slice(0, 400)),
        bodyLen: body.length,
      };
    })()`);
    return {
      exePath,
      cdpPort: this.cdpPort,
      attached: true,
      title: this.target?.title,
      composerFound: !!info?.composerFound,
      loggedIn: !!info?.loggedIn,
    };
  }

  /** Make sure we sit on a usable conversation with a real, sized composer. */
  async ensureReady(timeoutMs = 25_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const r = await this.requireCdp().evaluate<any>(`(() => {
        const el = document.querySelector('${COMPOSER_SELECTOR}');
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 80 && rect.height > 14) return { ready: true };
        }
        const nodes = [...document.querySelectorAll('button, a, div[role="button"], [data-testid]')];
        const nb = nodes.find((x) => /新聊天|new chat/i.test((x.getAttribute('aria-label') || x.innerText || x.getAttribute('data-testid') || '').trim()));
        if (nb) { nb.click(); return { ready: false, clicked: 'new chat' }; }
        return { ready: false, clicked: null };
      })()`);
      if (r?.ready) return;
      if (r?.clicked) {
        // clicking "new chat" may open a separate window — follow it
        await new Promise((res) => setTimeout(res, 3000));
        await this.switchToBest();
      }
      if (Date.now() > deadline) {
        if (await this.switchToBest()) return this.ensureReady(8_000);
        throw new Error("ChatGPT desktop has no usable composer (is it logged in on an open chat?)");
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
  }

  /** Switch to the best-scoring page target when it is not the current one. */
  private async switchToBest(): Promise<boolean> {
    const pages = (await listTargets(this.cdpPort)).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    let best: { t: CdpTarget; score: number } | null = null;
    for (const t of pages) {
      const s = await this.probeScore(t);
      if (!best || s > best.score) best = { t, score: s };
    }
    if (!best || best.score <= 0 || best.t.id === this.target?.id) return false;
    const ws = await WsClient.connect(best.t.webSocketDebuggerUrl!);
    const cdp = new CdpClient(ws);
    await cdp.send("Runtime.enable", {}, 10_000);
    this.cdp?.close();
    this.cdp = cdp;
    this.target = best.t;
    return true;
  }

  /** Type into the composer. Uses a real click + CDP insertText so React sees input. */
  private async fillComposer(text: string): Promise<void> {
    const cdp = this.requireCdp();
    const box = await cdp.evaluate<any>(`(() => {
      const el = document.querySelector('${COMPOSER_SELECTOR}');
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + Math.min(180, r.width / 2), y: r.top + Math.min(30, r.height / 2) };
    })()`);
    if (!box) throw new Error("composer not found");
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await cdp.send("Input.insertText", { text });
    await new Promise((r) => setTimeout(r, 400));
  }

  private async sendNow(): Promise<void> {
    const cdp = this.requireCdp();
    const clicked = await cdp.evaluate<any>(`(() => {
      const byTestId = document.querySelector('[data-testid="send-button"]');
      if (byTestId && !byTestId.disabled) { byTestId.click(); return 'testid'; }
      const btns = [...document.querySelectorAll('button')];
      const send = btns.filter((b) => !b.disabled).find((b) => /size-token-button-composer/.test(b.className || ''))
        || btns.filter((b) => !b.disabled).find((b) => /send|发送/i.test(b.getAttribute('aria-label') || ''));
      if (send) { send.click(); return 'heuristic'; }
      return null;
    })()`);
    if (clicked) return;
    // Fallback: Enter submits in the ChatGPT composer.
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  }

  /** Snapshot the conversation: prefer raw `pre` text (it keeps C2B markers). */
  private async snapshot(sincePre = 0): Promise<{ code: string; text: string; generating: boolean; preCount: number }> {
    const expr = `(() => {
      const pres = [...document.querySelectorAll('pre')];
      const code = pres.slice(${sincePre}).map((p) => p.textContent || '').join('\\n\\n');
      let text = '';
      for (const sel of ['main', '[role="main"]', '[class*="thread-scroll-container"]', '[data-testid^="conversation-turn"]']) {
        const el = document.querySelector(sel);
        if (el && (el.innerText || '').length > text.length) text = el.innerText;
      }
      const stop = document.querySelector('[data-testid="stop-button"]')
        || [...document.querySelectorAll('button')].find((b) => /stop|停止|暂停/i.test(b.getAttribute('aria-label') || ''));
      return { code, text, generating: !!stop, preCount: pres.length };
    })()`;
    const cdp = this.requireCdp();
    let snap = (await cdp.evaluate<any>(expr)) ?? { code: "", text: "", generating: false, preCount: 0 };
    if (snap.code) return snap;

    // The answer may live in a different window (the desktop app opens new
    // chats in separate page targets) — scan the others and follow it.
    for (const t of await this.otherTargets()) {
      const ws = await WsClient.connect(t.webSocketDebuggerUrl!);
      const probe = new CdpClient(ws);
      try {
        await probe.send("Runtime.enable", {}, 8000);
        const s = (await probe.evaluate<any>(expr, 8000)) ?? { code: "", text: "", generating: false, preCount: 0 };
        if (s.code) {
          this.cdp?.close();
          this.cdp = probe;
          this.target = t;
          return s;
        }
      } catch {
        /* keep scanning */
      }
      probe.close();
    }
    return snap;
  }

  private async otherTargets(): Promise<CdpTarget[]> {
    const pages = (await listTargets(this.cdpPort)).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    return pages.filter((t) => t.id !== this.target?.id).sort((a, b) => scoreTarget(b) - scoreTarget(a));
  }

  /**
   * Send a prompt to the local ChatGPT desktop app and wait for the answer.
   * Returns the raw assistant text (markdown) — parsing is done upstream.
   */
  async ask(prompt: string, opts: { timeoutMs?: number; idleMs?: number; newChat?: boolean } = {}): Promise<AskResult> {
    const timeoutMs = opts.timeoutMs ?? 240_000;
    const idleMs = opts.idleMs ?? 4000;
    await this.ensureReady();
    if (opts.newChat === true) {
      try {
        await this.newChat();
        await this.ensureReady();
      } catch {
        /* fall through — we will answer in the current chat */
      }
    }
    const start = await this.snapshot();
    const beforePre = start.preCount;
    const startedAt = Date.now();
    await this.fillComposer(prompt);
    await this.sendNow();

    let firstTokenMs: number | undefined;
    let last = "";
    let lastChangeAt = Date.now();
    const deadline = startedAt + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const snap = await this.snapshot(beforePre);
      const content = snap.code || snap.text;
      if (content.trim().length > 0 && firstTokenMs === undefined) firstTokenMs = Date.now() - startedAt;
      if (content !== last) {
        last = content;
        lastChangeAt = Date.now();
        continue;
      }
      // Give a still-generating answer more slack before calling it done.
      const settledFor = Date.now() - lastChangeAt;
      const need = snap.generating ? idleMs * 2 : idleMs;
      if (content.trim().length > 0 && settledFor >= need) {
        return { text: content, elapsedMs: Date.now() - startedAt, firstTokenMs, completed: true };
      }
    }
    return { text: last, elapsedMs: Date.now() - startedAt, firstTokenMs, completed: false };
  }

  private requireCdp(): CdpClient {
    if (!this.cdp) throw new Error("not attached — call attach() first");
    return this.cdp;
  }

  close(): void {
    this.cdp?.close();
    this.cdp = null;
  }
}

export async function desktopStatus(cdpPort = DEFAULT_CDP_PORT): Promise<DesktopStatus> {
  if (!(await portOpen(cdpPort))) {
    return { exePath: findChatGptExe(), cdpPort, attached: false, composerFound: false };
  }
  try {
    const targets = await listTargets(cdpPort);
    const page = targets.find((t) => t.type === "page");
    return { exePath: findChatGptExe(), cdpPort, attached: true, title: page?.title, composerFound: false };
  } catch {
    return { exePath: findChatGptExe(), cdpPort, attached: false, composerFound: false };
  }
}
