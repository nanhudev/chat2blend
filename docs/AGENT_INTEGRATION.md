# Agent Integration

When a coding agent (Codex, Cursor, Claude Code, WorkBuddy, etc.) is asked to create a 3D asset, it should not spend tokens generating `bpy` if Chat2Blend is available.

## Local brain mode (recommended)

The agent becomes a **harness**: it submits a natural-language task, and Chat2Blend drives the local ChatGPT desktop app, waits for the answer, parses the generated chunks, and executes them in Blender.

```bash
# 1. check system
c2b status

# 2. make sure the ChatGPT desktop app is attached (one-shot)
c2b brain-attach

# 3. submit task - the agent never writes bpy
c2b brain "a modern three-seat fabric sofa"

# 4. poll compact status (chunk names + states + TTFF, never the code)
c2b brain-status <jobId>

# or submit + wait in one command
c2b brain "a modern three-seat fabric sofa" --wait
```

Output the agent should report to the user:

- job id
- brain state (running / done / error)
- status (streaming / completed / failed)
- executed chunk count / total chunk count
- TTFF (Time To First Form)
- whether Blender is connected
- any chunk error

## Legacy harness mode

The browser-extension-based `c2b harness` command is kept for reference but deprecated. It required the extension to capture the ChatGPT web page. Use `c2b brain` instead.

## Manual fallback

If the ChatGPT desktop app is not installed, fall back to:

```bash
c2b prompt "task"
```

Copy the printed prompt into ChatGPT manually.

## Token discipline

The agent should not:

- generate the `bpy` code itself
- parse or modify the code coming from ChatGPT
- ask ChatGPT for a full model and then ask another coding agent to rewrite it

The agent should:

- coordinate (`c2b status`, `c2b doctor`)
- attach the local brain once per session (`c2b brain-attach`)
- submit tasks through `c2b brain`
- read compact status via `c2b brain-status`
- handle errors by retrying or asking the user

## Skill file

The repository includes `skill/SKILL.md`. Install it to your coding agent's skills directory so the agent knows how to hand off Blender work to Chat2Blend.

## API endpoints for agents

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/brain/tasks` | Submit a natural-language task to the local brain. Returns jobId + status URL. |
| GET | `/api/brain/tasks/:id` | Compact status (chunk names/states, TTFF, error). Never returns code. |
| POST | `/api/brain/attach` | Launch/attach the local ChatGPT desktop app. |
| GET | `/api/brain/status` | Local brain health. |
| POST | `/api/harness/tasks` | Legacy extension path: submit a task for the browser extension. |
| GET | `/api/harness/tasks/:id` | Legacy extension path: compact status. |
| POST | `/api/exec` | Execute one Python block directly. |
| GET | `/api/status` | Full system status. |

## Example agent prompt

```text
The user wants a modern sofa in Blender. Do not generate bpy code. Use Chat2Blend: run `c2b status`, start the bridge if needed, attach the local brain with `c2b brain-attach`, then submit `c2b brain "a modern three-seat fabric sofa" --wait`. Report chunk progress, TTFF, and the final Blender object count. If anything fails, run `c2b doctor`.
```
