# Chat2Blend

> **Use your LLM subscription as the 3D brain. Let Blender execute.**

Chat2Blend (C2B) turns the *local ChatGPT desktop app* into a Blender Python generator and executes the output inside a visible, already-open Blender instance — no copy/paste, no API key, no browser extension, no second coding agent burning tokens.

```
User
 ↓
Local ChatGPT Desktop App (your existing login/session)
 ↓  CDP on 127.0.0.1:9333
Chat2Blend Local Brain
 ↓
Local Bridge
 ↓
Blender Add-on
 ↓
Visible 3D model
```

> A browser-extension path (legacy) is still present but deprecated; see below.

## Why it exists

You already pay for ChatGPT/Claude/Gemini. Coding agents (Codex, Cursor, etc.) should not spend tokens rewriting the same `bpy` code. Chat2Blend is a **transport and execution layer**, not a model. It makes the LLM you already have generate geometry, then gets that geometry into Blender in real time.

- **No OpenAI API key.** Uses the ChatGPT desktop app that is already logged in.
- **No browser extension.** Drives the app directly over its local debugging port.
- **No coding-agent token waste.** Agents just say "use Chat2Blend".
- **Streaming execution.** The first chunk runs in Blender while later chunks are still being generated.
- **Local-first.** Loopback only. No tunnels, no cloud, no SaaS.

## Status

Windows: **tested** (Blender 4.2.9, local ChatGPT desktop app via CDP)
macOS: architecture supported / experimental  
Linux: architecture supported / experimental

Core loop is real and verified: `natural language → local ChatGPT desktop app → Bridge → Blender GUI → 3D model`.

## Quick start

### 1. Requirements

- Windows 10/11, macOS, or Linux
- Node.js ≥ 20
- Blender 4.x
- ChatGPT desktop app (Windows MSIX store install) — logged in

### 2. Install

```bash
git clone https://github.com/nanhudev/chat2blend.git
cd chat2blend
npm install
npm run build
```

### 3. Install the Blender add-on

```bash
npm run package:blender
```

Open Blender → `Edit > Preferences > Add-ons > Install...` → choose `dist/chat2blend-blender.zip` → enable **Chat2Blend**. The add-on auto-connects to the local bridge.

### 4. Start the bridge

```bash
npm run c2b -- start
# or after build:
node dist/apps/bridge/src/cli.js start
```

This starts a loopback-only HTTP server on `127.0.0.1:8787` and a TCP transport on `127.0.0.1:8788`.

### 5. Attach the local ChatGPT brain

Make sure the ChatGPT desktop app is running and logged in.

```bash
npm run c2b -- brain-attach
```

The bridge finds the app, attaches to its local debugging port (default `127.0.0.1:9333`), and verifies the composer is ready.

### 6. Ask ChatGPT (local)

```bash
npm run c2b -- brain "a low-poly wooden side table"
npm run c2b -- brain "..." --wait
```

Watch Blender build the model while the local ChatGPT app generates it.

> **Legacy browser-extension path:** the extension code is still present in `apps/extension` but is no longer the recommended flow. Use it only if you cannot install the ChatGPT desktop app.

## CLI

```bash
npm run c2b -- <command>
```

| Command | Purpose |
|---------|---------|
| `start` | Start the bridge daemon |
| `stop` | Stop the bridge |
| `status` | Bridge / Blender / extension status |
| `doctor` | Full diagnostics |
| `pair` | Show a fresh pairing code (legacy extension) |
| `brain "task"` | Submit a task to the local ChatGPT desktop app |
| `brain-attach` | Attach to / launch the local ChatGPT app |
| `brain-status [id]` | Brain health or compact job status |
| `prompt "task"` | Print the Chat2Blend prompt template |

## Demo

A real GUI run: the bridge starts, the Blender add-on connects, and `examples/cube.py` is streamed into the visible Blender window. The C2B_Cube object appears without any copy/paste.

