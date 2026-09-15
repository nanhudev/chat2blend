import * as http from "node:http";

export interface RouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  /** token supplied by the caller (if any) */
  token?: string;
  origin?: string;
}

export type Handler = (ctx: RouteContext) => void | Promise<void>;

export interface Route {
  method: string;
  pattern: string;
  handler: Handler;
}

export const MAX_BODY = 8 * 1024 * 1024; // 8MB - a big model is still just text

export function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

export function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { ok: false, error: message });
}

export function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      parts.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(parts).toString("utf8");
      if (!raw.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("invalid json body"));
      }
    });
    req.on("error", reject);
  });
}

export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | undefined {
  for (const route of routes) {
    if (route.method !== method && !(method === "OPTIONS")) continue;
    const params: Record<string, string> = {};
    const rp = route.pattern.split("/").filter(Boolean);
    const ap = pathname.split("/").filter(Boolean);
    if (rp.length !== ap.length) continue;
    let ok = true;
    for (let i = 0; i < rp.length; i++) {
      const r = rp[i];
      const a = ap[i];
      if (r.startsWith(":")) params[r.slice(1)] = decodeURIComponent(a);
      else if (r !== a) {
        ok = false;
        break;
      }
    }
    if (ok) return { route, params };
  }
  return undefined;
}

/**
 * A web page must not be able to drive the bridge. Only our own extension
 * (chrome-extension origin), loopback tools and requests with no Origin
 * (curl / CLI) are accepted.
 */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // curl / CLI / same-origin
  const o = origin.toLowerCase();
  if (o.startsWith("chrome-extension://")) return true;
  if (o.startsWith("moz-extension://")) return true;
  if (o.startsWith("http://127.0.0.1") || o.startsWith("http://localhost") || o.startsWith("http://[::1]")) return true;
  return false;
}

export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}
