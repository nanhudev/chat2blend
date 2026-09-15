/**
 * Chat2Blend shared protocol types (c2b/1).
 *
 * This module is dependency-free on purpose: it is consumed by the bridge,
 * the browser extension and the tests. Keep it boring and stable.
 */

export const PROTOCOL_VERSION = "c2b/1" as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

export const EXECUTION_MODES = ["protocol", "generic"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const CHUNK_STATUSES = [
  "received",
  "queued",
  "executing",
  "completed",
  "failed",
  "cancelled",
  "skipped",
] as const;
export type ChunkStatus = (typeof CHUNK_STATUSES)[number];

export const JOB_STATUSES = [
  "created",
  "streaming",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** A single executable unit. Always Blender Python for v1. */
export interface ChunkMessage {
  protocol: ProtocolVersion;
  jobId: string;
  chunkId: string;
  name?: string;
  index: number;
  language: "python";
  code: string;
  hash: string;
  /** true when the provider signalled this is the last chunk of the job */
  final?: boolean;
}

export interface ChunkRecord extends ChunkMessage {
  status: ChunkStatus;
  createdAt: number;
  queuedAt?: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  durationMs?: number;
}

/** Timing instrumentation - TTFF (time to first form) is the headline metric. */
export interface JobTiming {
  createdAt: number;
  firstChunkDetectedAt?: number;
  firstChunkSentAt?: number;
  firstChunkExecutedAt?: number;
  generationCompletedAt?: number;
  completedAt?: number;
}

export interface Job {
  id: string;
  provider: string;
  title?: string;
  mode: ExecutionMode;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  chunks: ChunkRecord[];
  timing: JobTiming;
  error?: string;
  metadata: Record<string, unknown>;
  /** hashes of chunks already dispatched - dedupe guard */
  executedHashes: string[];
}

export interface JobSummary {
  id: string;
  provider: string;
  title?: string;
  mode: ExecutionMode;
  status: JobStatus;
  chunkCount: number;
  executedCount: number;
  failedCount: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  timing: JobTiming;
}

/* ------------------------------------------------------------------ */
/* Bridge -> Blender (line delimited JSON over a loopback TCP socket)   */
/* ------------------------------------------------------------------ */

export type BridgeToBlender =
  | { type: "welcome"; bridgeVersion: string; protocol: ProtocolVersion }
  | { type: "job_begin"; jobId: string; title?: string; provider: string; mode: ExecutionMode }
  | { type: "exec"; jobId: string; chunkId: string; name?: string; index: number; code: string; hash: string; final?: boolean }
  | { type: "job_end"; jobId: string; status: "completed" | "cancelled" | "failed" }
  | { type: "control"; action: "pause" | "resume" | "stop" }
  | { type: "ping"; t: number };

export type BlenderToBridge =
  | { type: "hello"; addonVersion: string; blenderVersion: string; protocol: ProtocolVersion }
  | { type: "ack"; jobId: string; chunkId: string; status: ChunkStatus }
  | {
      type: "chunk_result";
      jobId: string;
      chunkId: string;
      status: "completed" | "failed";
      error?: string;
      durationMs?: number;
      sceneObjects?: number;
    }
  | { type: "status"; jobId?: string; chunkId?: string; queue: number; busy: boolean }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "pong"; t: number };

export interface BridgeStatus {
  ok: boolean;
  version: string;
  protocol: ProtocolVersion;
  bridge: { running: true; pid: number; httpPort: number; blenderPort: number; uptimeMs: number; host: string };
  blender: {
    connected: boolean;
    blenderVersion?: string;
    addonVersion?: string;
    lastHeartbeatAt?: number;
    lastSeenAgoMs?: number;
  };
  extension: { lastHeartbeatAt?: number; lastSeenAgoMs?: number; connected: boolean };
  jobs: JobSummary[];
  stats: { jobsTotal: number; chunksExecuted: number; chunksFailed: number };
}

/* ------------------------------------------------------------------ */
/* Validation helpers (hand rolled - no zod, no runtime deps)          */
/* ------------------------------------------------------------------ */

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolError";
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function isChunkMessage(value: unknown): value is ChunkMessage {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.protocol === PROTOCOL_VERSION &&
    isNonEmptyString(v.jobId) &&
    isNonEmptyString(v.chunkId) &&
    isNonEmptyString(v.code) &&
    isNonEmptyString(v.hash) &&
    typeof v.index === "number" &&
    (v.language === undefined || v.language === "python")
  );
}

export function parseChunkMessage(value: unknown): ChunkMessage {
  if (!isChunkMessage(value)) throw new ProtocolError("invalid chunk message");
  return value;
}

export const C2B_CHUNK_START = /^#[ \t]*C2B:CHUNK[ \t]+([A-Za-z0-9_\-.]+)[ \t]*$/;
export const C2B_CHUNK_END = /^#[ \t]*C2B:END[ \t]*$/;
export const C2B_MODE = /^#[ \t]*C2B:MODE[ \t]+([A-Z]+)[ \t]*$/;

/**
 * The prompt template handed to the web LLM. Local template only - Chat2Blend
 * never calls an LLM API.
 */
export const C2B_PROMPT_TEMPLATE = `You are generating Blender Python for Chat2Blend.

Return executable Blender Python (bpy) for Blender 4.x.

IMPORTANT:
Output the model incrementally using:

# C2B:CHUNK <name>
...python...
# C2B:END

Each completed chunk is executed immediately in a visible Blender instance
while you are still generating later chunks.

Rules:
- use bpy, Blender 4.x API
- define helpers before use
- earlier chunks cannot depend on later chunks
- every chunk is a standalone valid Python block
- create meaningful object names
- avoid destructive filesystem operations
- avoid quitting Blender
- keep all geometry generation executable
- finish the complete requested asset

Task:
{{TASK}}
`;

export function buildPrompt(task: string): string {
  return C2B_PROMPT_TEMPLATE.replace("{{TASK}}", task.trim());
}
