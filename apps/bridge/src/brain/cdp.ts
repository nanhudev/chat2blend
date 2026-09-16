import * as http from "node:http";
import * as crypto from "node:crypto";

/**
 * Minimal zero-dependency Chrome DevTools Protocol client.
 *
 * Chat2Blend uses it to drive the *local ChatGPT desktop app* (an Electron/
 * Chromium app) through its local debugging port. No browser, no extension,
 * no API key — the desktop app owns the session and the network path.
 */

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export interface CdpVersion {
  Browser: string;
  "Protocol-Version": string;
}

export function cdpHttp(port: number, path: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path, timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`invalid JSON from ${path}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`timeout ${path}`)));
  });
}

/** Is something already serving CDP on this port? */
export async function cdpReachable(port: number): Promise<boolean> {
  try {
    await cdpHttp(port, "/json/version", 2000);
    return true;
  } catch {
    return false;
  }
}

export async function listTargets(port: number): Promise<CdpTarget[]> {
  const list = (await cdpHttp(port, "/json/list", 5000)) as CdpTarget[];
  return Array.isArray(list) ? list : [];
}

/** WebSocket client (RFC 6455) — just enough for CDP text frames. */
export class WsClient {
  private buf = Buffer.alloc(0);
  readonly handlers = new Map<number, (msg: any) => void>();
  onmessage: ((msg: any) => void) | null = null;

  constructor(private readonly socket: import("node:net").Socket) {
    socket.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      this.drain();
    });
    socket.on("error", () => {
      /* caller handles close */
    });
  }

  static connect(url: string): Promise<WsClient> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const key = crypto.randomBytes(16).toString("base64");
      const req = http.request({
        host: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Key": key,
          "Sec-WebSocket-Version": "13",
        },
      });
      req.on("upgrade", (_res, socket) => resolve(new WsClient(socket)));
      req.on("error", reject);
      req.end();
    });
  }

  private drain(): void {
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      let mask: Buffer | null = null;
      if (masked) {
        if (this.buf.length < off + 4) return;
        mask = this.buf.subarray(off, off + 4);
        off += 4;
      }
      if (this.buf.length < off + len) return;
      const payload = Buffer.from(this.buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      this.buf = this.buf.subarray(off + len);
      if (opcode === 8) {
        this.close();
        return;
      }
      if (opcode !== 1) continue;
      let msg: any;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch {
        continue;
      }
      if (msg.id && this.handlers.has(msg.id)) {
        const h = this.handlers.get(msg.id)!;
        this.handlers.delete(msg.id);
        h(msg);
      } else if (this.onmessage) {
        this.onmessage(msg);
      }
    }
  }

  send(obj: unknown): void {
    const data = Buffer.from(JSON.stringify(obj), "utf8");
    const mask = crypto.randomBytes(4);
    let header: Buffer;
    if (data.length < 126) {
      header = Buffer.from([0x81, 0x80 | data.length]);
    } else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.from(data);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  close(): void {
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
  }
}

export class CdpClient {
  private id = 0;

  constructor(readonly ws: WsClient) {}

  static async attach(port: number, matcher?: (t: CdpTarget) => boolean): Promise<{ cdp: CdpClient; target: CdpTarget }> {
    const pages = (await listTargets(port)).filter((t) => t.type === "page");
    const target = (matcher ? pages.find(matcher) : undefined) ?? pages[0];
    if (!target || !target.webSocketDebuggerUrl) throw new Error(`no attachable page target on CDP port ${port}`);
    const ws = await WsClient.connect(target.webSocketDebuggerUrl);
    return { cdp: new CdpClient(ws), target };
  }

  send(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out after ${timeoutMs}ms`)), timeoutMs);
      this.ws.handlers.set(id, (m) => {
        clearTimeout(timer);
        if (m.error) reject(new Error(`${method}: ${JSON.stringify(m.error).slice(0, 300)}`));
        else resolve(m.result);
      });
      this.ws.send({ id, method, params });
    });
  }

  async evaluate<T = unknown>(expression: string, timeoutMs = 20_000): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (r?.exceptionDetails) {
      const desc = r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails);
      throw new Error(`evaluate failed: ${String(desc).slice(0, 400)}`);
    }
    return r?.result?.value as T;
  }

  close(): void {
    this.ws.close();
  }
}
