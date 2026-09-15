#!/usr/bin/env node
/**
 * Long running bridge process. Started by `c2b start` (detached) or run in the
 * foreground with `node dist/apps/bridge/src/server.js`.
 */
import * as path from "node:path";
import { startBridge } from "./bridge.js";
import { Logger } from "./logger.js";
import {
  clearState,
  defaultStateDir,
  newToken,
  readState,
  writeState,
  VERSION,
} from "./config.js";

async function main(): Promise<void> {
  const stateDir = process.env.C2B_STATE_DIR || defaultStateDir();
  const logger = new Logger(stateDir);
  logger.enableFile(stateDir);

  const existing = readState(stateDir);
  const httpPort = Number(process.env.C2B_HTTP_PORT || existing?.httpPort || 8787);
  const blenderPort = Number(process.env.C2B_BLENDER_PORT || existing?.blenderPort || 8788);

  const bridge = await startBridge({
    stateDir,
    httpPort,
    blenderPort,
    token: process.env.C2B_TOKEN || existing?.token || newToken(),
    logger,
  });

  writeState(
    {
      pid: process.pid,
      token: bridge.config.token,
      httpPort,
      blenderPort,
      startedAt: bridge.startedAt,
      version: VERSION,
    },
    stateDir,
  );
  logger.info(`state dir: ${stateDir}`);
  logger.info(`pairing code: ${bridge.pairCode()}`);

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal} - shutting down`);
    try {
      await bridge.close();
    } catch {
      /* ignore */
    }
    clearState(stateDir);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => logger.error(`uncaught: ${err.message}`));
}

if (require.main === module || path.basename(process.argv[1] ?? "").startsWith("server")) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
