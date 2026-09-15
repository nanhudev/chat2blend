# Chat2Blend Skill

> For coding agents (Codex, Cursor, Claude Code, WorkBuddy, etc.) — when the user wants a Blender asset or 3D model.

## What Chat2Blend is

Chat2Blend turns ChatGPT's Blender Python into visible Blender geometry. The LLM writes the code once; Chat2Blend streams it into Blender automatically. The agent should **not** generate the `bpy` code itself.

## When to use this skill

Use when the user asks for:

- "Create a sofa / chair / table in Blender"
- "Generate a 3D model with Blender Python"
- "Make a game asset"
- Anything involving `bpy` or procedural Blender geometry

## Workflow

1. **Check the bridge:**

   ```bash
   c2b status
   ```

2. **Start the bridge if needed:**

   ```bash
   c2b start
   ```

3. **Check Blender is connected:**

   Look at `c2b status` output. If `Blender: not connected`, tell the user:

   > Open Blender, go to Edit > Preferences > Add-ons > Install, choose `dist/chat2blend-blender.zip`, enable Chat2Blend, then click Connect in the N-panel.

4. **Get the C2B prompt:**

   ```bash
   c2b prompt "a modern three-seat fabric sofa"
   ```

5. **Hand off to the user and ChatGPT:**

   > Copy this prompt into ChatGPT, install/enable the Chat2Blend extension, click the extension icon to pair with code `c2b pair`, turn Auto Execute ON, then paste the prompt.

6. **Monitor:**

   ```bash
   c2b jobs
   ```

   Wait until the job shows `completed` and Blender has the model.

## Commands to remember

- `c2b status` — system status
- `c2b start` / `c2b stop` — bridge control
- `c2b doctor` — diagnostics
- `c2b pair` — show pairing code
- `c2b jobs` — recent jobs
- `c2b exec <file.py>` — send a python file directly to Blender
- `c2b prompt "task"` — print the standard C2B modeling prompt

## Rules

- Do not write long `bpy` scripts yourself.
- Do not parse or rewrite the Python coming from ChatGPT.
- Do not ask for the OpenAI API key.
- If something fails, run `c2b doctor` and report the output.

## Files

- `apps/extension/dist` — browser extension
- `dist/chat2blend-blender.zip` — Blender add-on package
- `docs/` — full documentation
