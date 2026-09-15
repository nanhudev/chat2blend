"""Add-on wiring: preferences, operators, timers, message dispatch."""
from __future__ import annotations

import time
from typing import Any

import bpy

from . import connection as connection_mod
from . import executor as executor_mod
from . import queue as queue_mod
from . import state
from . import ui as ui_mod

ADDON_VERSION = state.ADDON_VERSION

# Runtime singletons (module level so operators can reach them)
conn: connection_mod.BridgeConnection | None = None
executor = executor_mod.Executor()
pending = queue_mod.MainThreadQueue()
_last_tick = 0.0
TICK_SECONDS = 0.05


# --------------------------------------------------------------------- prefs
class C2BPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    bridge_host: bpy.props.StringProperty(  # type: ignore[valid-type]
        name="Bridge host",
        description="Chat2Blend bridge host (loopback only)",
        default="127.0.0.1",
    )
    bridge_port: bpy.props.IntProperty(  # type: ignore[valid-type]
        name="Bridge port",
        description="TCP port the bridge listens on for Blender",
        default=8788,
        min=1,
        max=65535,
    )
    auto_connect: bpy.props.BoolProperty(  # type: ignore[valid-type]
        name="Connect on startup",
        description="Connect to the local bridge when Blender starts",
        default=True,
    )
    refresh_viewport: bpy.props.BoolProperty(  # type: ignore[valid-type]
        name="Refresh viewport per chunk",
        description="Redraw the 3D view after every executed chunk",
        default=True,
    )

    def draw(self, context: bpy.types.Context) -> None:
        layout = self.layout
        layout.prop(self, "bridge_host")
        layout.prop(self, "bridge_port")
        layout.prop(self, "auto_connect")
        layout.prop(self, "refresh_viewport")


# ----------------------------------------------------------------- operators
class C2B_OT_connect(bpy.types.Operator):
    bl_idname = "c2b.connect"
    bl_label = "Connect to Chat2Blend bridge"

    def execute(self, context: bpy.types.Context) -> set[str]:
        start_connection(context)
        return {"FINISHED"}


class C2B_OT_disconnect(bpy.types.Operator):
    bl_idname = "c2b.disconnect"
    bl_label = "Disconnect from Chat2Blend bridge"

    def execute(self, context: bpy.types.Context) -> set[str]:
        stop_connection()
        return {"FINISHED"}


class C2B_OT_pause(bpy.types.Operator):
    bl_idname = "c2b.pause"
    bl_label = "Pause execution"

    def execute(self, context: bpy.types.Context) -> set[str]:
        state.paused = True
        state.status_text = "Paused"
        state.log("execution paused", "WARN")
        state.mark_dirty()
        return {"FINISHED"}


class C2B_OT_resume(bpy.types.Operator):
    bl_idname = "c2b.resume"
    bl_label = "Resume execution"

    def execute(self, context: bpy.types.Context) -> set[str]:
        state.paused = False
        state.status_text = "Resumed"
        state.log("execution resumed", "INFO")
        state.mark_dirty()
        return {"FINISHED"}


class C2B_OT_stop(bpy.types.Operator):
    bl_idname = "c2b.stop"
    bl_label = "Stop current job"

    def execute(self, context: bpy.types.Context) -> set[str]:
        dropped = pending.clear()
        job_id = state.current_job_id
        if conn is not None and job_id:
            conn.send({"type": "job_end", "jobId": job_id, "status": "cancelled"})
        executor.job_end(job_id or "unknown", "cancelled")
        state.log(f"stopped by user - {dropped} queued chunk(s) discarded", "WARN")
        return {"FINISHED"}


class C2B_OT_retry(bpy.types.Operator):
    bl_idname = "c2b.retry"
    bl_label = "Retry the failed chunk"

    def execute(self, context: bpy.types.Context) -> set[str]:
        failed = state.last_failed
        if not failed:
            self.report({"WARNING"}, "No failed chunk to retry")
            return {"CANCELLED"}
        state.paused = False
        pending.push(
            {
                "kind": "exec",
                "job_id": failed["job_id"],
                "chunk_id": failed["chunk_id"],
                "name": failed["name"],
                "index": failed["index"],
                "code": failed["code"],
            }
        )
        state.log(f"retrying chunk {failed['name'] or failed['chunk_id']}", "INFO")
        return {"FINISHED"}


class C2B_OT_open_logs(bpy.types.Operator):
    bl_idname = "c2b.open_logs"
    bl_label = "Copy Chat2Blend log"

    def execute(self, context: bpy.types.Context) -> set[str]:
        text = "\n".join(state.log_lines[-200:])
        try:
            context.window_manager.clipboard = text
            self.report({"INFO"}, "Log copied to clipboard")
        except Exception:  # noqa: BLE001
            self.report({"WARNING"}, "Clipboard unavailable - see the system console")
        return {"FINISHED"}


classes = (
    C2BPreferences,
    C2B_OT_connect,
    C2B_OT_disconnect,
    C2B_OT_pause,
    C2B_OT_resume,
    C2B_OT_stop,
    C2B_OT_retry,
    C2B_OT_open_logs,
)


