# Chat2Blend Project Status

Milestone: **v0.1.0 MVP**
Date: 2026-09-16

## Summary

The core loop is real and verified on Windows with Blender 4.2.9:

- Local bridge starts and exposes HTTP + TCP loopback transports.
- Blender add-on connects, receives chunks, and executes them in the visible GUI.
- C2B streaming chunks (`# C2B:CHUNK ... # C2B:END`) are parsed and executed incrementally.
- Generic markdown code-fence fallback works.
- CLI, extension, add-on, tests, docs, and README are in place.

## Component Status

| Component | Status | Notes |
|-----------|--------|-------|
| CORE_LOOP | implemented + E2E verified | Cube / table / sofa in real Blender GUI |
| BRIDGE | implemented + unit/integration tested | zero runtime deps, random ports tested |
| EXTENSION | built, typechecked | Manual web E2E requires user's ChatGPT page or fixture page |
| BLENDER | installed, addon enabled, real GUI verified | auto-connect, retry, pause, stop, clear |
| STREAMING | implemented | C2B protocol + generic fence fallback |
| CHUNK_PARSER | 16 tests passing | C2B markers, split markers, dedupe, fence parsing |
| AGENT_SKILL | done | `skill/SKILL.md`, also installed to `~/.workbuddy/skills/chat2blend/` |
| HARNESS | implemented + E2E verified | `c2b harness "task"` -> compact status -> streaming chunks -> Blender GUI |
| CLI | done | start/stop/status/doctor/pair/jobs/exec/prompt |
| WINDOWS | tested | real Blender GUI E2E passed |
| MACOS | architecture supported, not manually tested | paths use os.homedir / path.join |
| LINUX | architecture supported, not manually tested | common blender paths included |
| DOCS | done | README, README.zh-CN, ARCHITECTURE, PROTOCOL, SECURITY, STREAMING, AGENT_INTEGRATION, ROADMAP |
| TESTS | 16 Node tests passing | Parser + bridge integration |
| GITHUB | done | public repo https://github.com/nanhudev/chat2blend — 9 commits pushed, topics set |
| CI | done | GitHub Actions green: install → typecheck → test → build → package |

## Known Issues

1. **Browser capture** is tested structurally (build passes, fixture page served) but full web-LLM capture has not been run against a live ChatGPT page in this session.
2. **Extension popup** is implemented; live pairing flow has not been manually clicked through.
3. **macOS / Linux** are not manually validated.
4. **Extension icon** is a generated placeholder.
5. **Browser extension capture** is structurally complete and built; live manual validation on ChatGPT.com is still pending a logged-in browser session.
6. **Headless CI** is not yet configured (Blender GUI E2E requires a real desktop session).

## Test Results

```
npm test
# tests 16
# pass 16
# fail 0
```

Real GUI E2E:
- Cube: PASS, 1 object, 2.75s
- Sofa (6 streaming chunks): PASS, 14 objects, 9.61s

## Commit Plan

1. `chore: bootstrap chat2blend workspace`
2. `feat: add protocol and chunk-parser packages`
3. `feat: add local bridge, jobs, CLI and integration tests`
4. `feat: add blender add-on with main-thread executor`
5. `feat: add browser extension capture and popup`
6. `feat: add streaming E2E fixture and package scripts`
7. `docs: add README, architecture, protocol, security, streaming, agent, roadmap`
8. `chore: add CI workflow and final packaging`

## Next Actions

- [x] Push to GitHub — done: https://github.com/nanhudev/chat2blend (public)
- Manual live-LLM validation with the fixture page and/or user's ChatGPT tab.
- Headless Blender smoke test in CI.
- Multi-provider capture adapters (Claude / Gemini / DeepSeek).
