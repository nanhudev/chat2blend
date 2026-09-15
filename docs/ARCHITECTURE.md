# Architecture

## Overview

Chat2Blend is deliberately split into three small pieces:

1. **Browser Extension** — captures LLM output from the provider page.
2. **Local Bridge** — accepts chunks from the extension, tracks jobs, and pushes them to Blender.
3. **Blender Add-on** — receives chunks over a loopback socket and executes them on Blender's main thread.

This separation keeps the project local-first, dependency-light, and easy to reason about.

```
┌─────────────────┐   DOM   ┌──────────────────┐  HTTP  ┌──────────────┐  TCP   ┌──────────────┐
│ ChatGPT Web     │────────▶│ Browser Extension │──────▶│ C2B Bridge   │──────▶│ Blender      │
│ (or other LLM)  │         │ capture / dedupe  │        │ jobs/queue   │        │ Add-on       │
└─────────────────┘         └──────────────────┘        └──────────────┘        └──────────────┘
```

## Browser Extension

- **TypeScript, Manifest V3**, bundled with esbuild.
- Content script runs on `chatgpt.com/*` and a local fixture page.
- Uses `MutationObserver` (debounced) to detect assistant messages and code blocks.
- Implements provider adapters so the selector logic is isolated and replaceable.
- Sends chunks to the service worker, which owns the bridge token.
- Supports Auto Execute ON/OFF and a manual **Send Current Code** fallback.

## Local Bridge

- Node.js with **zero runtime dependencies**.
- Two listeners:
  - **HTTP** on `127.0.0.1:8787` for the extension and CLI.
  - **TCP line-delimited JSON** on `127.0.0.1:8788` for Blender.
- Auth: one-time 6-digit pairing code; token required for all HTTP routes except `/health` and `/api/pair`.
- Origin/loopback enforcement: refuses requests from non-local origins.
- Job manager: creates jobs, dedupes chunks by hash, queues pending chunks, and dispatches them one at a time to Blender.
- CLI: `c2b start/stop/status/doctor/pair/jobs/exec/prompt`.

## Blender Add-on

- Pure Python stdlib + `bpy`. No pip dependencies.
- TCP client thread reads frames and enqueues work.
- `bpy.app.timers` drains the queue on the main thread.
- `exec()` runs chunks inside a shared per-job namespace, so helpers defined in chunk 1 are visible in chunk 5.
- One `bpy.ops.ed.undo_push` per job, so the user can undo the whole Chat2Blend task.
- Viewport is redrawn after each chunk so the model grows visibly.

## Why line-delimited JSON instead of WebSocket?

The Blender add-on cannot rely on third-party packages. A WebSocket client written in the stdlib is possible, but line-delimited JSON is equally reliable, trivial to implement, and avoids subtle framing bugs. The transport is hidden behind `BlenderTransport`, so a WebSocket implementation can be added later without touching the rest of the system.

## Why a shared namespace instead of isolated namespaces?

Chunks from the same model depend on each other. For example, chunk 1 defines `create_material()` and chunk 3 calls it. A shared `globals/locals` dict per job is the simplest way to support this while still isolating different jobs.

## Failure model

- If a chunk fails, the job is paused, the error is shown in the Blender N-panel and extension popup, and the user can Retry or Stop.
- If Blender disconnects, the bridge queues new chunks and resumes when Blender reconnects.
- If the extension loses its token, it can re-pair.
