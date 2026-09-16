import * as http from "node:http";
import * as crypto from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";

import { buildPrompt, PROTOCOL_VERSION, type BlenderToBridge, type ExecutionMode } from "../../../packages/protocol/src/index.js";
import { sha256 } from "../../../packages/chunk-parser/src/index.js";
import { BlenderTransport } from "./blender-transport.js";
import { JobManager, isTerminalJob, type AddChunkInput } from "./jobs.js";
import { Logger } from "./logger.js";
import {
  isLoopback,
  matchRoute,
  originAllowed,
  readBody,
  sendError,
  sendJson,
  type Route,
} from "./http.js";
import { VERSION, type BridgeConfig } from "./config.js";
import { askDesktopBrain, ChatGptDesktop, DEFAULT_CDP_PORT, desktopStatus, findChatGptExe, type BrainAnswer } from "./brain/index.js";

const CHUNK_TIMEOUT_MS = 120_000;
const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
const EXT_STALE_MS = 15_000;

/** A modeling task submitted by a coding agent (harness) and awaiting delivery to the web LLM. */
export interface HarnessTask {
  jobId: string;
  task: string;
  prompt: string;
  provider: string;
  createdAt: number;
  status: "pending" | "delivered";
  deliveredAt?: number;
}

export interface StartOptions extends Partial<BridgeConfig> {
  logger?: Logger;
  /** when true the caller already runs the process (no pid file writing) */
  embedded?: boolean;
}

export interface BridgeInstance {
  config: BridgeConfig;
  jobs: JobManager;
  blender: BlenderTransport;
  logger: Logger;
  httpServer: http.Server;
  pairCode: () => string;
  rotatePairCode: () => string;
  close: () => Promise<void>;
  startedAt: number;
}

interface InFlight {
  jobId: string;
  chunkId: string;
  sentAt: number;
}

