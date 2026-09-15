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
    };
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
    return { "pre": document.querySelector("pre") !== null };
  }
}

export function detectAdapter(): ProviderAdapter {
  const host = document.location.hostname.toLowerCase();
  if (host.includes("chatgpt.com") || host.includes("openai.com")) return new ChatGPTAdapter();
  return new GenericDomAdapter();
}
