import test from "node:test";
import assert from "node:assert/strict";
import * as net from "node:net";
import { startBridge } from "../src/bridge.js";

async function api<T>(base: string, token: string, pathname: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: { "content-type": "application/json", "x-c2b-token": token, ...(init?.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || `http ${res.status}`);
  return json;
}

function fakeBlender(port: number): Promise<{ socket: net.Socket; messages: any[]; send: (msg: any) => void; clear: () => void }> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ port, host: "127.0.0.1" }, () => {
      const messages: any[] = [];
      let buf = "";
      sock.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) messages.push(JSON.parse(line));
        }
      });
      resolve({
        socket: sock,
        messages,
        send: (msg: any) => sock.write(JSON.stringify(msg) + "\n"),
        clear: () => messages.length = 0,
      });
    });
    sock.setTimeout(5000);
    sock.on("error", reject);
  });
}

function waitFor(predicate: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() > deadline) return reject(new Error("timeout"));
      setTimeout(check, 50);
    };
    check();
  });
}

test("bridge runs end-to-end with a fake Blender client", async () => {
  const bridge = await startBridge({ httpPort: 0, blenderPort: 0, token: "test-token", verbose: false });
  const base = `http://127.0.0.1:${bridge.config.httpPort}`;
  try {
    const health = await api<{ ok: boolean }>(base, "test-token", "/health");
    assert.equal(health.ok, true);

    // token is required
    const noAuth = await fetch(`${base}/api/status`);
    assert.equal(noAuth.status, 401);

    // fake Blender connects
    const fake = await fakeBlender(bridge.config.blenderPort);
    await waitFor(() => fake.messages.some((m) => m.type === "welcome"), 2000);
    fake.send({ type: "hello", addonVersion: "0.1.0-test", blenderVersion: "4.2.9", protocol: "c2b/1" });

    const status = await api<{ blender: { connected: boolean } }>(base, "test-token", "/api/status");
    assert.equal(status.blender.connected, true);

    // execute a simple cube command
    const exec = await api<{ jobId: string }>(base, "test-token", "/api/exec", {
      method: "POST",
      body: JSON.stringify({ code: "import bpy\nbpy.ops.mesh.primitive_cube_add()\n", title: "cube" }),
    });
    await waitFor(() => fake.messages.some((m) => m.type === "exec"), 3000);
    const execMsg = fake.messages.find((m) => m.type === "exec");
    assert.ok(execMsg);
    assert.match(execMsg.code, /primitive_cube_add/);

    fake.send({ type: "chunk_result", jobId: execMsg.jobId, chunkId: execMsg.chunkId, status: "completed", sceneObjects: 5, durationMs: 12 });

    await waitFor(async () => {
      const s = await api<{ status: string }>(base, "test-token", `/api/jobs/${exec.jobId}`);
      return s.status === "completed";
    }, 3000);

    // duplicate /api/exec with same code creates a new job but the bridge should accept it
    const exec2 = await api<{ jobId: string }>(base, "test-token", "/api/exec", {
      method: "POST",
      body: JSON.stringify({ code: "import bpy\nbpy.ops.mesh.primitive_cube_add()\n", title: "cube2" }),
    });
    assert.notEqual(exec.jobId, exec2.jobId);

    fake.socket.destroy();
  } finally {
    await bridge.close();
  }
});

test("pairing rejects invalid codes", async () => {
  const bridge = await startBridge({ httpPort: 0, blenderPort: 0, token: "test-token2", verbose: false });
  const base = `http://127.0.0.1:${bridge.config.httpPort}`;
  try {
    const res = await fetch(`${base}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    assert.equal(res.status, 401);
  } finally {
    await bridge.close();
  }
});

test("extension-style streaming chunk flow", async () => {
  const bridge = await startBridge({ httpPort: 0, blenderPort: 0, token: "test-token3", verbose: false });
  const base = `http://127.0.0.1:${bridge.config.httpPort}`;
  const fake = await fakeBlender(bridge.config.blenderPort);
  try {
    await waitFor(() => fake.messages.some((m) => m.type === "welcome"), 2000);
    fake.send({ type: "hello", addonVersion: "0.1.0-test", blenderVersion: "4.2.9", protocol: "c2b/1" });

    const job = await api<{ jobId: string }>(base, "test-token3", "/api/jobs", {
      method: "POST",
      body: JSON.stringify({ provider: "chatgpt", title: "stream-test" }),
    });

    const chunks = [
      { name: "setup", index: 0, code: "import bpy\n" },
      { name: "cube", index: 1, code: "bpy.ops.mesh.primitive_cube_add()\n" },
    ];
    for (const c of chunks) {
      await api(base, "test-token3", `/api/jobs/${job.jobId}/chunks`, {
        method: "POST",
        body: JSON.stringify({ name: c.name, index: c.index, code: c.code, hash: "x" + c.index }),
      });
    }

    await waitFor(() => fake.messages.some((m) => m.type === "exec"), 3000);
    const exec1 = fake.messages.find((m) => m.type === "exec")!;
    assert.equal(exec1.name, "setup");
    fake.send({
      type: "chunk_result",
      jobId: exec1.jobId,
      chunkId: exec1.chunkId,
      status: "completed",
      sceneObjects: 1,
      durationMs: 1,
    });

    await waitFor(() => fake.messages.filter((m) => m.type === "exec").length >= 2, 4000);
    const execs = fake.messages.filter((m) => m.type === "exec");
    assert.equal(execs.length, 2);
    assert.equal(execs[1].name, "cube");

    // dedupe: send the same chunk again
    await api(base, "test-token3", `/api/jobs/${job.jobId}/chunks`, {
      method: "POST",
      body: JSON.stringify({ name: chunks[0].name, index: chunks[0].index, code: chunks[0].code, hash: "x" + chunks[0].index }),
    });

    // no new exec should appear within 1s
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(fake.messages.filter((m) => m.type === "exec").length, 2, "duplicate chunk must not re-execute");

    fake.socket.destroy();
  } finally {
    await bridge.close();
  }
});
