import * as crypto from "node:crypto";
import {
  type ChunkRecord,
  type ChunkStatus,
  type ExecutionMode,
  type Job,
  type JobStatus,
  type JobSummary,
  type JobTiming,
} from "../../../packages/protocol/src/index.js";

export interface AddChunkInput {
  name?: string;
  code: string;
  hash: string;
  index?: number;
  final?: boolean;
}

export const TERMINAL_JOB: JobStatus[] = ["completed", "cancelled", "failed"];
export const TERMINAL_CHUNK: ChunkStatus[] = ["completed", "failed", "cancelled", "skipped"];

export function isTerminalJob(s: JobStatus): boolean {
  return TERMINAL_JOB.includes(s);
}

export function isTerminalChunk(s: ChunkStatus): boolean {
  return TERMINAL_CHUNK.includes(s);
}

/**
 * In-memory job store. Deliberately dumb: the bridge is a transport, not a
 * database. Jobs survive bridge restarts only if the caller re-posts them.
 */
export class JobManager {
  private jobs = new Map<string, Job>();
  private order: string[] = [];
  private stats = { jobsTotal: 0, chunksExecuted: 0, chunksFailed: 0 };

  create(input: { provider?: string; title?: string; mode?: ExecutionMode; metadata?: Record<string, unknown> } = {}): Job {
    const id = "job_" + crypto.randomBytes(6).toString("hex");
    const now = Date.now();
    const job: Job = {
      id,
      provider: input.provider ?? "unknown",
      title: input.title,
      mode: input.mode ?? "protocol",
      status: "created",
      createdAt: now,
      updatedAt: now,
      chunks: [],
      timing: { createdAt: now },
      metadata: input.metadata ?? {},
      executedHashes: [],
    };
    this.jobs.set(id, job);
    this.order.push(id);
    this.stats.jobsTotal++;
    // keep the last 50 jobs around for `c2b jobs` / status
    if (this.order.length > 50) {
      const drop = this.order.shift();
      if (drop) this.jobs.delete(drop);
    }
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  list(): Job[] {
    return this.order.map((id) => this.jobs.get(id)!).filter(Boolean);
  }

  summaries(): JobSummary[] {
    return this.list().map(summarize);
  }

  statsSnapshot() {
    return { ...this.stats };
  }

  /**
   * Add a chunk. Returns `{ chunk, duplicate }` - duplicates are never
   * re-queued (the DOM observer fires many times for the same content).
   */
  private mustGet(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`job not found: ${id}`);
    return job;
  }

  addChunk(jobId: string, input: AddChunkInput): { job: Job; chunk: ChunkRecord; duplicate: boolean } {
    const job = this.mustGet(jobId);
    if (job.executedHashes.includes(input.hash) || job.chunks.some((c: ChunkRecord) => c.hash === input.hash)) {
      const existing = job.chunks.find((c: ChunkRecord) => c.hash === input.hash)!;
      return { job, chunk: existing, duplicate: true };
    }
    const now = Date.now();
    const chunk: ChunkRecord = {
      protocol: "c2b/1",
      jobId,
      chunkId: "chunk_" + input.hash.slice(0, 10),
      ...(input.name !== undefined ? { name: input.name } : {}),
      index: input.index ?? job.chunks.length,
      language: "python",
      code: input.code,
      hash: input.hash,
      ...(input.final !== undefined ? { final: input.final } : {}),
      status: "queued",
      createdAt: now,
      queuedAt: now,
    };
    job.chunks.push(chunk);
    job.updatedAt = now;
    if (job.status === "created") job.status = "streaming";
    if (job.timing.firstChunkDetectedAt === undefined) job.timing.firstChunkDetectedAt = now;
    return { job, chunk, duplicate: false };
  }

  markChunk(jobId: string, chunkId: string, patch: Partial<ChunkRecord>): ChunkRecord | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    const chunk = job.chunks.find((c) => c.chunkId === chunkId);
    if (!chunk) return undefined;
    Object.assign(chunk, patch);
    job.updatedAt = Date.now();
    if (patch.status === "completed") {
      this.stats.chunksExecuted++;
      if (!job.executedHashes.includes(chunk.hash)) job.executedHashes.push(chunk.hash);
      if (job.timing.firstChunkExecutedAt === undefined) job.timing.firstChunkExecutedAt = Date.now();
    } else if (patch.status === "failed") {
      this.stats.chunksFailed++;
    }
    return chunk;
  }

  /** Next chunk that still needs to be executed, in index order. */
  nextPending(jobId: string): ChunkRecord | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    return job.chunks
      .slice()
      .sort((a, b) => a.index - b.index)
      .find((c) => c.status === "queued");
  }

  hasPending(jobId: string): boolean {
    return this.nextPending(jobId) !== undefined;
  }

  setJobStatus(jobId: string, status: JobStatus, error?: string): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    job.status = status;
    job.updatedAt = Date.now();
    if (error !== undefined) job.error = error;
    if (status === "completed" || status === "cancelled" || status === "failed") {
      job.timing.completedAt = Date.now();
    }
    return job;
  }

  /** Jobs that are still allowed to make progress. */
  activeJobs(): Job[] {
    return this.list().filter((j) => !isTerminalJob(j.status) && j.status !== "paused");
  }

  cancelJob(jobId: string): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    job.chunks.forEach((c) => {
      if (!isTerminalChunk(c.status)) c.status = "cancelled";
    });
    return this.setJobStatus(jobId, "cancelled");
  }
}

export function summarize(job: Job): JobSummary {
  return {
    id: job.id,
    provider: job.provider,
    ...(job.title !== undefined ? { title: job.title } : {}),
    mode: job.mode,
    status: job.status,
    chunkCount: job.chunks.length,
    executedCount: job.chunks.filter((c) => c.status === "completed").length,
    failedCount: job.chunks.filter((c) => c.status === "failed").length,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.error !== undefined ? { error: job.error } : {}),
    timing: job.timing as JobTiming,
  };
}