# ---------------------------------------------------------------- connection
def start_connection(context: bpy.types.Context | None = None) -> None:
    global conn
    stop_connection()
    host, port = _endpoint(context)
    state.log(f"connecting to {host}:{port}", "INFO")
    conn = connection_mod.BridgeConnection(host, port, on_message=_on_message, on_status=_on_status)
    conn.start()


def stop_connection() -> None:
    global conn
    if conn is not None:
        conn.stop()
        conn = None
    state.connected = False
    state.connection_status = "disconnected"
    state.mark_dirty()


def _endpoint(context: bpy.types.Context | None) -> tuple[str, int]:
    host, port = "127.0.0.1", 8788
    try:
        if context is not None:
            prefs = context.preferences.addons[__package__].preferences
            host = prefs.bridge_host
            port = int(prefs.bridge_port)
    except Exception:  # noqa: BLE001
        pass
    return host, port


# Called from the socket thread - never touch bpy here.
def _on_message(message: dict[str, Any]) -> None:
    kind = message.get("type")
    if kind == "welcome":
        state.bridge_blender_version = str(message.get("bridgeVersion", ""))
        state.log(f"bridge v{message.get('bridgeVersion')} ready", "INFO")
        return
    if kind == "exec":
        pending.push(
            {
                "kind": "exec",
                "job_id": message.get("jobId", ""),
                "chunk_id": message.get("chunkId", ""),
                "name": message.get("name", ""),
                "index": int(message.get("index", 0)),
                "code": message.get("code", ""),
            }
        )
        return
    if kind == "job_begin":
        pending.push(
            {
                "kind": "job_begin",
                "job_id": message.get("jobId", ""),
                "title": message.get("title", ""),
                "provider": message.get("provider", ""),
                "mode": message.get("mode", "protocol"),
            }
        )
        return
    if kind == "job_end":
        pending.push({"kind": "job_end", "job_id": message.get("jobId", ""), "status": message.get("status", "completed")})
        return
    if kind == "control":
        pending.push({"kind": "control", "action": message.get("action", "")})
        return


def _on_status(connected: bool, detail: str) -> None:
    state.connected = connected
    state.connection_status = "connected" if connected else "disconnected"
    if not connected:
        state.last_error = detail
    state.mark_dirty()


# ------------------------------------------------------------- main thread
def tick() -> float | None:
    """Drain the queue on Blender's main thread (bpy is not thread safe)."""
    global _last_tick
    if conn is None:
        return TICK_SECONDS

    processed = 0
    while processed < 8:
        item = pending.pop()
        if item is None:
            break
        if state.paused and item.get("kind") == "exec":
            pending.push_front(item)
            break
        _handle_item(item)
        processed += 1

    if state.clear_dirty():
        state.redraw_ui()

    # keep the UI alive even with no incoming messages
    _last_tick = time.time()
    return TICK_SECONDS


def _handle_item(item: dict[str, Any]) -> None:
    kind = item.get("kind")
    if kind == "exec":
        result = executor.execute(
            item["job_id"],
            item["chunk_id"],
            item.get("name", ""),
            int(item.get("index", 0)),
            item.get("code", ""),
        )
        if conn is not None:
            conn.send(result)
        state.chunk_total = max(state.chunk_total, int(item.get("index", 0)) + 1)
    elif kind == "job_begin":
        executor.job_begin(item["job_id"], item.get("title", ""), item.get("provider", ""), item.get("mode", "protocol"))
    elif kind == "job_end":
        executor.job_end(item["job_id"], item.get("status", "completed"))
    elif kind == "control":
        action = item.get("action")
        if action == "pause":
            state.paused = True
        elif action == "resume":
            state.paused = False
        elif action == "stop":
            pending.clear()
            executor.job_end(state.current_job_id, "cancelled")
        state.mark_dirty()


# ------------------------------------------------------------------ register
def register() -> None:
    for c in classes:
        bpy.utils.register_class(c)
    ui_mod.register()
    if not bpy.app.timers.is_registered(tick):
        bpy.app.timers.register(tick, first_interval=0.5, persistent=True)
    state.log(f"Chat2Blend add-on {ADDON_VERSION} registered", "INFO")

    auto = True
    try:
        auto = bool(bpy.context.preferences.addons[__package__].preferences.auto_connect)
    except Exception:  # noqa: BLE001
        pass
    if auto:
        # give Blender a moment to finish booting before the first connect
        bpy.app.timers.register(lambda: _delayed_connect(), first_interval=1.0)


def _delayed_connect() -> None:
    try:
        start_connection(bpy.context)
    except Exception as exc:  # noqa: BLE001
        state.log(f"auto connect failed: {exc}", "WARN")
    return None


def unregister() -> None:
    stop_connection()
    if bpy.app.timers.is_registered(tick):
        bpy.app.timers.unregister(tick)
    ui_mod.unregister()
    for c in reversed(classes):
        bpy.utils.unregister_class(c)
