#!/usr/bin/env python3
"""Launch a self-contained test environment for manual browser extension validation.

Runs:
- Chat2Blend bridge (loopback)
- Blender GUI with the add-on auto-connecting
- Edge with the unpacked extension loaded and the fixture page open

The processes are created in their own process groups so they survive this script exiting.
"""
import json
import os
import pathlib
import subprocess
import sys
import time

ROOT = pathlib.Path(r"D:\Chat2Blend")
NODE = pathlib.Path(r"C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe")
BLENDER = ROOT / "_tools" / "blender-4.2.9-windows-x64" / "blender.exe"
EDGE = pathlib.Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
EXT_DIR = ROOT / "apps" / "extension" / "dist"
STATE = ROOT / ".state"
PIDS_FILE = STATE / "test-env-pids.json"


def run(name: str, args: list[str], env: dict[str, str] | None = None, cwd: pathlib.Path | None = None) -> subprocess.Popen:
    out = STATE / f"{name}.log"
    print(f"[launch] starting {name}: {' '.join(args)}")
    return subprocess.Popen(
        args,
        env=env,
        cwd=cwd,
        stdout=open(out, "w", encoding="utf-8"),
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
    )


def wait_for_health(timeout: float = 10.0) -> bool:
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8787/health", timeout=1) as r:
                return r.status == 200
        except Exception:
            time.sleep(0.2)
    return False


def main() -> int:
    STATE.mkdir(exist_ok=True)
    pids: dict[str, int] = {}

    env = os.environ.copy()
    env["C2B_STATE_DIR"] = str(STATE / "bridge-state")
    env["C2B_HTTP_PORT"] = "8787"
    env["C2B_BLENDER_PORT"] = "8788"
    env["C2B_LOG"] = "debug"

    bridge = run("bridge", [str(NODE), str(ROOT / "dist" / "apps" / "bridge" / "src" / "server.js")], env=env, cwd=ROOT)
    pids["bridge"] = bridge.pid

    if not wait_for_health():
        print("[launch] bridge did not become healthy", file=sys.stderr)
        bridge.terminate()
        return 1
    print("[launch] bridge healthy")

    blender = run("blender", [str(BLENDER)], cwd=ROOT)
    pids["blender"] = blender.pid

    edge_data = STATE / "edge-test-data"
    edge_data.mkdir(exist_ok=True)
    edge_args = [
        str(EDGE),
        f"--load-extension={EXT_DIR}",
        f"--user-data-dir={edge_data}",
        "--no-first-run",
        "--no-default-browser-check",
        "--enable-extensions",
        "http://127.0.0.1:8787/fixture",
    ]
    edge = run("edge", edge_args, cwd=ROOT)
    pids["edge"] = edge.pid

    PIDS_FILE.write_text(json.dumps(pids, indent=2), encoding="utf-8")
    print(f"[launch] pids saved to {PIDS_FILE}")
    print("[launch] done. Close Edge/Blender or run: python scripts/stop-test-env.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
