# Browser Extension (Deprecated)

The Manifest V3 browser extension in this folder was the original way for Chat2Blend to capture streaming code from the ChatGPT web page.

It is **kept in the repo for reference** but is no longer the recommended path.

## Why it was deprecated

- It depends on the ChatGPT web DOM, which changes frequently.
- It requires loading an unpacked extension, pairing codes, and heartbeat management.
- The local ChatGPT desktop app is now the primary brain: it is logged in, runs on the same machine, and is driven directly through Chrome DevTools Protocol (`127.0.0.1:9333`) with no browser extension at all.

## What to use instead

```bash
npm run c2b -- brain-attach
npm run c2b -- brain "a low-poly wooden side table" --wait
```

See [`../../README.md`](../../README.md) and [`../../docs/AGENT_INTEGRATION.md`](../../docs/AGENT_INTEGRATION.md).

## Keeping the code

The extension still builds (`npm run build:extension`) and the bridge still accepts extension heartbeats, but the active project path is the local-brain route implemented in `apps/bridge/src/brain/`.