![Chat2Blend executing a cube in Blender GUI](docs/demo-cube.png)

## Architecture

```
ChatGPT Desktop App
    ↓  CDP on 127.0.0.1:9333
Local Brain (finds the window, fills the composer, reads the code blocks)
    ↓  localhost:8787 HTTP + token
Local Bridge (jobs, queue, auth, logs)
    ↓  localhost:8788 line-delimited JSON TCP
Blender Add-on (main-thread executor, shared namespace)
    ↓
Blender Scene
```

- **Local brain** is zero-runtime-dependency TypeScript that talks to the local ChatGPT desktop app via Chrome DevTools Protocol. It fills the composer, waits for the answer, and extracts Python code blocks (with C2B markers) from the rendered conversation. No browser extension, no scraped DOM, no third-party cookies.
- **Bridge** is zero-runtime-dependency Node.js. It exposes `/api/*` routes and a line-delimited JSON socket to Blender.
- **Blender add-on** is pure Python stdlib + `bpy`. Network runs in a background thread; execution is drained on the main thread via `bpy.app.timers`.

Read more in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## The C2B Protocol (v1)

To get streaming execution, ask the LLM to wrap chunks in:

```python
# C2B:CHUNK <name>
...python...
# C2B:END
```

Rules:

- `bpy`, Blender 4.x API
- define helpers before use
- earlier chunks cannot depend on later chunks
- every chunk must be a standalone valid Python block

If the LLM does not follow the protocol, Chat2Blend falls back to executing complete ` ```python ` fences after generation ends.

Read more in [`docs/PROTOCOL.md`](docs/PROTOCOL.md) and [`docs/STREAMING.md`](docs/STREAMING.md).

## Agent integration

Coding agents should **not** generate large `bpy` scripts when Chat2Blend is available. Instead:

```text
Use Chat2Blend to generate the Blender asset. Run `c2b status` first; if Blender is not connected, tell the user to open Blender and enable the add-on. Then run `c2b brain "<asset description>" --wait` and poll the returned job status.
```

The harness (agent) never writes or sees the generated `bpy` code — it only receives compact chunk status, object counts, and TTFF.

See [`skill/SKILL.md`](skill/SKILL.md) and [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md).

## Security

Chat2Blend executes LLM-generated Python in Blender. That is inherently powerful.

- Bridge binds **127.0.0.1 only**. `0.0.0.0` is not allowed.
- The local brain only connects to the ChatGPT desktop app running on this machine.
- Web origins outside `http://127.0.0.1` / `http://localhost` are rejected.
- We never ask for ChatGPT credentials, OpenAI API keys, or browser cookies.

Read more in [`docs/SECURITY.md`](docs/SECURITY.md).

## Development

```bash
npm run build        # TypeScript + extension
npm run typecheck    # TypeScript only
npm run test         # Parser + bridge integration tests
npm run build:extension
npm run package:blender
```

### End-to-end verification

The repo includes a real GUI E2E test for the local-brain path:

```bash
node scripts/e2e-brain.mjs "a low-poly wooden side table"
```

This starts a bridge, opens Blender GUI, connects the add-on, drives the local ChatGPT desktop app, waits for the generated C2B chunks, and checks that the model appears in the scene. It requires the ChatGPT desktop app to be installed and logged in.

There is also a synthetic, no-LLM test that streams chunks from disk:

```bash
node scripts/e2e-blender.mjs examples/sofa_chunks.py 1200
```

This starts a bridge, opens Blender GUI, connects the add-on, streams C2B chunks from the example file, and checks that the model appears in the scene. It does not require a real ChatGPT session.

## Roadmap

- Multi-provider adapters (Claude Web, Gemini Web, DeepSeek, Grok, local LLMs)
- Manual code editing / retry / skip in UI
- Headless mode for CI
- Godot export pipeline
- Team features / cloud collaboration (not in core)

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## License

MIT © Chat2Blend contributors
