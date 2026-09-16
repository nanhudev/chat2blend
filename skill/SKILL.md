# Chat2Blend Skill

> For coding agents (Codex, Cursor, Claude Code, WorkBuddy, etc.) — when the user wants a Blender asset or 3D model.

## Core rule

**Do not write `bpy` code.** Chat2Blend turns ChatGPT's Blender Python into visible Blender geometry.
The LLM writes the code once; the add-on executes it in a visible Blender instance. The agent is
only the **harness**: it submits the task and polls status.

## When to use this skill

Use when the user asks for:

- "Create a sofa / chair / table in Blender"
- "Generate a 3D model with Blender Python"
- "Make a game asset"
- Anything involving `bpy` or procedural Blender geometry

## Harness workflow

1. **Check the bridge**

   ```bash
   c2b status
   ```

2. **Start the bridge if needed**

   ```bash
   c2b start
   ```

3. **Check Blender is connected**

   Look at `c2b status` output. If `Blender: not connected`, tell the user:

   > Open Blender, Edit > Preferences > Add-ons > Install, choose `dist/chat2blend-blender.zip`, enable Chat2Blend, then click Connect in the N-panel.

4. **Submit the task** — the agent never writes the model

   ```bash
   c2b harness "a modern three-seat fabric sofa"
   ```

   This creates a job, generates the C2B protocol prompt, and the browser extension will
   auto-fill it into the ChatGPT composer. The user only presses Send (auto-submit is off by
   default).

5. **Poll compact status**

   ```bash
   c2b harness --wait "a modern three-seat fabric sofa"
   # or after you know the job id:
   c2b harness-status <jobId>
   ```

   The response contains chunk names/states and TTFF only — never the code.

6. **Report**: chunk progress, TTFF, and confirmation that Blender has the model.

## Manual fallback

If the extension is not installed/paired, auto-delivery does nothing. Use the prompt command:

```bash
c2b prompt "task"
```

Copy the printed prompt into ChatGPT yourself.

## Commands to remember

- `c2b status` — system status
- `c2b start` / `c2b stop` — bridge control
- `c2b doctor` — diagnostics
- `c2b pair` — show pairing code for the browser extension
- `c2b harness "<task>"` — submit a modeling task (agent mode)
- `c2b harness "<task>" --wait` — submit and block until done
- `c2b harness-status <jobId>` — compact job status (agent mode)
- `c2b jobs` — recent jobs
- `c2b exec <file.py>` — send a Python file directly to Blender
- `c2b prompt "task"` — print the standard C2B modeling prompt

## Rules

- Do not write long `bpy` scripts yourself.
- Do not parse or rewrite the Python coming from ChatGPT.
- Do not ask for the OpenAI API key.
- If something fails, run `c2b doctor` and report the output.

## Files

- `apps/extension/dist` — browser extension
- `dist/chat2blend-blender.zip` — Blender add-on package
- `docs/AGENT_INTEGRATION.md` — full agent protocol
