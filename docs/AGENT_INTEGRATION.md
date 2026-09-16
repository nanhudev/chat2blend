# Agent Integration

When a coding agent (Codex, Cursor, Claude Code, WorkBuddy, etc.) is asked to create a 3D asset, it should not spend tokens generating `bpy` if Chat2Blend is available.

## Harness mode (recommended)

The agent becomes a **harness**: it submits a natural-language task, and Chat2Blend handles prompt delivery, LLM capture, and Blender execution.

```bash
# 1. check system
c2b status

# 2. submit task - the agent never writes bpy
c2b harness "a modern three-seat fabric sofa"

# 3. poll compact status (chunk names + states + TTFF, never the code)
c2b harness-status <jobId>

# or submit + wait in one command
c2b harness "a modern three-seat fabric sofa" --wait
```

Output the agent should report to the user:

- job id
- status (streaming / completed / failed)
- executed chunk count / total chunk count
- TTFF (Time To First Form)
- whether Blender is connected
- any chunk error

## Manual fallback

If the extension is not installed/paired, the harness auto-delivery does nothing. Fall back to:

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
- submit tasks through `c2b harness`
- read compact status via `c2b harness-status`
- handle errors by retrying or asking the user

## Skill file

The repository includes `skill/SKILL.md`. Install it to your coding agent's skills directory so the agent knows how to hand off Blender work to Chat2Blend.

## API endpoints for agents

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/harness/tasks` | Submit a natural-language task. Returns jobId + C2B prompt. |
| GET | `/api/harness/tasks/:id` | Compact status (chunk names/states, TTFF, error). Never returns code. |
| GET | `/api/harness/pending` | Pending tasks waiting for the browser extension. |
| POST | `/api/harness/pending/:id/ack` | Mark prompt as delivered. |
| POST | `/api/exec` | Execute one Python block directly. |
| GET | `/api/status` | Full system status. |

## Example agent prompt

```text
The user wants a modern sofa in Blender. Do not generate bpy code. Use Chat2Blend: run `c2b status`, start the bridge if needed, then submit `c2b harness "a modern three-seat fabric sofa" --wait`. Report chunk progress, TTFF, and the final Blender object count. If anything fails, run `c2b doctor`.
```
