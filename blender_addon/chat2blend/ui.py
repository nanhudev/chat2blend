"""Sidebar UI (N-panel). Deliberately boring - it just shows what is happening."""
from __future__ import annotations

import bpy

from . import state

ICON_CONNECTED = "CHECKMARK"
ICON_DISCONNECTED = "CANCEL"
ICON_WAIT = "TIME"


class C2B_PT_main(bpy.types.Panel):
    bl_label = "Chat2Blend"
    bl_idname = "C2B_PT_main"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Chat2Blend"

    def draw(self, context: bpy.types.Context) -> None:
        layout = self.layout
        prefs = _prefs(context)

        # ---------------------------------------------------------- bridge
        box = layout.box()
        row = box.row()
        if state.connected:
            row.label(text="Bridge Connected", icon=ICON_CONNECTED)
        else:
            row.label(text=f"Bridge: {state.connection_status}", icon=ICON_DISCONNECTED)

        if state.bridge_blender_version:
            box.label(text=f"Bridge v{state.bridge_blender_version}")

        row = box.row(align=True)
        if state.connected:
            row.operator("c2b.disconnect", text="Disconnect")
        else:
            row.operator("c2b.connect", text="Connect")

        if prefs is not None:
            row = box.row(align=True)
            row.prop(prefs, "bridge_host", text="")
            row.prop(prefs, "bridge_port", text="")

        # ------------------------------------------------------------- job
        box = layout.box()
        box.label(text="Session")
        if state.current_job_id:
            col = box.column(align=True)
            col.label(text=f"Provider: {state.current_job_provider or '-'}")
            col.label(text=f"Task: {state.current_job_title or state.current_job_id}")
            col.label(text=f"Status: {state.status_text}")
            if state.chunk_total:
                col.label(text=f"Chunk: {state.current_chunk_index + 1} / {state.chunk_total}")
        else:
            box.label(text="No active job")

        # ---------------------------------------------------------- chunks
        if state.chunks:
            box = layout.box()
            box.label(text="Chunks")
            for c in state.chunks[-8:]:
                row = box.row()
                row.label(text=f"{state.status_icon(c['status'])} {c['name']}")
                sub = row.row()
                sub.alignment = "RIGHT"
                if c["duration_ms"]:
                    sub.label(text=f"{c['duration_ms']} ms")
                if c["status"] == "failed":
                    box.label(text=f"  {c['error'].splitlines()[0][:60]}", icon="ERROR")

        # -------------------------------------------------------- controls
        row = layout.row(align=True)
        if state.paused:
            row.operator("c2b.resume", text="Resume", icon="PLAY")
        else:
            row.operator("c2b.pause", text="Pause", icon="PAUSE")
        row.operator("c2b.stop", text="Stop", icon="X")

        row = layout.row(align=True)
        row.operator("c2b.retry", text="Retry Failed", icon="FILE_REFRESH")
        row.operator("c2b.open_logs", text="Logs", icon="TEXT")

        if state.log_lines:
            box = layout.box()
            box.label(text="Log")
            for line in state.log_lines[-5:]:
                box.label(text=line[:70])


def _prefs(context: bpy.types.Context):
    try:
        addon_name = __package__.split(".")[0] if "." in __package__ else __package__
        return context.preferences.addons[addon_name].preferences
    except Exception:  # noqa: BLE001
        return None


classes = (C2B_PT_main,)


def register() -> None:
    for c in classes:
        bpy.utils.register_class(c)


def unregister() -> None:
    for c in reversed(classes):
        bpy.utils.unregister_class(c)
