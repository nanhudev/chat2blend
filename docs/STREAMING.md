# Streaming Execution

Chat2Blend's headline feature is streaming execution: geometry starts appearing in Blender before the LLM has finished writing the whole response.

## Why not wait for the full response?

If ChatGPT takes 40 seconds to generate code and Blender takes 20 seconds to run it, a naive clipboard pipeline forces the user to wait 60 seconds. With streaming, the first chunk can start executing at the 10-second mark, so the overall wait feels like 40–45 seconds.

## Why not execute every token?

Executing every line or token would fail constantly. Python needs complete constructs:

- unclosed parentheses
- unfinished function definitions
- multiline strings
- unfinished `if` / `for` / `with` blocks
- helper functions defined later than their first use

So Chat2Blend executes only **complete, independently valid chunks**.

## Two execution modes

### Mode A — C2B Protocol (preferred)

The LLM wraps chunks in markers:

```python
# C2B:CHUNK setup
import bpy
# C2B:END
```

The parser holds the buffer until `# C2B:END` is fully received. Because the parser consumes full lines only, a partially streamed marker (`# C2B:E`) is never mistaken for a complete marker.

### Mode B — Generic Markdown

If the LLM returns a normal ` ```python ` fence, Chat2Blend waits for the closing fence and executes the whole block. This gives up streaming progress but works with every LLM.

## Deduplication

The DOM observer fires many times for the same content. Every chunk is hashed; the bridge refuses to execute the same hash twice within the same job. This prevents duplicate geometry.

## Ordering

Chunks are executed strictly in `index` order. The bridge sends one chunk, waits for Blender's `chunk_result`, then sends the next. This guarantees that chunk N can depend on definitions from chunk 0..N-1.

## TTFF: Time To First Form

The metric we optimize is the time from the user's prompt to the first meaningful geometry appearing in Blender. The bridge logs:

- `createdAt`
- `firstChunkDetectedAt`
- `firstChunkSentAt`
- `firstChunkExecutedAt`

You can see these in `c2b jobs` / `/api/status`.

## Regeneration and cancellation

- If the user clicks **Regenerate**, the extension detects a new assistant message and starts a new job.
- If the user stops generation, the extension flushes the parser, discards incomplete chunks, and tells the bridge the job is complete.

## Viewport feedback

After each chunk, the add-on calls `bpy.context.view_layer.update()` and redraws visible 3D view areas. This is throttled to once per chunk, not once per line, to keep Blender responsive.
