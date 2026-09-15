"""Headless smoke test: enable the add-on, connect to a running bridge,
execute one chunk, and write a report. Run with:

    blender --background --python tests/blender/headless_probe.py
"""
import json
import os
import time

import bpy

OUT = os.environ.get("C2B_OUT", r"D:/Chat2Blend/.state/headless_probe.json")
CODE = os.environ.get("C2B_CODE", "import bpy\nbpy.ops.mesh.primitive_cube_add(size=2, location=(0,0,1))\n")
WAIT = float(os.environ.get("C2B_WAIT", "8"))

report = {"steps": []}


def step(name, ok, detail=""):
    report["steps"].append({"name": name, "ok": ok, "detail": str(detail)[:500]})
    print(f"[headless] {'OK ' if ok else 'ERR'} {name} {detail}"[:300])


try:
    bpy.ops.preferences.addon_enable(module="chat2blend")
    step("addon_enable", True)
except Exception as exc:  # noqa: BLE001
    step("addon_enable", False, exc)

try:
    from chat2blend import addon, state

    step("import", True)
except Exception as exc:  # noqa: BLE001
    step("import", False, exc)
    raise SystemExit(1)

# Optional endpoint override (C2B_HOST / C2B_PORT) for tests
try:
    if os.environ.get("C2B_HOST") or os.environ.get("C2B_PORT"):
        prefs = bpy.context.preferences.addons["chat2blend"].preferences
        if os.environ.get("C2B_HOST"):
            prefs.bridge_host = os.environ["C2B_HOST"]
        if os.environ.get("C2B_PORT"):
            prefs.bridge_port = int(os.environ["C2B_PORT"])
        step("prefs_override", True, f"{prefs.bridge_host}:{prefs.bridge_port}")
except Exception as exc:  # noqa: BLE001
    step("prefs_override", False, exc)

# Connect synchronously (no timers in background mode)
try:
    addon.start_connection(bpy.context)
    step("start_connection", True)
except Exception as exc:  # noqa: BLE001
    step("start_connection", False, exc)

# The socket thread connects on its own; wait for it.
deadline = time.time() + WAIT
while time.time() < deadline and not state.connected:
    time.sleep(0.2)
step("connected", state.connected, state.connection_status)

if state.connected:
    addon.pending.push({"kind": "job_begin", "job_id": "job_test", "title": "headless", "provider": "test"})
    addon.pending.push(
        {"kind": "exec", "job_id": "job_test", "chunk_id": "chunk_test", "name": "cube", "index": 0, "code": CODE}
    )
    # drain manually - bpy.app.timers do not run while we block, so call tick()
    tries = 0
    while tries < 60 and not any(c["status"] in {"completed", "failed"} for c in state.chunks):
        addon.tick()
        time.sleep(0.1)
        tries += 1
    step("executed", bool(state.chunks), json.dumps(state.chunks))

report["chunks"] = list(state.chunks)
report["objects"] = [o.name for o in bpy.data.objects]
report["log"] = list(state.log_lines)[-30:]
report["connected"] = state.connected
report["ok"] = state.connected and any(c["status"] == "completed" for c in state.chunks)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(report, fh, indent=2)
print("[headless] report:", OUT, "ok=", report["ok"])
