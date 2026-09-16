# Contributing to Chat2Blend

Thanks for wanting to make Chat2Blend better. This document covers how to get a
development environment running, how the code is laid out, and what we expect
from a pull request.

By participating you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## The one rule

**No fake success.** If a test cannot run, it must say so loudly. If a feature is
not wired up, do not document it as done. Every claim in this repository has to
be reproducible by a stranger on a clean machine.

## Prerequisites

| Tool | Version | Notes |
| ---- | ------- | ----- |
| Node.js | >= 20 (CI uses 22, see `.nvmrc`) | required |
| Blender | >= 3.6 (4.x recommended) | required for anything end-to-end |
| ChatGPT desktop app | Windows MSIX build, logged in | required for the local brain |
| Python | 3.x | only for `npm run package:blender` |

There are **no runtime npm dependencies**. Everything in `apps/bridge` is built
on Node's native `http`, `net`, `crypto` and `fs`. Please keep it that way —
the whole point is that `npm i -g chat2blend` gives you a working tool without
pulling in a dependency tree.

## Getting started

```bash
git clone https://github.com/nanhudev/chat2blend.git
cd chat2blend
npm ci
npm run build
npm test
```

Run the CLI from the repo without linking:

```bash
npm run c2b -- doctor
npm run c2b -- start
npm run c2b -- status
npm run c2b -- brain-attach
npm run c2b -- brain "a low-poly sofa"
```

Or link it globally:

```bash
npm link
c2b doctor
```

## Project layout

```
apps/bridge/            Local bridge (Node, TypeScript, zero runtime deps)
  src/bridge.ts         HTTP API + routing
  src/server.ts         TCP server for the Blender connection (8788)
  src/jobs.ts           Job / chunk state machine
  src/brain/            Local ChatGPT desktop brain (CDP)
    cdp.ts              Minimal Chrome DevTools Protocol client + WebSocket
    chatgpt-desktop.ts  Discovery, launch, attach, type, send, read
    index.ts            Brain facade: prompt -> ask -> parse
  src/cli.ts            The `c2b` command line
apps/extension/         DEPRECATED browser extension (kept for reference)
blender_addon/          Blender add-on (Python, no deps)
packages/protocol/      C2B/1 protocol types + prompt builder
packages/chunk-parser/  Streaming chunk parser + fence fallback + dedupe
scripts/                Build helpers and end-to-end harnesses
skill/                  Agent Skill manifest (SKILL.md)
docs/                   Architecture, protocol, streaming, security, agents
```

## Commands

| Command | What it does |
| ------- | ------------ |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Compile TypeScript to `dist/` and build the extension bundle |
| `npm test` | Build, then run the Node test runner over `dist/**/*.test.js` |
| `npm run test:brain` | **Real** end-to-end: bridge + Blender + ChatGPT desktop (Windows only) |
| `npm run package:blender` | Zip the add-on to `dist/chat2blend-blender.zip` |
| `npm run c2b -- <args>` | Run the CLI from source |

## Tests

* **Unit tests** live next to the code as `*.test.ts` and run in CI on every push.
* **End-to-end tests** under `scripts/` are opt-in because they need a real
  Blender and (for `test:brain`) a real ChatGPT desktop session. They write a
  report into `.state/`.
* A new parser or protocol change **must** come with a unit test. A change to the
  Blender executor should be verified with `scripts/e2e-blender.mjs` and the
  observed result (object count, screenshot) mentioned in the PR.

## Coding conventions

* TypeScript: `strict`, 2-space indent, no default exports where a named export
  reads better. Follow the existing files — there is no linter yet, consistency
  with neighbours is the rule.
* Python (add-on): 4-space indent, no third-party imports, everything that
  touches `bpy` must run on the main thread through `bpy.app.timers`.
* No new runtime dependencies without a discussion in an issue first.
* Update `README.md` **and** `README.zh-CN.md` when user-facing behaviour
  changes. Update `CHANGELOG.md` under `[Unreleased]`.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(brain): fall back to detached-window target when composer is missing
fix(bridge): keep token stable across daemon restarts
docs: document the CDP port in the security model
chore: bump dev dependencies
```

`feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci` are all in use.

## Pull requests

1. Fork and branch off `main`.
2. Make sure `npm run typecheck && npm run build && npm test` passes.
3. Fill in the PR template — especially the "how did you verify this" box.
4. Keep PRs focused. A parser change and a docs rewrite are two PRs.
5. CI must be green. It runs on Ubuntu and Windows.

## Reporting bugs

Open an issue with the **bug report** template and include the output of:

```bash
c2b doctor
```

That single command prints bridge, Blender, add-on, ChatGPT desktop and CDP
status, and it solves most problems without a round trip.

Security issues are handled privately — see [`SECURITY.md`](./SECURITY.md).

## Releasing

Maintainers only:

1. Move `[Unreleased]` entries in `CHANGELOG.md` into a new version heading.
2. `npm version <patch|minor|major>` (this commits and tags `vX.Y.Z`).
3. `git push && git push --tags`
4. The `release` workflow publishes to npm using the `NPM_TOKEN` repository
   secret (`npm publish --access public` is also fine locally if you are a
   maintainer with 2FA handy).

## License

Contributions are accepted under the [MIT License](./LICENSE).
