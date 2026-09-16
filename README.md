<div align="center">

<img src="docs/assets/hero.svg" alt="Describe it. Watch Blender build it." width="100%">

# Chat2Blend

### Describe it. Watch Blender build it.

**Turn ChatGPT into a live 3D modelling partner for Blender.**

No copy/paste. No OpenAI API key. No second coding agent.

```bash
npm install -g chat2blend
```

[Get started](#-quick-start-3-minutes) · [How it feels](#what-does-it-feel-like) · [How it works](#how-it-works) · [中文](README.zh-CN.md)

[![CI](https://github.com/nanhudev/chat2blend/actions/workflows/ci.yml/badge.svg)](https://github.com/nanhudev/chat2blend/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/chat2blend.svg)](https://www.npmjs.com/package/chat2blend)
[![npm downloads](https://img.shields.io/npm/dm/chat2blend.svg)](https://www.npmjs.com/package/chat2blend)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/chat2blend.svg)](https://nodejs.org)

</div>

---

## What does it feel like?

You type this into the Chat2Blend CLI:

```bash
c2b brain "a modern three-seat fabric sofa" --wait
```

ChatGPT writes the Blender Python. Chat2Blend runs each finished chunk in Blender
**while the rest is still being generated**. You sit back and watch the sofa
appear — arm by arm, cushion by cushion.

```
You
 │  "a modern three-seat fabric sofa"
 ▼
ChatGPT  ─────  writes Blender Python
 │
 ▼
Chat2Blend  ───  streams finished chunks
 │
 ▼
Blender  ──────  executes them live
 │
 ▼
🛋  a sofa in your scene
```

Below is a **real, unedited screenshot** — a genuine Blender GUI run, with 6
streaming chunks creating 14 objects.

<div align="center">
<img src="docs/assets/demo-sofa.png" alt="A three-seat fabric sofa built live inside Blender" width="100%">
</div>

<sub>Real output of <code>a modern three-seat fabric sofa with rounded cushions</code>, streamed into a visible Blender 4.2.9. The outliner on the right lists the 14 <code>C2B_*</code> objects Chat2Blend created — <code>Arm_L/R</code>, <code>Back_1..3</code>, <code>Seat_1..3</code>, <code>Leg_1..4</code>, <code>Frame_Base/Back</code>. This run used synthetic chunks (<code>scripts/e2e-blender.mjs</code>) to isolate the Blender execution path.</sub>

<sub>For the full round trip through a **real ChatGPT session**, see the numbers in <a href="docs/PROJECT_STATUS.md">docs/PROJECT_STATUS.md</a>: <code>"a low-poly wooden side table"</code> → 8 chunks, 38 objects, first geometry visible in 38.6s.</sub>

---

## Why?

Generating Blender Python with an LLM already works. **The annoying part is everything around it.**

Normally you:

1. Ask ChatGPT for `bpy` code
2. Wait for the entire answer
3. Copy the code
4. Open Blender
5. Paste it into the script editor
6. Run it
7. Hit an error
8. Go back to ChatGPT
9. Repeat

Chat2Blend removes the middle.

You describe the asset. ChatGPT writes the Blender code. **Completed chunks run in Blender the moment they arrive**, so you see progress instead of waiting for a wall of text.

- **No copy/paste.** The code never touches your clipboard.
- **No API billing.** It uses the ChatGPT desktop app you already pay for.
- **No second agent.** Your coding agent doesn't burn tokens rewriting `bpy`.
- **Visible execution.** Everything happens in the Blender window in front of you.
- **Local-first.** Loopback only. No tunnels, no cloud, no telemetry.

---

## ⚡ Quick start (3 minutes)

### 1. Install

```bash
npm install -g chat2blend
```

Requires **Node.js ≥ 20** and **Blender 4.x**.

### 2. Run setup

```bash
c2b setup
```

This checks your machine and prints the **exact** next steps for *your* install —
including the absolute path of the Blender add-on you need to pick.

### 3. Install the Blender add-on

In Blender: `Edit ▸ Preferences ▸ Add-ons ▸ Install…`

Choose the path printed by `c2b setup` (it ends in `blender_addon/chat2blend/__init__.py`).

Then enable **Chat2Blend** and click **Connect** in the Chat2Blend tab of Blender's side bar (`N`).

### 4. Start the bridge and attach ChatGPT

```bash
c2b start          # starts the local bridge
c2b brain-attach   # finds (or launches) the ChatGPT desktop app
```

The ChatGPT desktop app must be installed and logged in — `c2b doctor` will tell you.

### 5. Build something

```bash
c2b brain "a low-poly wooden side table" --wait
```

Watch your Blender window. That's it.

> **Stuck?** Run `c2b status` at any point. It reports whether the bridge, Blender
> and the ChatGPT app are each ready, and tells you what to do about the one
> that isn't.

---

## Examples

```bash
c2b brain "a low-poly wooden side table" --wait
c2b brain "a modern three-seat fabric sofa" --wait
c2b brain "a stack of three ceramic coffee mugs" --wait
c2b brain "a mid-century modern armchair" --wait
```

Don't want to wait for it? Drop `--wait` and poll instead:

```bash
c2b brain "a wooden bookshelf with 4 shelves"
c2b brain-status <jobId>
```

Other ways in:

```bash
c2b exec examples/cube.py     # send a Python file straight into Blender
c2b prompt "a modern sofa"    # print the modelling prompt Chat2Blend uses
c2b jobs                      # list recent jobs
c2b logs                      # tail the bridge log
```

---

## How it works

```
ChatGPT Desktop App  (your login, no API key)
      │  CDP on 127.0.0.1:9333
      ▼
Local Brain  ── finds the window, fills the composer, reads the code blocks
      │  HTTP on 127.0.0.1:8787
      ▼
Bridge  ── jobs, queue, auth, logs
      │  line-delimited JSON over TCP on 127.0.0.1:8788
      ▼
Blender Add-on  ── executes on the main thread, shared namespace
      ▼
Blender Scene
```

**The local brain** is zero-dependency TypeScript that talks to the ChatGPT desktop
app over the Chrome DevTools Protocol. It fills the composer, waits for the answer,
and extracts Python code blocks from the rendered conversation. No browser
extension, no scraped DOM, no third-party cookies.

**The bridge** is zero-dependency Node.js — `/api/*` routes plus a
line-delimited JSON socket to Blender.

**The Blender add-on** is pure Python stdlib + `bpy`. Networking runs on a
background thread; execution is drained on the main thread via `bpy.app.timers`,
which is why your Blender window stays responsive and *visible*.

<details>
<summary><b>The C2B chunk protocol</b></summary>

To get streaming execution, the LLM wraps its output in chunk markers:

```python
# C2B:CHUNK arm_left
...python...
# C2B:END
```

Rules: Blender 4.x `bpy` API; helpers defined before use; earlier chunks cannot
depend on later chunks; every chunk is a standalone valid Python block.

If the model doesn't follow the protocol, Chat2Blend falls back to executing
complete ` ```python ` fences after generation ends.

See [`docs/PROTOCOL.md`](docs/PROTOCOL.md) and [`docs/STREAMING.md`](docs/STREAMING.md).
</details>

---

## Agent integration

Coding agents should **not** generate large `bpy` scripts when Chat2Blend is available.

```text
Use Chat2Blend to generate the Blender asset. Run `c2b status` first; if Blender is
not connected, tell the user to open Blender and enable the add-on. Then run
`c2b brain "<asset description>" --wait` and report the resulting job status.
```

The agent never writes or sees the generated `bpy` code — it only receives compact
chunk status, object counts and time-to-first-frame.

See [`skill/SKILL.md`](skill/SKILL.md) and [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md).

---

## Current support

| Platform | Status |
|---|---|
| **Windows 10/11** | ✅ Tested end-to-end (Blender 4.2.9 + ChatGPT desktop app) |
| **macOS** | 🧪 Architecture supported, not yet verified on real hardware |
| **Linux** | 🧪 Architecture supported, not yet verified on real hardware |

The core loop is real and verified: `natural language → ChatGPT desktop app → bridge → Blender GUI → 3D model`.

---

## Security

Chat2Blend executes LLM-generated Python inside Blender. That is inherently powerful, so:

- The bridge binds **`127.0.0.1` only**. Binding `0.0.0.0` is refused.
- The local brain only connects to the ChatGPT desktop app on *this* machine.
- Web origins outside `http://127.0.0.1` / `http://localhost` are rejected.
- **We never ask for ChatGPT credentials, OpenAI API keys, or browser cookies.**

Read the full threat model in [`docs/SECURITY.md`](docs/SECURITY.md).
To report a vulnerability, see [`SECURITY.md`](./SECURITY.md).

---

## Development

```bash
git clone https://github.com/nanhudev/chat2blend.git
cd chat2blend
npm install
npm run build          # TypeScript + extension
npm run typecheck
npm test               # parser + bridge integration tests
npm run package:blender
```

### End-to-end verification

A real GUI test that drives the ChatGPT desktop app:

```bash
node scripts/e2e-brain.mjs "a low-poly wooden side table"
```

It starts a bridge, opens the Blender GUI, connects the add-on, drives the local
ChatGPT app, waits for the generated chunks and checks that the model appears in
the scene. Requires a logged-in ChatGPT desktop app.

A synthetic, no-LLM variant that streams chunks from disk:

```bash
node scripts/e2e-blender.mjs examples/sofa_chunks.py 1200
```

There is a hard rule in this project: **no fake success.** See
[`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

## Roadmap

- Multi-provider adapters (Claude, Gemini, DeepSeek, Grok, local LLMs)
- Manual edit / retry / skip of individual chunks
- Headless mode for CI
- Godot export pipeline

See [`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Documentation

| Doc | What it covers |
|-----|----------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Component-by-component design |
| [`docs/PROTOCOL.md`](docs/PROTOCOL.md) | The C2B/1 chunk protocol |
| [`docs/STREAMING.md`](docs/STREAMING.md) | Streaming parser and dedupe |
| [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md) | Using Chat2Blend from a coding agent |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What's next |
| [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) | Verified vs. experimental |
| [`CHANGELOG.md`](CHANGELOG.md) | Release history |

---

## Contributing

Bug reports, ideas and PRs are welcome — start with [`CONTRIBUTING.md`](./CONTRIBUTING.md).
Please also read the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## License

MIT © Chat2Blend contributors

Chat2Blend is an independent open-source project. It is **not** affiliated with,
endorsed by, or supported by OpenAI or the Blender Foundation. "ChatGPT" is a
trademark of OpenAI; "Blender" is a trademark of the Blender Foundation. You must
comply with the terms of any chat subscription you use this with.
