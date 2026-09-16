# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.1] - 2026-09-17

### Changed

- **README rewritten around first-run experience.** The front page now opens with
  what the tool *feels* like ("Describe it. Watch Blender build it.") and a real
  demo image, instead of leading with transport details. Protocol and port
  descriptions moved down to "How it works". Both `README.md` and
  `README.zh-CN.md` were reordered to: hero → demo → why → quick start →
  examples → how it works → agent → support → security → development → roadmap.
- `c2b setup` now prints the **absolute** path of the Blender add-on for the
  current install (npm or source checkout) and describes the local-brain flow.
  Previously it printed a relative `dist/chat2blend-blender.zip` and a
  browser-extension walkthrough that npm users cannot follow.
- `c2b doctor` reports the add-on as a ready-to-pick path instead of
  "source present", and no longer surfaces the deprecated extension.
- `c2b brain` preflights the bridge and the Blender connection, exiting with
  actionable guidance instead of a raw error when either is missing.
- `c2b --help` is grouped by task (start here / make something / bridge / agents),
  with the legacy extension commands marked deprecated.

### Added

- `docs/assets/hero.svg` and `docs/assets/demo-sofa.png` — a real, unedited
  screenshot of a GUI run (6 streaming chunks, 14 objects, Blender 4.2.9).

### Fixed

- The npm tarball no longer ships README images (`files` now negates
  `docs/assets/**` and `docs/demo-cube.png`). Tarball size drops from 321 kB
  to 69 kB.

## [0.2.0] - 2026-09-16

### Added

- **Local brain (recommended path).** Drive the ChatGPT **desktop app** as the
  modelling brain over the Chrome DevTools Protocol on `127.0.0.1:9333`.
  No browser extension, no API key, no proxying of your credentials.
  - Zero-dependency CDP client `apps/bridge/src/brain/cdp.ts`
    (hand-rolled RFC 6455 WebSocket client, no npm runtime deps).
  - Desktop driver `apps/bridge/src/brain/chatgpt-desktop.ts`
    (auto-discovers the MSIX install, launches with `--remote-debugging-port`,
    scores and attaches to the right target, reads answers out of the DOM).
  - HTTP API: `GET /api/brain/status`, `POST /api/brain/attach`,
    `POST /api/brain/tasks`, `GET /api/brain/tasks/:id`.
  - CLI: `c2b brain-attach`, `c2b brain "<task>"`, `c2b brain-status [jobId]`.
  - `c2b doctor` now reports the ChatGPT desktop executable and the CDP port.
  - Real-GUI end-to-end test `npm run test:brain` (`scripts/e2e-brain.mjs`),
    which starts the bridge, launches Blender, submits a task through the local
    brain and asserts on the resulting object count and screenshot.
- `c2b version` command.
- npm distribution: the published `chat2blend` package ships the `c2b` CLI,
  the compiled bridge, the Blender add-on and the Agent Skill.
- Community health files: `CONTRIBUTING.md`, `CHANGELOG.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.editorconfig`, `.nvmrc`, issue and PR
  templates, and a release workflow that publishes to npm on tag push.

### Changed

- README / quick start / architecture docs rewritten around the desktop brain.
- CI now runs on both Ubuntu and Windows.
- `c2b doctor` reports the browser extension as informational only (it is
  deprecated and not shipped in the npm package).

### Fixed

- **Blender discovery missed Steam installs.** `discoverBlender()` now reads the
  Steam install path from the registry plus every library in
  `steamapps/libraryfolders.vdf`, and falls back to walking the Windows
  Uninstall keys when nothing else matched. Previously `c2b doctor` reported
  "0 Blender installations" on machines where Blender was installed via Steam.
- `c2b doctor` no longer leaks a localized error line from `where blender`
  (child stderr is now piped instead of inherited).

### Deprecated

- The browser extension (`apps/extension/`) is **deprecated but kept** for
  reference. See `apps/extension/DEPRECATED.md`. It is not required for normal
  use and is excluded from the npm package.

## [0.1.0] - 2026-09-16

### Added

- C2B/1 protocol (`packages/protocol`): job/chunk types, prompt builder.
- Streaming chunk parser (`packages/chunk-parser`): incremental
  `# C2B:CHUNK` / `# C2B:END` parsing with markdown-fence fallback and SHA-256
  dedupe.
- Local bridge (`apps/bridge`): loopback-only HTTP API on `8787`, line-delimited
  JSON over TCP to Blender on `8788`, random per-run token auth, job manager,
  daemon support and the `c2b` CLI.
- Blender add-on (`blender_addon/chat2blend`): main-thread executor via
  `bpy.app.timers`, shared chunk namespace, execution queue, and a viewport side
  panel.
- Browser extension (`apps/extension/`) for capturing ChatGPT answers from the
  web UI.
- Agent harness API (`/api/harness/*`) plus `c2b harness` for non-interactive
  agent integrations.
- Agent Skill manifest (`skill/SKILL.md`).
- Unit tests (16 assertions), `scripts/e2e-blender.mjs`,
  `scripts/e2e-harness.mjs`, `scripts/package-blender.mjs`.
- MIT license, README (EN + zh-CN), architecture / protocol / streaming /
  security / agent-integration docs.

[Unreleased]: https://github.com/nanhudev/chat2blend/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/nanhudev/chat2blend/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/nanhudev/chat2blend/releases/tag/v0.1.0
