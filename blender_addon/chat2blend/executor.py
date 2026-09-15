"""Executes streamed Python inside the running Blender instance.

Design rules:
  * every chunk of a job shares ONE namespace (helpers defined in chunk 1 are
    visible in chunk 5)
  * execution always happens on the main thread (see queue.py)
  * a failing chunk is reported, never silently swallowed
  * one undo boundary per job so the user can undo a whole Chat2Blend task
"""
from __future__ import annotations

import time
import traceback
from typing import Any

import bpy

from . import state

MAX_ERROR_CHARS = 2000


class Executor:
    def __init__(self) -> None:
        self._namespaces: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------- jobs
    def job_begin(self, job_id: str, title: str = "", provider: str = "", mode: str = "protocol") -> None:
        self._namespaces.pop(job_id, None)
        self._namespaces[job_id] = self._new_namespace()
        state.reset_job(job_id, title, provider)
        try:
            bpy.ops.ed.undo_push(message=f"Chat2Blend: {title or job_id}")
        except Exception:  # noqa: BLE001 - undo is best effort
            pass
        state.log(f"job begin {job_id} ({provider}, {mode}) {title}".strip(), "INFO")

    def job_end(self, job_id: str, status: str) -> None:
        self._namespaces.pop(job_id, None)
        state.status_text = f"Job {status}"
        state.mark_dirty()
        state.log(f"job end {job_id}: {status}", "INFO")

    def has_namespace(self, job_id: str) -> bool:
        return job_id in self._namespaces

    # ------------------------------------------------------------ chunks
    def execute(self, job_id: str, chunk_id: str, name: str, index: int, code: str) -> dict[str, Any]:
        ns = self._namespaces.get(job_id)
        if ns is None:
            # The job was never announced (e.g. bridge restarted): create it.
            self.job_begin(job_id)
            ns = self._namespaces[job_id]

        state.current_chunk_name = name or f"chunk {index}"
        state.current_chunk_index = index
        state.status_text = f"Executing {state.current_chunk_name}..."
        state.record_chunk(chunk_id, name, index, "executing")
        state.mark_dirty()

        started = time.perf_counter()
        error = ""
        try:
            compiled = compile(code, f"<C2B {name or 'chunk'} #{index}>", "exec")
            exec(compiled, ns)  # noqa: S102 - this is the product: running LLM code
            self._refresh_viewport()
        except Exception as exc:  # noqa: BLE001
            tb = traceback.format_exc()
            # Trim the Chat2Blend frames, show what matters to the user.
            error = self._format_error(exc, tb)
            state.log(f"chunk failed {chunk_id}: {error.splitlines()[0] if error else exc}", "ERROR")
        duration_ms = int((time.perf_counter() - started) * 1000)

        result: dict[str, Any] = {
            "type": "chunk_result",
            "jobId": job_id,
            "chunkId": chunk_id,
            "status": "failed" if error else "completed",
            "durationMs": duration_ms,
            "sceneObjects": state.scene_object_count(),
        }
        if error:
            result["error"] = error
            state.record_chunk(chunk_id, name, index, "failed", error, duration_ms)
            state.last_failed = {
                "job_id": job_id,
                "chunk_id": chunk_id,
                "name": name,
                "index": index,
                "code": code,
                "error": error,
            }
            state.status_text = f"Failed: {state.current_chunk_name}"
        else:
            state.record_chunk(chunk_id, name, index, "completed", "", duration_ms)
            state.status_text = f"Done: {state.current_chunk_name} ({duration_ms} ms)"
            state.log(f"chunk ok {chunk_id} ({name or index}) in {duration_ms} ms", "INFO")
        state.mark_dirty()
        return result

    # ------------------------------------------------------------ helpers
    @staticmethod
    def _format_error(exc: BaseException, tb: str) -> str:
        head = f"{type(exc).__name__}: {exc}"
        lines = tb.strip().splitlines()
        # keep the frames that come from the executed chunk
        useful = [ln.strip() for ln in lines if "<C2B" in ln or ln.strip().startswith(("File ", "  "))]
        detail = "\n".join(useful[-12:])
        text = f"{head}\n{detail}" if detail else head
        return text[:MAX_ERROR_CHARS]

    @staticmethod
    def _refresh_viewport() -> None:
        """Make the new geometry visible immediately (throttled: once per chunk)."""
        try:
            if bpy.context.view_layer:
                bpy.context.view_layer.update()
        except Exception:  # noqa: BLE001
            pass
        try:
            bpy.context.view_layer.update()
        except Exception:  # noqa: BLE001
            pass
        state.redraw_ui()

    @staticmethod
    def _new_namespace() -> dict[str, Any]:
        import bmesh
        import math
        import mathutils
        import random

        ns: dict[str, Any] = {
            "__name__": "__c2b__",
            "bpy": bpy,
            "math": math,
            "mathutils": mathutils,
            "bmesh": bmesh,
            "random": random,
            "Vector": mathutils.Vector,
            "C2B": True,
        }

        def c2b_log(*args: Any) -> None:
            state.log(" ".join(str(a) for a in args), "INFO")

        ns["c2b_log"] = c2b_log
        return ns
