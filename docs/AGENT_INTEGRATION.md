# Agent Integration

When a coding agent (Codex, Cursor, Claude Code, WorkBuddy, etc.) is asked to create a 3D asset, it should not spend tokens generating `bpy` if Chat2Blend is available.

## Agent workflow

1. Check Chat2Blend is available:

   ```bash
   c2b status
   ```

2. If the bridge is not running:

   ```bash
   c2b start
   ```

3. If Blender is not connected:

   ```text
   Please open Blender, install and enable the Chat2Blend add-on, and click Connect in the N-panel.
   ```

4. Ask the user to paste the C2B prompt into ChatGPT:

   ```bash
   c2b prompt "task"
   ```

5. The user turns Auto Execute ON in the extension and pastes the prompt. Geometry appears in Blender.

## Token discipline

The agent should not:

- generate the `bpy` code itself
- parse or modify the code coming from ChatGPT
- ask ChatGPT for a full model and then ask Codex to rewrite it

The agent should:

- coordinate (check status, tell the user what to do)
- read `jobId` and status
- handle errors by retrying or asking the user

## Skill file

The repository includes `skill/SKILL.md`. Install it to your coding agent's skills directory so the agent knows how to hand off Blender work to Chat2Blend.

## API shortcuts for agents

- `POST /api/exec` — execute one Python block.
- `GET /api/status` — full system status.
- `GET /api/jobs/:id` — inspect a job.

## Example agent prompt

```text
The user wants a modern sofa in Blender. Do not generate bpy code. Use Chat2Blend: check c2b status, start the bridge if needed, then prompt the user to paste the C2B modeling prompt into ChatGPT with Auto Execute ON. Monitor /api/status and /api/jobs until the job completes.
```
