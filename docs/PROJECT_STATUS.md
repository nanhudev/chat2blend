# Chat2Blend Project Status

Milestone: **v0.2.0 — local ChatGPT desktop brain**
Date: 2026-09-17

This is a working-status snapshot, not a guarantee. Everything below marked
"verified" was actually executed on the reference machine; everything else says
so explicitly.

## Summary

The core loop is real and verified on Windows with Blender 4.2.9 and the ChatGPT
desktop app (MSIX):

- The bridge starts and exposes an HTTP API on `127.0.0.1:8787` and a
  line-delimited JSON TCP transport on `127.0.0.1:8788`.
- The local brain finds the ChatGPT desktop app, attaches over CDP
  (`127.0.0.1:9333`), types the task, waits for the answer and extracts `bpy`
  code blocks.
- The Blender add-on connects, receives chunks and executes them on the main
  thread in the visible GUI.
- C2B streaming chunks (`# C2B:CHUNK ... # C2B:END`) are parsed and executed
  incrementally, with a markdown-fence fallback.
- CLI, add-on, Agent Skill, tests, docs and npm distribution are in place.

## Component Status

| Component | Status | Notes |
|-----------|--------|-------|
| CORE_LOOP | implemented + E2E verified | Cube / table / sofa in real Blender GUI |
| LOCAL_BRAIN (CDP) | implemented + E2E verified | drives the ChatGPT desktop app; 8 chunks, 38 objects, TTFF 38.6s |
| BRIDGE | implemented + unit/integration tested | zero runtime deps, random ports tested |
| BLENDER | installed, add-on enabled, real GUI verified | auto-connect, retry, pause, stop, clear |
| STREAMING | implemented | C2B protocol + generic fence fallback |
| CHUNK_PARSER | 16 tests passing | C2B markers, split markers, dedupe, fence parsing |
| AGENT_SKILL | done | `skill/SKILL.md`, also installed to `~/.workbuddy/skills/chat2blend/` |
| HARNESS | implemented + E2E verified | legacy agent path over the web LLM |
| EXTENSION | **deprecated, kept** | see `apps/extension/DEPRECATED.md` |
| CLI | done | start/stop/status/doctor/version/brain/brain-attach/brain-status/… |
| CLI UX | done (2026-09-17) | `setup` prints the real absolute add-on path for both npm and source installs; `doctor` reports a ready-to-pick path; `brain` preflights bridge + Blender and guides instead of erroring |
| NPM | published | `npm i -g chat2blend`, ships the `c2b` binary; tarball is 69 kB (README images excluded) |
| WINDOWS | tested | real Blender GUI + real ChatGPT desktop app E2E passed |
| MACOS | architecture supported, not manually tested | paths use `os.homedir` / `path.join` |
| LINUX | architecture supported, not manually tested | common Blender paths included |
| DOCS | done | README (en/zh), ARCHITECTURE, PROTOCOL, SECURITY, STREAMING, AGENT_INTEGRATION, ROADMAP |
| COMMUNITY | done | CONTRIBUTING, CHANGELOG, CODE_OF_CONDUCT, SECURITY, issue/PR templates |
| TESTS | 16 Node tests passing | Parser + bridge integration |
| GITHUB | done | public repo <https://github.com/nanhudev/chat2blend> |
| CI | done | GitHub Actions on Ubuntu + Windows: install → typecheck → build → test → package |

## Known Limitations

1. **macOS / Linux** are not manually validated. Desktop-brain discovery
   currently looks for the Windows MSIX install; on other platforms the app must
   already be running with `--remote-debugging-port=9333`.
2. **Headless CI** does not run the Blender GUI E2E (it needs a real desktop
   session). CI runs unit tests plus a CLI smoke job.
3. The **browser extension** is frozen. No new work is planned on it.
4. The desktop brain depends on ChatGPT desktop app DOM details (composer
   selector, code-block rendering). A UI change in the app can break it until
   `chatgpt-desktop.ts` is updated.
5. Only one ChatGPT desktop conversation is driven at a time.
6. Model output is executed as your local user — see [`SECURITY.md`](../SECURITY.md).

## Test Results

```
npm test
# tests 16
# pass 16
# fail 0
```

Real GUI E2E (synthetic chunks, no LLM):

- Cube: PASS, 1 object, 2.75s
- Sofa (6 streaming chunks): PASS, 14 objects, 9.61s

Real GUI E2E (local ChatGPT desktop brain, `node scripts/e2e-brain.mjs`):

- "a low-poly wooden side table": PASS, 8 chunks completed, 38 objects,
  TTFF 38.6s, total 40.2s

## Next Actions

- [x] Push to GitHub — <https://github.com/nanhudev/chat2blend> (public)
- [x] Publish to npm — `chat2blend`
- [ ] macOS / Linux desktop-brain discovery
- [ ] Headless Blender smoke test in CI
- [ ] Multi-provider brain adapters (Claude / Gemini desktop apps, local LLMs)
- [ ] Manual chunk edit / retry / skip in the add-on UI
