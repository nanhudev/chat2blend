# Roadmap

## v0.1.0 (MVP — done)

- [x] Browser extension captures ChatGPT Python blocks
- [x] Local bridge with HTTP API and TCP transport
- [x] Blender add-on executes chunks on the main thread
- [x] C2B protocol streaming chunks
- [x] Generic markdown fence fallback
- [x] Deduplication, pause, retry, stop
- [x] CLI: start, stop, status, doctor, pair, jobs, exec, prompt
- [x] Windows real GUI E2E verified

## v0.2.0

- [ ] Multi-provider adapters (Claude.ai, Gemini, DeepSeek, Grok)
- [ ] Extension popup shows current job progress
- [ ] Retry / skip individual chunks from Blender UI
- [ ] Headless Blender mode for CI
- [ ] macOS manual validation

## v0.3.0

- [ ] Auto-prompt optimization in extension
- [ ] Basic asset export (.glb, .fbx)
- [ ] Godot import pipeline stub
- [ ] Blender discovery in `c2b doctor`
- [ ] CI GitHub Actions

## Future

- [ ] Visual review loop (screenshot → LLM → patch)
- [ ] Hybrid agent harness (Codex handles game logic, ChatGPT handles assets)
- [ ] Team workspace / collaboration
- [ ] Cloud rendering (out of core)

## Non-goals

- Replacing LLMs. Chat2Blend is a transport, not a model.
- Being a SaaS. Core stays local-first.
- Writing another generic Coding Agent. We make existing agents cheaper.
