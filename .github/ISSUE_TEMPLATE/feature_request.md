---
name: Feature request
about: Suggest an idea for Chat2Blend
title: "[feat] "
labels: enhancement
---

## The problem

<!-- What are you trying to do in Blender that Chat2Blend makes hard today? -->

## Proposed solution

## Alternatives you considered

## Scope check

Chat2Blend has a deliberately small core: loopback-only bridge, zero runtime
dependencies, no API keys, `bpy` executed only on Blender's main thread.

- [ ] This does not require a new **runtime** npm dependency
- [ ] This does not require the bridge to listen on anything but `127.0.0.1`
- [ ] This does not require storing an OpenAI API key

If you had to tick "no" anywhere, explain why in the box below — the constraint
can be revisited, it just needs a conversation first.

## How would you verify it?

<!-- e.g. "add a chunk-parser unit test", "run scripts/e2e-blender.mjs and check object count" -->
