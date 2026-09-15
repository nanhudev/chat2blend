# Chat2Blend

> **Use your LLM subscription as the 3D brain. Let Blender execute.**

Chat2Blend (C2B) captures Blender Python streaming out of ChatGPT (or any web LLM) and executes it inside a visible, already-open Blender instance — no copy/paste, no API key, no second coding agent burning tokens.

```
User
 ↓
ChatGPT Web
 ↓
Streaming Blender Python
 ↓
Chat2Blend Browser Extension
 ↓
Local Bridge
 ↓
Blender Add-on
 ↓
Visible 3D model
```

## Why it exists

You already pay for ChatGPT/Claude/Gemini. Coding agents (Codex, Cursor, etc.) should not spend tokens rewriting the same `bpy` code. Chat2Blend is a **transport and execution layer**, not a model. It makes the LLM you already have generate geometry, then gets that geometry into Blender in real time.

- **No OpenAI API key.** Uses the ChatGPT page the user is already logged into.
- **No coding-agent token waste.** Agents just say "use Chat2Blend".
- **Streaming execution.** The first chunk runs in Blender while later chunks are still being generated.
- **Local-first.** Loopback only. No tunnels, no cloud, no SaaS.

## Status

Windows: **tested** (Blender 4.2.9, Chrome/Edge-compatible extension)
macOS: architecture supported / experimental  
Linux: architecture supported / experimental

Core loop is real and verified: `ChatGPT-style streamed chunks → Bridge → Blender GUI → 3D model`.

## Quick start

### 1. Requirements

- Windows 10/11, macOS, or Linux
- Node.js ≥ 20
- Blender 4.x
- Chrome or Edge

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

### 5. Install the browser extension

1. Open Chrome/Edge → `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select `apps/extension/dist`
4. Click the Chat2Blend icon, enter the 6-digit pairing code from `c2b pair`
5. Turn **Auto Execute ON**

### 6. Ask ChatGPT

Click **Copy Prompt** in the extension popup (or run `npm run c2b -- prompt "a modern three-seat fabric sofa"`), paste it into ChatGPT, and make sure the assistant returns code in this shape:

```python
# C2B:CHUNK setup
import bpy
...
# C2B:END

# C2B:CHUNK base
...
# C2B:END
```

Watch Blender build the model as ChatGPT writes.

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
| `pair` | Show a fresh pairing code |
| `jobs` | Recent jobs |
| `exec <file.py>` | Send a Python file straight to Blender |
| `prompt "task"` | Print the Chat2Blend prompt template |

## Demo

A real GUI run: the bridge starts, the Blender add-on connects, and `examples/cube.py` is streamed into the visible Blender window. The C2B_Cube object appears without any copy/paste.

![Chat2Blend executing a cube in Blender GUI](docs/demo-cube.png)

## Architecture

```
ChatGPT Web
    ↓  DOM streaming
Browser Extension (capture + dedupe + pair)
    ↓  localhost:8787 HTTP + token
Local Bridge (jobs, queue, auth, logs)
    ↓  localhost:8788 line-delimited JSON TCP
Blender Add-on (main-thread executor, shared namespace)
    ↓
Blender Scene
```

- **Browser extension** is Manifest V3 TypeScript. It watches the provider DOM, supports ChatGPT, and falls back to manual **Send Current Code**.
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
Use Chat2Blend to generate the Blender asset. Run `c2b status` first; if Blender is not connected, tell the user to open Blender and enable the add-on. Then let the user ask ChatGPT from the browser extension.
```

See [`skill/SKILL.md`](skill/SKILL.md) and [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md).

## Security

Chat2Blend executes LLM-generated Python in Blender. That is inherently powerful.

- Bridge binds **127.0.0.1 only**. `0.0.0.0` is not allowed.
- Extension must pair with a 6-digit code before it receives the bridge token.
- Web origins outside `chrome-extension://` / `http://127.0.0.1` / `http://localhost` are rejected.
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

The repo includes a real GUI E2E test:

```bash
node scripts/e2e-blender.mjs examples/sofa_chunks.py 1200
```

This starts a bridge, opens Blender GUI, connects the add-on, streams C2B chunks, and checks that the model appears in the scene. It does not require a real ChatGPT session.

## Roadmap

- Multi-provider adapters (Claude Web, Gemini Web, DeepSeek, Grok, local LLMs)
- Manual code editing / retry / skip in UI
- Headless mode for CI
- Godot export pipeline
- Team features / cloud collaboration (not in core)

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## License

MIT © Chat2Blend contributors
