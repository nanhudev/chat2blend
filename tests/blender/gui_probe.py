"""Chat2Blend GUI probe.

Runs INSIDE a visible Blender GUI (`blender --python tests/blender/gui_probe.py`).
It enables the add-on, waits for the bridge, waits until the driver says the
job is finished, then captures a screenshot and writes a JSON report so the
result can be verified without a human at the keyboard.

Env vars:
  C2B_PROBE_OUT    report json path        (default: D:/Chat2Blend/.state/gui_probe.json)
  C2B_PROBE_SHOT   screenshot png path     (default: D:/Chat2Blend/.state/gui_probe.png)
  C2B_PROBE_DONE   driver-written marker   (default: D:/Chat2Blend/.state/gui_done)
  C2B_PROBE_MAX    max wait seconds        (default: 120)
"""
import json
import os
import sys
import time

import bpy

ADDON = "chat2blend"
OUT = os.environ.get("C2B_PROBE_OUT", r"D:/Chat2Blend/.state/gui_probe.json")
SHOT = os.environ.get("C2B_PROBE_SHOT", r"D:/Chat2Blend/.state/gui_probe.png")
DONE = os.environ.get("C2B_PROBE_DONE", r"D:/Chat2Blend/.state/gui_done")
MAX_WAIT = float(os.environ.get("C2B_PROBE_MAX", "120"))

started = time.time()
probe_state = {"phase": "boot", "connected": False, "chunks": [], "errors": []}


def finish(reason: str) -> None:
    # Disable splash so subsequent manual screenshots are clean.
    try:
        if bpy.context.preferences.view.show_splash:
            bpy.context.preferences.view.show_splash = False
            bpy.ops.wm.save_homefile()
    except Exception:  # noqa: BLE001
        pass

    try:
        from chat2blend import state as c2b
        chunks = [{"name": c["name"], "status": c["status"], "ms": c["duration_ms"], "error": c["error"][:300]} for c in c2b.chunks]
        connected = c2b.connected
        log = c2b.log_lines[-40:]
    except Exception as exc:  # noqa: BLE001
        chunks, connected, log = [], False, [f"state import failed: {exc}"]

    objects = []
    for obj in bpy.data.objects:
        objects.append({"name": obj.name, "type": obj.type, "location": [round(v, 3) for v in obj.location]})

    report = {
        "ok": connected and bool(objects) and not any(c["status"] == "failed" for c in chunks),
        "reason": reason,
        "connected": connected,
        "blender": bpy.app.version_string,
        "elapsed_s": round(time.time() - started, 2),
        "chunks": chunks,
        "objects": objects,
        "object_count": len(objects),
        "log": log,
        "errors": probe_state["errors"],
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    def shoot(path: str) -> bool:
        wm = bpy.context.window_manager
        if not wm.windows:
            raise RuntimeError("no window")
        win = wm.windows[0]
        area = next((a for a in win.screen.areas if a.type == "VIEW_3D"), win.screen.areas[0])
        region = next((r for r in area.regions if r.type == "WINDOW"), None)
        try:
            with bpy.context.temp_override(window=win, screen=win.screen):
                bpy.ops.wm.splash_close()
        except Exception:  # noqa: BLE001
            pass
        override = {"window": win, "screen": win.screen, "area": area}
        if region:
            override["region"] = region
        with bpy.context.temp_override(**override):
            try:
                bpy.ops.view3d.view_all()
            except Exception:  # noqa: BLE001
                pass
            bpy.ops.screen.screenshot(filepath=path)
        return os.path.exists(path)

    try:
        os.makedirs(os.path.dirname(SHOT), exist_ok=True)
        if shoot(SHOT):
            report["screenshot"] = SHOT
    except Exception as exc:  # noqa: BLE001
        probe_state["errors"].append(f"screenshot failed: {exc}")
    report["errors"] = probe_state["errors"]
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    print(f"[C2B-PROBE] finished: {reason} objects={len(objects)} chunks={len(chunks)}")
    print(f"[C2B-PROBE] report: {OUT}")

    # give the report a moment to flush, then close Blender
    def _quit():
        bpy.ops.wm.quit_blender()
        return None

    bpy.app.timers.register(_quit, first_interval=1.0)


def apply_prefs() -> None:
    host = os.environ.get("C2B_HOST")
    port = os.environ.get("C2B_PORT")
    if not (host or port):
        return
    try:
        prefs = bpy.context.preferences.addons[ADDON].preferences
        if host:
            prefs.bridge_host = host
        if port:
            prefs.bridge_port = int(port)
        from chat2blend import addon as c2b_addon

        c2b_addon.start_connection(bpy.context)
    except Exception as exc:  # noqa: BLE001
        probe_state["errors"].append(f"prefs: {exc}")


def enable_addon() -> bool:
    try:
        bpy.ops.preferences.addon_enable(module=ADDON)
        apply_prefs()
        return True
    except Exception as exc:  # noqa: BLE001
        probe_state["errors"].append(f"addon_enable: {exc}")
        return False


def poll() -> float:
    # 1) enable
    if not probe_state.get("enabled"):
        if enable_addon():
            probe_state["enabled"] = True
            probe_state["phase"] = "waiting-bridge"
        return 0.5

    # 2) wait for the bridge connection
    if not probe_state["connected"]:
        try:
            from chat2blend import state as c2b

            if c2b.connected:
                probe_state["connected"] = True
                probe_state["phase"] = "waiting-job"
        except Exception:  # noqa: BLE001
            pass

    # 3) wait for the driver marker, with a hard timeout
    if os.path.exists(DONE):
        finish("done-marker")
        return None
    if time.time() - started > MAX_WAIT:
        finish("timeout")
        return None
    return 0.3


print("[C2B-PROBE] starting, addon:", ADDON)
bpy.app.timers.register(poll, first_interval=1.0)
