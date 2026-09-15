# C2B Protocol v1

Chat2Blend speaks a tiny, line-oriented protocol over HTTP and a loopback TCP socket.

## Message: `ChunkMessage`

```typescript
{
  protocol: "c2b/1",
  jobId: string,
  chunkId: string,
  name?: string,
  index: number,
  language: "python",
  code: string,
  hash: string,
  final?: boolean
}
```

- `jobId` — a single LLM response / generation.
- `chunkId` — unique within the job.
- `name` — human readable chunk name, e.g. `setup`, `cushions`.
- `index` — execution order, 0-based.
- `hash` — SHA-256 of the trimmed code, used for deduplication.
- `final` — true on the last chunk of the job.

## C2B markers in LLM output

To enable streaming execution, ask the LLM to wrap every executable unit:

```python
# C2B:CHUNK setup
import bpy
# C2B:END

# C2B:CHUNK base
bpy.ops.mesh.primitive_cube_add(size=2)
# C2B:END
```

The parser emits a chunk only when both the opening marker and `# C2B:END` are fully received, so partial markers are never executed.

## Generic fallback

If no C2B markers are found, Chat2Blend waits for the response to finish and then executes complete markdown ` ```python ... ``` ` blocks as Mode B.

## Bridge HTTP API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check, public |
| POST | `/api/pair` | Pair extension with 6-digit code |
| POST | `/api/pair/rotate` | Generate new pairing code (CLI) |
| POST | `/api/heartbeat` | Extension heartbeat |
| GET | `/api/status` | Full status |
| GET | `/api/logs` | Recent bridge logs |
| POST | `/api/jobs` | Create a job |
| GET | `/api/jobs` | List jobs |
| GET | `/api/jobs/:id` | Job details |
| POST | `/api/jobs/:id/chunks` | Submit a chunk |
| POST | `/api/jobs/:id/control` | `pause` / `resume` / `retry` / `skip` / `complete` / `cancel` |
| POST | `/api/exec` | Agent-friendly one-shot execute |
| GET | `/api/prompt?task=...` | Return the C2B prompt template |

All `/api/*` routes require the `X-C2B-Token` header except `/api/pair`.

## Bridge ↔ Blender TCP messages

Each message is JSON followed by `\n`.

### Bridge → Blender

- `welcome` — handshake.
- `job_begin` — start a new job namespace.
- `exec` — execute one chunk.
- `job_end` — mark job as completed / cancelled / failed.
- `control` — pause / resume / stop.
- `ping` — keepalive.

### Blender → Bridge

- `hello` — handshake with Blender/addon versions.
- `ack` — chunk has started executing.
- `chunk_result` — chunk completed or failed.
- `status` — current queue / busy state.
- `log` — log line from Blender.
- `pong` — keepalive response.
