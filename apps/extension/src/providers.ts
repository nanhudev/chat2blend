/**
 * Provider adapters.
 *
 * ChatGPT's DOM changes often. Every selector has fallbacks and the capture
 * degrades to "manual send" instead of breaking the whole extension.
 */
import type { ProviderId } from "./types";

export interface CodeBlock {
  language: string;
  code: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  label: string;
  /** all assistant turns currently in the DOM */
  assistantMessages(): HTMLElement[];
  /** the newest assistant turn (the one being generated) */
  currentMessage(): HTMLElement | null;
  codeBlocks(root: HTMLElement): CodeBlock[];
  lastUserPrompt(): string;
  isGenerating(): boolean;
  /** selectors used for diagnostics */
  diagnostics(): Record<string, boolean>;
  /** the prompt composer input, if the page exposes one */
  composer(): HTMLElement | HTMLTextAreaElement | null;
  /** put text into the composer without losing the page's internal state */
  fillPrompt(text: string): boolean;
  /** press send (only used when the user enabled auto-submit) */
  submitPrompt(): boolean;
}

/**
 * Composer selectors, newest ChatGPT first. ChatGPT keeps renaming this node,
 * so anything that misses just disables auto-delivery — manual paste still works.
 */
const COMPOSER_SELECTORS = [
  "div#prompt-textarea",
  'div[contenteditable="true"][id*="prompt"]',
  'textarea[data-id="root"]',
  'textarea[placeholder*="Message" i]',
  'div[contenteditable="true"][data-placeholder]',
  'div[contenteditable="true"]',
  "textarea",
];

const SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label*="Send" i]',
  'button[aria-label*="发送" i]',
  "form button[type='submit']",
];

/** Insert text in a way React-controlled inputs actually notice. */
function insertText(el: HTMLElement, text: string): boolean {
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (!setter) return false;
    setter.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  // contenteditable (ProseMirror): execCommand keeps React's internal model in sync
  const sel = window.getSelection();
  if (!sel) return false;
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
  const ok = document.execCommand("insertText", false, text);
  if (!ok) {
    // last resort: plain text + input event
    el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  return true;
}

const STOP_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label*="Stop" i]',
  'button[aria-label*="停止" i]',
  "[data-testid='stop-generating']",
];

function firstExisting(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el as HTMLElement;
    } catch {
      /* invalid selector after a page update */
    }
  }
  return null;
}

function queryAll(root: ParentNode, selectors: string[]): HTMLElement[] {
  for (const sel of selectors) {
    try {
      const found = Array.from(root.querySelectorAll(sel)) as HTMLElement[];
      if (found.length) return found;
    } catch {
      /* ignore */
    }
  }
  return [];
}

class ChatGPTAdapter implements ProviderAdapter {
  id: ProviderId = "chatgpt";
  label = "ChatGPT";

  assistantMessages(): HTMLElement[] {
    const byRole = queryAll(document, ['[data-message-author-role="assistant"]']);
    if (byRole.length) return byRole;
    // fallback: conversation turns, every second one is the assistant
    const turns = queryAll(document, ['[data-testid^="conversation-turn-"]']);
    return turns.filter((_, i) => i % 2 === 1);
  }

  currentMessage(): HTMLElement | null {
    const all = this.assistantMessages();
    return all.length ? all[all.length - 1] : null;
  }

  codeBlocks(root: HTMLElement): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const pres = queryAll(root, ["pre"]);
    for (const pre of pres) {
      const codeEl = pre.querySelector("code") || pre;
      // ChatGPT highlights with spans: textContent keeps the plain source
      const code = codeEl.textContent ?? "";
      const cls = (codeEl.className || "") + " " + (pre.className || "");
      const langMatch = /(?:language-|lang-|highlight-)([a-z0-9+#-]+)/i.exec(cls);
      const header = pre.parentElement?.querySelector("[class*='language'], [data-language]")?.textContent ?? "";
      const language = (langMatch?.[1] || header || "").trim().toLowerCase();
      if (code.trim()) blocks.push({ language, code });
    }
    if (blocks.length) return blocks;
    return [];
  }

  lastUserPrompt(): string {
    const users = queryAll(document, ['[data-message-author-role="user"]']);
    const el = users.length ? users[users.length - 1] : null;
    return (el?.textContent ?? "").trim().slice(0, 80);
  }

  isGenerating(): boolean {
    return firstExisting(STOP_SELECTORS) !== null;
  }

  diagnostics(): Record<string, boolean> {
    return {
      "data-message-author-role": document.querySelector('[data-message-author-role="assistant"]') !== null,
      "conversation-turn": document.querySelector('[data-testid^="conversation-turn-"]') !== null,
      "pre/code": document.querySelector("pre code") !== null || document.querySelector("pre") !== null,
      "stop-button": this.isGenerating(),
      composer: this.composer() !== null,
    };
  }

  composer(): HTMLElement | HTMLTextAreaElement | null {
    const el = firstExisting(COMPOSER_SELECTORS);
    // never mistake an assistant code block for the composer
    if (el && el.closest("pre")) return null;
    return el;
  }

  fillPrompt(text: string): boolean {
    const el = this.composer();
    if (!el) return false;
    return insertText(el, text);
  }

  submitPrompt(): boolean {
    const btn = firstExisting(SEND_SELECTORS);
    if (!btn) return false;
    btn.click();
    return true;
  }
}

class GenericDomAdapter implements ProviderAdapter {
  id: ProviderId = "generic_dom";
  label = document.location.hostname;

  assistantMessages(): HTMLElement[] {
    return queryAll(document, ["pre"]);
  }
  currentMessage(): HTMLElement | null {
    const all = this.assistantMessages();
    return all.length ? all[all.length - 1] : null;
  }
  codeBlocks(root: HTMLElement): CodeBlock[] {
    return queryAll(root, ["pre code", "pre"]).map((el) => ({
      language: /(?:language-|lang-)([a-z0-9+#-]+)/i.exec(el.className)?.[1] ?? "",
      code: el.textContent ?? "",
    }));
  }
  lastUserPrompt(): string {
    return "";
  }
  isGenerating(): boolean {
    return firstExisting(STOP_SELECTORS) !== null;
  }
  diagnostics(): Record<string, boolean> {
    return { pre: document.querySelector("pre") !== null, composer: this.composer() !== null };
  }

  composer(): HTMLElement | HTMLTextAreaElement | null {
    return firstExisting(COMPOSER_SELECTORS);
  }

  fillPrompt(text: string): boolean {
    const el = this.composer();
    if (!el) return false;
    return insertText(el, text);
  }

  submitPrompt(): boolean {
    const btn = firstExisting(SEND_SELECTORS);
    if (!btn) return false;
    btn.click();
    return true;
  }
}

export function detectAdapter(): ProviderAdapter {
  const host = document.location.hostname.toLowerCase();
  if (host.includes("chatgpt.com") || host.includes("openai.com")) return new ChatGPTAdapter();
  return new GenericDomAdapter();
}
