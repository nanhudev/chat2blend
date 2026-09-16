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

## Brain workflow (recommended)

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

   > Run `c2b setup` — it prints the exact absolute path of the add-on for this
   > install. Then in Blender: Edit > Preferences > Add-ons > Install, choose that
   > `blender_addon/chat2blend/__init__.py`, enable Chat2Blend, and click Connect
   > in the Chat2Blend N-panel.

4. **Attach the local brain** — only once per session

   Make sure the ChatGPT desktop app is running and logged in, then run:

   ```bash
   c2b brain-attach
   ```

   This launches or connects to the ChatGPT desktop app on `127.0.0.1:9333`.

5. **Submit the task** — the agent never writes the model

   ```bash
   c2b brain "a modern three-seat fabric sofa"
   ```

   This opens a fresh ChatGPT chat, fills the C2B protocol prompt, and waits for the desktop app
   to generate Blender Python chunks.

6. **Poll compact status**

   ```bash
   c2b brain --wait "a modern three-seat fabric sofa"
   # or after you know the job id:
   c2b brain-status <jobId>
   ```

   The response contains chunk names/states and TTFF only — never the code.

7. **Report**: chunk progress, TTFF, and confirmation that Blender has the model.

## Manual fallback

If the ChatGPT desktop app is not installed or not logged in, use the prompt command:

```bash
c2b prompt "task"
```

Copy the printed prompt into ChatGPT yourself.

## Commands to remember

- `c2b setup` — first-run checklist; prints the exact add-on path for this install
- `c2b status` — system status
- `c2b start` / `c2b stop` — bridge control
- `c2b doctor` — diagnostics
- `c2b brain-attach` — attach / launch the local ChatGPT desktop app
- `c2b brain "<task>"` — submit a modeling task to the local brain
- `c2b brain "<task>" --wait` — submit and block until done
- `c2b brain-status <jobId>` — compact job status (agent mode)
- `c2b harness "<task>"` — legacy browser-extension path (deprecated)
- `c2b jobs` — recent jobs
- `c2b exec <file.py>` — send a Python file directly to Blender
- `c2b prompt "task"` — print the standard C2B modeling prompt

## Rules

- Do not write long `bpy` scripts yourself.
- Do not parse or rewrite the Python coming from ChatGPT.
- Do not ask for the OpenAI API key.
- `c2b brain` preflights the bridge and Blender and exits non-zero with guidance
  if either is missing — surface that guidance to the user instead of retrying blindly.
- If something fails, run `c2b doctor` and report the output.

## Files

- `apps/bridge/src/brain` — local ChatGPT desktop app driver
- `blender_addon/chat2blend/` — Blender add-on package (path printed by `c2b setup`)
- `docs/AGENT_INTEGRATION.md` — full agent protocol
