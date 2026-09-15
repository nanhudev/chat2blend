import * as net from "node:net";
import type { BlenderToBridge, BridgeToBlender } from "../../../packages/protocol/src/index.js";
import type { Logger } from "./logger.js";
import { VERSION } from "./config.js";

const HEARTBEAT_MS = 5000;
const TIMEOUT_MS = 20000;

/**
 * Bridge <-> Blender transport: newline delimited JSON over a loopback TCP
 * socket.
 *
 * Why not a WebSocket: Blender's bundled Python has no third-party packages
 * available, and requiring users to `pip install websockets` into Blender is
 * the single most common way this kind of add-on fails to install. A ~40 line
 * stdlib client in the add-on is deterministic and dependency free. The
 * transport is isolated behind this class so a WS transport can be added later.
 */
export class BlenderTransport {
  private server: net.Server;
  private socket: net.Socket | null = null;
  private buffer = "";
  private timer: NodeJS.Timeout | null = null;
  private lastPong = 0;

  public onMessage: ((msg: BlenderToBridge) => void) | null = null;
  public onConnectionChange: ((connected: boolean) => void) | null = null;
  public blenderVersion: string | undefined;
  public addonVersion: string | undefined;
  public lastHeartbeatAt: number | undefined;

  constructor(
    private port: number,
    private host: string,
    private logger: Logger,
  ) {
    this.server = net.createServer((sock) => this.handleSocket(sock));
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        const addr = this.server.address() as net.AddressInfo | null;
        if (addr) this.logger.info(`blender transport listening on ${addr.address}:${addr.port}`);
        else this.logger.info(`blender transport listening on ${this.host}:${this.port}`);
        this.timer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
        resolve();
      });
    });
  }

  get addressInfo(): net.AddressInfo | null {
    const addr = this.server.address();
    return addr && typeof addr !== "string" ? addr : null;
  }

  private handleSocket(sock: net.Socket): void {
    const remote = `${sock.remoteAddress}:${sock.remotePort}`;
    if (sock.remoteAddress !== "127.0.0.1" && sock.remoteAddress !== "::1" && sock.remoteAddress !== "::ffff:127.0.0.1") {
      this.logger.warn(`rejecting non-loopback blender connection from ${remote}`);
      sock.destroy();
      return;
    }
    if (this.socket) {
      this.logger.warn("a second Blender instance connected - replacing the previous one");
      this.socket.destroy();
    }
    this.socket = sock;
    this.buffer = "";
    this.lastPong = Date.now();
    this.logger.info(`blender connected (${remote})`);
    sock.setNoDelay(true);
    sock.on("data", (d) => this.onData(d));
    sock.on("close", () => {
      if (this.socket === sock) {
        this.socket = null;
        this.blenderVersion = undefined;
        this.addonVersion = undefined;
        this.logger.info("blender disconnected");
        this.onConnectionChange?.(false);
      }
    });
    sock.on("error", (err) => this.logger.warn(`blender socket error: ${err.message}`));
    this.send({ type: "welcome", bridgeVersion: VERSION, protocol: "c2b/1" });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as BlenderToBridge;
        if (msg.type === "hello") {
          this.blenderVersion = msg.blenderVersion;
          this.addonVersion = msg.addonVersion;
          this.logger.info(`blender handshake ok (Blender ${msg.blenderVersion}, addon ${msg.addonVersion})`);
          this.onConnectionChange?.(true);
        }
        if (msg.type === "pong") this.lastPong = Date.now();
        if (msg.type === "log") {
          this.logger.info(`blender: ${msg.message}`);
        }
        this.onMessage?.(msg);
      } catch (err) {
        this.logger.warn(`bad frame from blender: ${(err as Error).message}`);
      }
    }
  }

  private heartbeat(): void {
    if (!this.socket) return;
    if (Date.now() - this.lastPong > TIMEOUT_MS) {
      this.logger.warn("blender heartbeat timeout - dropping connection");
      this.socket.destroy();
      this.socket = null;
      this.onConnectionChange?.(false);
      return;
    }
    this.send({ type: "ping", t: Date.now() });
  }

  get connected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  send(msg: BridgeToBlender): boolean {
    if (!this.connected) return false;
    try {
      this.socket!.write(JSON.stringify(msg) + "\n", "utf8");
      return true;
    } catch (err) {
      this.logger.warn(`send failed: ${(err as Error).message}`);
      return false;
    }
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.server.close();
  }
}
