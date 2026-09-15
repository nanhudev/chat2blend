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

const CHUNK_TIMEOUT_MS = 120_000;
const PAIR_CODE_TTL_MS = 10 * 60 * 1000;
const EXT_STALE_MS = 15_000;

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