export async function startBridge(opts: StartOptions = {}): Promise<BridgeInstance> {
  const logger = opts.logger ?? new Logger(opts.stateDir);
  const config: BridgeConfig = {
    httpPort: opts.httpPort ?? 8787,
    blenderPort: opts.blenderPort ?? 8788,
    host: opts.host ?? "127.0.0.1",
    stateDir: opts.stateDir ?? "",
    token: opts.token ?? crypto.randomBytes(24).toString("base64url"),
    verbose: opts.verbose ?? false,
  };

  const jobs = new JobManager();
  const blender = new BlenderTransport(config.blenderPort, config.host, logger);
  const startedAt = Date.now();
  /** pending harness tasks, keyed by jobId */
  const harnessTasks = new Map<string, HarnessTask>();
  /** in-flight / finished runs of the local ChatGPT desktop brain, keyed by jobId */
  const brainRuns = new Map<string, { task: string; startedAt: number; state: "running" | "done" | "error"; error?: string; answer?: BrainAnswer }>();

  let inFlight: InFlight | null = null;
  let lastExtensionHeartbeat: number | undefined;
  let pairCode = newPairCode();
  let pairCodeAt = Date.now();

  function newPairCode(): string {
    // 6 digits, unambiguous
    const n = crypto.randomInt(0, 1_000_000);
    return String(n).padStart(6, "0");
  }

  /* ----------------------------- dispatch ----------------------------- */

  function dispatch(): void {
    if (!blender.connected) return;
    if (inFlight) return;
    for (const job of jobs.list()) {
      if (isTerminalJob(job.status) || job.status === "paused") continue;
      const chunk = jobs.nextPending(job.id);
      if (!chunk) continue;

      if (!job.metadata.beginSent) {
        job.metadata.beginSent = true;
        blender.send({ type: "job_begin", jobId: job.id, ...(job.title ? { title: job.title } : {}), provider: job.provider, mode: job.mode });
      }
      jobs.markChunk(job.id, chunk.chunkId, { status: "executing", startedAt: Date.now() });
      const ok = blender.send({
        type: "exec",
        jobId: job.id,
        chunkId: chunk.chunkId,
        ...(chunk.name !== undefined ? { name: chunk.name } : {}),
        index: chunk.index,
        code: chunk.code,
        hash: chunk.hash,
        ...(chunk.final !== undefined ? { final: chunk.final } : {}),
      });
      if (!ok) {
        jobs.markChunk(job.id, chunk.chunkId, { status: "queued", startedAt: undefined });
        job.metadata.beginSent = false;
        return;
      }
      inFlight = { jobId: job.id, chunkId: chunk.chunkId, sentAt: Date.now() };
      if (job.timing.firstChunkSentAt === undefined) job.timing.firstChunkSentAt = Date.now();
      logger.info(`chunk queued -> blender: job=${job.id} chunk=${chunk.name ?? chunk.chunkId}#${chunk.index}`);
      return;
    }
  }

  function finishJobIfDone(jobId: string): void {
    const job = jobs.get(jobId);
    if (!job) return;
    if (isTerminalJob(job.status)) return;
    const pending = jobs.nextPending(jobId);
    if (pending) return;
    if (inFlight && inFlight.jobId === jobId) return;
    if (job.timing.generationCompletedAt === undefined) return; // still streaming
    const failed = job.chunks.some((c) => c.status === "failed");
    jobs.setJobStatus(jobId, failed ? "failed" : "completed");
    blender.send({ type: "job_end", jobId, status: failed ? "failed" : "completed" });
    logger.info(`job ${jobId} ${failed ? "failed" : "completed"} (${job.chunks.length} chunks)`);
  }

  function handleBlenderMessage(msg: BlenderToBridge): void {
    if (msg.type === "chunk_result") {
      if (!inFlight || inFlight.chunkId !== msg.chunkId) {
        logger.warn(`result for unknown chunk ${msg.chunkId}`);
        return;
      }
      inFlight = null;
      if (msg.status === "completed") {
        jobs.markChunk(msg.jobId, msg.chunkId, {
          status: "completed",
          completedAt: Date.now(),
          durationMs: msg.durationMs,
        });
        logger.info(`chunk executed: ${msg.chunkId} (${msg.durationMs ?? "?"}ms, objects=${msg.sceneObjects ?? "?"})`);
        dispatch();
        finishJobIfDone(msg.jobId);
      } else {
        jobs.markChunk(msg.jobId, msg.chunkId, { status: "failed", completedAt: Date.now(), error: msg.error ?? "unknown error", durationMs: msg.durationMs });
        jobs.setJobStatus(msg.jobId, "paused", msg.error ?? "chunk failed");
        logger.error(`chunk failed: ${msg.chunkId}: ${msg.error ?? "unknown error"}`);
      }
      return;
    }
    if (msg.type === "status") {
      if (msg.jobId) {
        const job = jobs.get(msg.jobId);
        if (job) job.updatedAt = Date.now();
      }
      dispatch();
    }
  }

  blender.onMessage = handleBlenderMessage;
  blender.onConnectionChange = (connected) => {
    if (connected) dispatch();
  };

  const watchdog = setInterval(() => {
    if (inFlight && Date.now() - inFlight.sentAt > CHUNK_TIMEOUT_MS) {
      const { jobId, chunkId } = inFlight;
      inFlight = null;
      jobs.markChunk(jobId, chunkId, { status: "failed", error: "execution timeout (120s)", completedAt: Date.now() });
      jobs.setJobStatus(jobId, "paused", "execution timeout (120s)");
      logger.error(`chunk timeout: ${chunkId}`);
      dispatch();
    } else {
      dispatch();
    }
  }, 1000);

  /* ------------------------------- auth ------------------------------- */

  function authorized(ctx: { token?: string; origin?: string }): boolean {
    return ctx.token === config.token;
  }

  /* ------------------------------ routes ------------------------------ */

  const routes: Route[] = [
    {
      method: "GET",
      pattern: "/health",
      handler: (ctx) => sendJson(ctx.res, 200, { ok: true, version: VERSION, protocol: PROTOCOL_VERSION, blender: blender.connected }),
    },
    {
      method: "GET",
      pattern: "/fixture",
      handler: (ctx) => {
        const fixture = path.join(__dirname, "..", "..", "..", "..", "apps", "extension", "fixture.html");
        const html = fs.readFileSync(fixture, "utf8");
        ctx.res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(html) });
        ctx.res.end(html);
      },
    },
    {
      method: "POST",
      pattern: "/api/pair",
      handler: (ctx) => {
        const body = (ctx.body ?? {}) as { code?: string };
        if (Date.now() - pairCodeAt > PAIR_CODE_TTL_MS) {
          pairCode = newPairCode();
          pairCodeAt = Date.now();
          return sendError(ctx.res, 410, "pairing code expired - run `c2b pair` to get a new one");
        }
        if (body.code !== pairCode) return sendError(ctx.res, 401, "invalid pairing code");
        pairCode = newPairCode();
        pairCodeAt = Date.now();
        logger.info("browser extension paired");
        sendJson(ctx.res, 200, { ok: true, token: config.token, httpPort: config.httpPort });
      },
    },
    {
      method: "POST",
      pattern: "/api/pair/rotate",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const code = newPairCode();
        pairCode = code;
        pairCodeAt = Date.now();
        sendJson(ctx.res, 200, { ok: true, code });
      },
    },
    {
      method: "POST",
      pattern: "/api/heartbeat",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        lastExtensionHeartbeat = Date.now();
        const body = (ctx.body ?? {}) as { provider?: string };
        sendJson(ctx.res, 200, {
          ok: true,
          blender: blender.connected,
          ...(body.provider ? { provider: body.provider } : {}),
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/status",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const now = Date.now();
        sendJson(ctx.res, 200, {
          ok: true,
          version: VERSION,
          protocol: PROTOCOL_VERSION,
          bridge: { running: true, pid: process.pid, httpPort: config.httpPort, blenderPort: config.blenderPort, uptimeMs: now - startedAt, host: config.host },
          blender: {
            connected: blender.connected,
            ...(blender.blenderVersion ? { blenderVersion: blender.blenderVersion } : {}),
            ...(blender.addonVersion ? { addonVersion: blender.addonVersion } : {}),
            ...(blender.lastHeartbeatAt ? { lastHeartbeatAt: blender.lastHeartbeatAt } : {}),
          },
          extension: {
            connected: lastExtensionHeartbeat !== undefined && now - lastExtensionHeartbeat < EXT_STALE_MS,
            ...(lastExtensionHeartbeat ? { lastHeartbeatAt: lastExtensionHeartbeat, lastSeenAgoMs: now - lastExtensionHeartbeat } : {}),
          },
          jobs: jobs.summaries(),
          stats: jobs.statsSnapshot(),
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/logs",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        sendJson(ctx.res, 200, { ok: true, lines: logger.recent(200) });
      },
    },
    {
      method: "POST",
      pattern: "/api/jobs",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const body = (ctx.body ?? {}) as { provider?: string; title?: string; mode?: ExecutionMode; metadata?: Record<string, unknown> };
        const job = jobs.create({
          ...(body.provider ? { provider: body.provider } : {}),
          ...(body.title ? { title: body.title } : {}),
          ...(body.mode ? { mode: body.mode } : {}),
          ...(body.metadata ? { metadata: body.metadata } : {}),
        });
        logger.info(`job created: ${job.id} provider=${job.provider} ${job.title ? `title="${job.title}"` : ""}`);
        sendJson(ctx.res, 201, { ok: true, jobId: job.id, job: job });
      },
    },
    {
      method: "GET",
      pattern: "/api/jobs",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        sendJson(ctx.res, 200, { ok: true, jobs: jobs.summaries() });
      },
    },
    {
      method: "GET",
      pattern: "/api/jobs/:id",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const job = jobs.get(ctx.params.id);
        if (!job) return sendError(ctx.res, 404, "job not found");
        sendJson(ctx.res, 200, { ok: true, job });
      },
    },
    {
      method: "POST",
      pattern: "/api/jobs/:id/chunks",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const job = jobs.get(ctx.params.id);
        if (!job) return sendError(ctx.res, 404, "job not found");
        const body = (ctx.body ?? {}) as Record<string, unknown>;
        const code = typeof body.code === "string" ? body.code : "";
        if (!code.trim()) return sendError(ctx.res, 400, "code is required");
        const input: AddChunkInput = {
          code,
          hash: typeof body.hash === "string" && body.hash.length > 8 ? body.hash : sha256(code.trim()),
          ...(typeof body.name === "string" ? { name: body.name } : {}),
          ...(typeof body.index === "number" ? { index: body.index } : {}),
          ...(body.final === true ? { final: true } : {}),
        };
        const { chunk, duplicate } = jobs.addChunk(job.id, input);
        if (!duplicate) logger.info(`chunk received: ${chunk.name ?? "unnamed"}#${chunk.index} (${code.length} chars)`);
        dispatch();
        sendJson(ctx.res, duplicate ? 200 : 201, { ok: true, duplicate, chunkId: chunk.chunkId, status: chunk.status });
      },
    },
    {
      method: "POST",
      pattern: "/api/jobs/:id/control",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const job = jobs.get(ctx.params.id);
        if (!job) return sendError(ctx.res, 404, "job not found");
        const body = (ctx.body ?? {}) as { action?: string };
        switch (body.action) {
          case "pause":
            jobs.setJobStatus(job.id, "paused");
            break;
          case "resume":
            jobs.setJobStatus(job.id, job.chunks.some((c) => c.status === "queued") ? "streaming" : "completed");
            break;
          case "retry": {
            const failed = job.chunks.filter((c) => c.status === "failed");
            failed.forEach((c) => jobs.markChunk(job.id, c.chunkId, { status: "queued", error: undefined, startedAt: undefined }));
            jobs.setJobStatus(job.id, "streaming", undefined);
            break;
          }
          case "skip": {
            const pending = jobs.nextPending(job.id);
            if (pending) jobs.markChunk(job.id, pending.chunkId, { status: "skipped" });
            break;
          }
          case "complete":
            job.timing.generationCompletedAt = Date.now();
            finishJobIfDone(job.id);
            break;
          case "cancel":
            jobs.cancelJob(job.id);
            blender.send({ type: "job_end", jobId: job.id, status: "cancelled" });
            if (inFlight?.jobId === job.id) inFlight = null;
            break;
          default:
            return sendError(ctx.res, 400, "unknown action");
        }
        logger.info(`job ${job.id} control=${body.action}`);
        dispatch();
        sendJson(ctx.res, 200, { ok: true, job: jobs.get(job.id) });
      },
    },
    {
      // Agent-friendly shortcut: execute one python block end to end.
      method: "POST",
      pattern: "/api/exec",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const body = (ctx.body ?? {}) as { code?: string; name?: string; title?: string; provider?: string };
        const code = body.code ?? "";
        if (!code.trim()) return sendError(ctx.res, 400, "code is required");
        const job = jobs.create({
          provider: body.provider ?? "agent",
          ...(body.title ? { title: body.title } : {}),
          mode: "generic",
        });
        const { chunk } = jobs.addChunk(job.id, {
          code,
          hash: sha256(code.trim()),
          ...(body.name ? { name: body.name } : {}),
        });
        job.timing.generationCompletedAt = Date.now();
        dispatch();
        sendJson(ctx.res, 201, { ok: true, jobId: job.id, chunkId: chunk.chunkId });
      },
    },
    {
      method: "GET",
      pattern: "/api/prompt",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const task = ctx.url.searchParams.get("task") ?? "";
        sendJson(ctx.res, 200, { ok: true, prompt: buildPrompt(task || "a modern three-seat fabric sofa") });
      },
    },

    /* ------------------------- harness (agent) API -------------------------
     * A coding agent (WorkBuddy / Codex / Cursor / Claude Code) is the HARNESS:
     * it submits a natural-language task, ships the generated prompt to the web
     * LLM, then polls a tiny status object. It never sees or writes bpy code.
     * --------------------------------------------------------------------- */

    {
      // Submit a modeling task. Creates the job + returns the C2B prompt to deliver.
      method: "POST",
      pattern: "/api/harness/tasks",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const body = (ctx.body ?? {}) as { task?: string; provider?: string; title?: string };
        const task = (body.task ?? "").trim();
        if (!task) return sendError(ctx.res, 400, "task is required");

        const job = jobs.create({
          provider: body.provider ?? "chatgpt",
          title: body.title ?? task.slice(0, 120),
          mode: "protocol",
        });
        const prompt = buildPrompt(task);
        const record: HarnessTask = {
          jobId: job.id,
          task,
          prompt,
          provider: job.provider,
          createdAt: Date.now(),
          status: "pending",
        };
        harnessTasks.set(job.id, record);
        logger.info(`harness task submitted: job=${job.id} task="${task.slice(0, 60)}"`);
        sendJson(ctx.res, 201, {
          ok: true,
          jobId: job.id,
          prompt,
          provider: job.provider,
          deliverUrl: `http://${config.host}:${config.httpPort}/api/harness/pending`,
          statusUrl: `http://${config.host}:${config.httpPort}/api/harness/tasks/${job.id}`,
        });
      },
    },
    {
      // Compact status for agents — chunk names/states only, never the code.
      method: "GET",
      pattern: "/api/harness/tasks/:id",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const job = jobs.get(ctx.params.id);
        if (!job) return sendError(ctx.res, 404, "job not found");
        const failed = job.chunks.find((c) => c.status === "failed");
        const ttff =
          job.timing.firstChunkExecutedAt !== undefined && job.timing.generationStartedAt !== undefined
            ? job.timing.firstChunkExecutedAt - job.timing.generationStartedAt
            : undefined;
        sendJson(ctx.res, 200, {
          ok: true,
          jobId: job.id,
          task: harnessTasks.get(job.id)?.task ?? job.title,
          status: job.status,
          provider: job.provider,
          chunkCount: job.chunks.length,
          executedCount: job.chunks.filter((c) => c.status === "completed").length,
          chunks: job.chunks.map((c) => ({ name: c.name ?? `#${c.index}`, status: c.status })),
          ...(failed ? { error: { chunk: failed.name ?? `#${failed.index}`, message: failed.error?.slice(0, 400) } } : {}),
          ...(ttff !== undefined ? { ttffMs: ttff } : {}),
          elapsedMs: Date.now() - job.createdAt,
          delivered: harnessTasks.get(job.id)?.status ?? "unknown",
        });
      },
    },
    {
      // The browser extension polls this to auto-fill the prompt into the LLM page.
      method: "GET",
      pattern: "/api/harness/pending",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const tasks = [...harnessTasks.values()]
          .filter((t) => t.status === "pending")
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((t) => ({ jobId: t.jobId, task: t.task, prompt: t.prompt, provider: t.provider, createdAt: t.createdAt }));
        sendJson(ctx.res, 200, { ok: true, tasks });
      },
    },
    {
      method: "POST",
      pattern: "/api/harness/pending/:id/ack",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const rec = harnessTasks.get(ctx.params.id);
        if (!rec) return sendError(ctx.res, 404, "task not found");
        rec.status = "delivered";
        rec.deliveredAt = Date.now();
        const job = jobs.get(ctx.params.id);
        if (job && job.timing.generationStartedAt === undefined) job.timing.generationStartedAt = Date.now();
        logger.info(`harness task delivered to browser: job=${ctx.params.id}`);
        sendJson(ctx.res, 200, { ok: true });
      },
    },

    /* ---------------------- brain (local ChatGPT desktop) -----------------
     * The brain runs on this machine: we drive the installed ChatGPT desktop
     * app over its local debugging port. No browser, no extension, no API key.
     * The harness submits a task; the bridge turns the answer into chunks and
     * streams them to Blender.
     * --------------------------------------------------------------------- */

    {
      method: "GET",
      pattern: "/api/brain/status",
      handler: async (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const port = Number(ctx.url.searchParams.get("port") ?? DEFAULT_CDP_PORT);
        let status;
        try {
          status = await desktopStatus(port);
        } catch (err) {
          status = { cdpPort: port, attached: false, composerFound: false, exePath: findChatGptExe() };
        }
        sendJson(ctx.res, 200, { ok: true, brain: { kind: "chatgpt-desktop", ...status }, runs: [...brainRuns.values()].length });
      },
    },
    {
      method: "POST",
      pattern: "/api/brain/attach",
      handler: async (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const body = (ctx.body ?? {}) as { port?: number; launch?: boolean };
        const port = body.port ?? DEFAULT_CDP_PORT;
        const desktop = new ChatGptDesktop(port);
        try {
          const status = await desktop.attach({ launch: body.launch ?? true });
          logger.info(`brain attached: chatgpt-desktop port=${port} composer=${status.composerFound}`);
          sendJson(ctx.res, 200, { ok: true, brain: { kind: "chatgpt-desktop", ...status } });
        } catch (err) {
          sendError(ctx.res, 502, (err as Error).message);
        } finally {
          desktop.close();
        }
      },
    },
    {
      // Submit a modeling task to the local brain. Runs in the background.
      method: "POST",
      pattern: "/api/brain/tasks",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const body = (ctx.body ?? {}) as { task?: string; title?: string; port?: number; timeoutMs?: number };
        const task = (body.task ?? "").trim();
        if (!task) return sendError(ctx.res, 400, "task is required");

        const job = jobs.create({ provider: "chatgpt-desktop", title: body.title ?? task.slice(0, 120), mode: "protocol" });
        job.timing.generationStartedAt = Date.now();
        brainRuns.set(job.id, { task, startedAt: Date.now(), state: "running" });
        logger.info(`brain task submitted: job=${job.id} task="${task.slice(0, 60)}"`);

        void (async () => {
          try {
            const answer = await askDesktopBrain(task, { cdpPort: body.port ?? DEFAULT_CDP_PORT, timeoutMs: body.timeoutMs ?? 240_000 });
            const chunks = answer.chunks.length > 0 ? answer.chunks : answer.pythonBlocks.map((code, i) => ({ name: `block-${i + 1}`, index: i, code, hash: sha256(code.trim()), startOffset: 0 }));
            if (chunks.length === 0) throw new Error("the brain returned no Python code");
            chunks.forEach((c, i) => {
              jobs.addChunk(job.id, {
                code: c.code,
                hash: c.hash,
                name: c.name,
                index: c.index,
                ...(i === chunks.length - 1 ? { final: true } : {}),
              });
            });
            job.timing.generationCompletedAt = Date.now();
            brainRuns.set(job.id, { task, startedAt: brainRuns.get(job.id)!.startedAt, state: "done", answer });
            logger.info(`brain answer ready: job=${job.id} chunks=${chunks.length} mode=${answer.mode} (${answer.elapsedMs}ms)`);
            dispatch();
            finishJobIfDone(job.id);
          } catch (err) {
            const message = (err as Error).message;
            brainRuns.set(job.id, { task, startedAt: brainRuns.get(job.id)?.startedAt ?? Date.now(), state: "error", error: message });
            jobs.setJobStatus(job.id, "failed", message);
            logger.error(`brain task failed: job=${job.id}: ${message}`);
          }
        })();

        sendJson(ctx.res, 202, {
          ok: true,
          jobId: job.id,
          provider: "chatgpt-desktop",
          statusUrl: `http://${config.host}:${config.httpPort}/api/brain/tasks/${job.id}`,
        });
      },
    },
    {
      method: "GET",
      pattern: "/api/brain/tasks/:id",
      handler: (ctx) => {
        if (!authorized(ctx)) return sendError(ctx.res, 401, "unauthorized");
        const job = jobs.get(ctx.params.id);
        if (!job) return sendError(ctx.res, 404, "job not found");
        const run = brainRuns.get(ctx.params.id);
        const failed = job.chunks.find((c) => c.status === "failed");
        const ttff =
          job.timing.firstChunkExecutedAt !== undefined && job.timing.generationStartedAt !== undefined
            ? job.timing.firstChunkExecutedAt - job.timing.generationStartedAt
            : undefined;
        sendJson(ctx.res, 200, {
          ok: true,
          jobId: job.id,
          task: run?.task ?? job.title,
          brain: { kind: "chatgpt-desktop", state: run?.state ?? "unknown", ...(run?.error ? { error: run.error.slice(0, 400) } : {}) },
          status: job.status,
          chunkCount: job.chunks.length,
          executedCount: job.chunks.filter((c) => c.status === "completed").length,
          chunks: job.chunks.map((c) => ({ name: c.name ?? `#${c.index}`, status: c.status })),
          ...(failed ? { error: { chunk: failed.name ?? `#${failed.index}`, message: failed.error?.slice(0, 400) } } : {}),
          ...(ttff !== undefined ? { ttffMs: ttff } : {}),
          elapsedMs: Date.now() - job.createdAt,
        });
      },
    },
  ];

  const server = http.createServer(async (req, res) => {
    try {
      // CORS (extension pages are cross-origin to 127.0.0.1)
      res.setHeader("access-control-allow-origin", req.headers.origin && originAllowed(req.headers.origin) ? req.headers.origin : "*");
      res.setHeader("access-control-allow-headers", "content-type, x-c2b-token");
      res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      res.setHeader("x-content-type-options", "nosniff");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const addr = req.socket.remoteAddress;
      if (!isLoopback(addr)) {
        logger.warn(`rejected non-loopback request from ${addr}`);
        return sendError(res, 403, "loopback only");
      }

      const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
      if (!originAllowed(origin)) {
        logger.warn(`rejected request from origin ${origin}`);
        return sendError(res, 403, "origin not allowed");
      }

      const url = new URL(req.url ?? "/", `http://127.0.0.1:${config.httpPort}`);
      const match = matchRoute(routes, req.method ?? "GET", url.pathname);
      if (!match) return sendError(res, 404, `no route for ${req.method} ${url.pathname}`);

      let body: unknown;
      if (req.method === "POST") {
        try {
          body = await readBody(req);
        } catch (err) {
          return sendError(res, 400, (err as Error).message);
        }
      }
      const tokenHeader = req.headers["x-c2b-token"];
      const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
      await match.route.handler({ req, res, url, params: match.params, body, ...(token ? { token } : {}), ...(origin ? { origin } : {}) });
    } catch (err) {
      logger.error(`http handler error: ${(err as Error).message}`);
      try {
        sendError(res, 500, (err as Error).message);
      } catch {
        /* ignore */
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.httpPort, config.host, () => resolve());
  });
  await blender.listen();
  // reflect OS-assigned ports when the caller requested port 0
  const httpAddr = server.address();
  if (httpAddr && typeof httpAddr !== "string") config.httpPort = httpAddr.port;
  const blenderAddr = blender.addressInfo;
  if (blenderAddr) config.blenderPort = blenderAddr.port;
  logger.info(`bridge ready: http=http://${config.host}:${config.httpPort} blender=tcp://${config.host}:${config.blenderPort}`);
  logger.info(`pairing code: ${pairCode} (use it in the Chat2Blend extension popup, valid 10 minutes)`);

  return {
    config,
    jobs,
    blender,
    logger,
    httpServer: server,
    startedAt,
    pairCode: () => pairCode,
    rotatePairCode: () => {
      pairCode = newPairCode();
      pairCodeAt = Date.now();
      return pairCode;
    },
    close: async () => {
      clearInterval(watchdog);
      blender.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
