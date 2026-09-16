import { buildPrompt, type ExecutionMode } from "../../../../packages/protocol/src/index.js";
import { parseC2BChunks, extractPythonBlocks, type ParsedChunk } from "../../../../packages/chunk-parser/src/index.js";
import { ChatGptDesktop, DEFAULT_CDP_PORT, desktopStatus, findChatGptExe, type DesktopStatus } from "./chatgpt-desktop.js";

/**
 * Brain providers.
 *
 * The *brain* is whatever turns a modeling task into Blender Python.
 * The *harness* (WorkBuddy / any coding agent) never writes bpy code itself —
 * it submits a task and reads back chunk names + states.
 *
 * Desktop provider: drives the locally installed ChatGPT desktop app.
 * No browser, no extension, no API key.
 */

export type BrainKind = "chatgpt-desktop";

export interface BrainAnswer {
  kind: BrainKind;
  task: string;
  prompt: string;
  text: string;
  chunks: ParsedChunk[];
  pythonBlocks: string[];
  mode: ExecutionMode;
  elapsedMs: number;
  firstTokenMs?: number;
  completed: boolean;
}

export interface BrainOptions {
  cdpPort?: number;
  timeoutMs?: number;
  exePath?: string;
  /** allow launching the app if no debuggable instance is running */
  launch?: boolean;
}

export { DEFAULT_CDP_PORT, findChatGptExe, desktopStatus, ChatGptDesktop };
export type { DesktopStatus };

export function resolveMode(chunks: ParsedChunk[], text: string): ExecutionMode {
  if (chunks.length > 0) return "protocol";
  if (extractPythonBlocks(text).length > 0) return "generic";
  return "generic";
}

/** Ask the local ChatGPT desktop app to produce Blender Python for a task. */
export async function askDesktopBrain(task: string, opts: BrainOptions = {}): Promise<BrainAnswer> {
  const prompt = buildPrompt(task);
  const desktop = new ChatGptDesktop(opts.cdpPort ?? DEFAULT_CDP_PORT);
  try {
    await desktop.attach({ launch: opts.launch ?? true, exePath: opts.exePath });
    const res = await desktop.ask(prompt, { timeoutMs: opts.timeoutMs ?? 240_000 });
    const chunks = parseC2BChunks(res.text);
    let pythonBlocks = extractPythonBlocks(res.text);
    // The desktop app renders code without markdown fences, so a raw answer
    // that clearly is Blender Python becomes a single generic block.
    if (chunks.length === 0 && pythonBlocks.length === 0 && /\bbpy\.|^\s*import bpy/m.test(res.text)) {
      pythonBlocks = [res.text];
    }
    return {
      kind: "chatgpt-desktop",
      task,
      prompt,
      text: res.text,
      chunks,
      pythonBlocks,
      mode: resolveMode(chunks, res.text),
      elapsedMs: res.elapsedMs,
      firstTokenMs: res.firstTokenMs,
      completed: res.completed,
    };
  } finally {
    desktop.close();
  }
}
