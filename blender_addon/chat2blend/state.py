"""Runtime state for the Chat2Blend add-on.

Kept in one place so the network thread never has to touch bpy directly:
the thread writes here, the main thread timer reads and updates the UI.
"""
from __future__ import annotations

import time
from typing import Any

import bpy

ADDON_VERSION = "0.1.0"

# Connection
connected: bool = False
connection_status: str = "disconnected"  # disconnected | connecting | connected | error
last_error: str = ""
last_heartbeat: float = 0.0
bridge_blender_version: str = ""

# Current work
current_job_id: str = ""
current_job_title: str = ""
current_job_provider: str = ""
current_chunk_name: str = ""
current_chunk_index: int = 0
chunk_total: int = 0
status_text: str = "Idle"
paused: bool = False

# History (for the UI list)
chunks: list[dict[str, Any]] = []
log_lines: list[str] = []

# The code of the last failed chunk, so the user can retry it locally.
last_failed: dict[str, Any] | None = None

MAX_LOG = 300
MAX_CHUNKS = 200

_dirty = True


def log(message: str, level: str = "INFO") -> None:
    stamp = time.strftime("%H:%M:%S")
    line = f"[C2B] {stamp} {level:<5} {message}"
    log_lines.append(line)
    if len(log_lines) > MAX_LOG:
        del log_lines[0:-MAX_LOG]
    print(line)
    mark_dirty()


def mark_dirty() -> None:
    global _dirty
    _dirty = True


def clear_dirty() -> bool:
    global _dirty
    was = _dirty
    _dirty = False
    return was


def reset_job(job_id: str = "", title: str = "", provider: str = "") -> None:
    global current_job_id, current_job_title, current_job_provider, current_chunk_name
    global current_chunk_index, chunk_total, status_text, paused, last_failed
    current_job_id = job_id
    current_job_title = title
    current_job_provider = provider
    current_chunk_name = ""
    current_chunk_index = 0
    chunk_total = 0
    status_text = "Job started"
    paused = False
    last_failed = None
    mark_dirty()


def record_chunk(chunk_id: str, name: str, index: int, status: str, error: str = "", duration_ms: int = 0) -> None:
    for c in chunks:
        if c["chunk_id"] == chunk_id:
            c["status"] = status
            c["error"] = error
            c["duration_ms"] = duration_ms
            mark_dirty()
            return
    chunks.append(
        {
            "chunk_id": chunk_id,
            "name": name or f"chunk {index}",
            "index": index,
            "status": status,
            "error": error,
            "duration_ms": duration_ms,
        }
    )
    if len(chunks) > MAX_CHUNKS:
        del chunks[0:-MAX_CHUNKS]
    mark_dirty()


def clear_history() -> None:
    chunks.clear()
    mark_dirty()


def status_icon(status: str) -> str:
    return {
        "completed": "\u2713",
        "executing": "\u25b6",
        "queued": "\u25cb",
        "failed": "\u2717",
        "cancelled": "\u2013",
        "skipped": "\u2192",
    }.get(status, "\u00b7")


def redraw_ui() -> None:
    """Ask every visible 3D view / properties region to repaint.

    Called from the main thread timer, at most a few times per second, so the
    user actually sees the model grow while chunks stream in.
    """
    try:
        wm = bpy.context.window_manager
    except Exception:
        return
    for window in wm.windows:
        for area in window.screen.areas:
            if area.type in {"VIEW_3D", "PROPERTIES", "INFO"}:
                area.tag_redraw()


def scene_object_count() -> int:
    try:
        return len(bpy.data.objects)
    except Exception:
        return -1
