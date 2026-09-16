#!/usr/bin/env python3
"""Stop the processes launched by launch-test-env.py."""
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(r"D:\Chat2Blend")
PIDS_FILE = ROOT / ".state" / "test-env-pids.json"


def main() -> int:
    if not PIDS_FILE.exists():
        print("no pids file")
        return 0
    pids = json.loads(PIDS_FILE.read_text(encoding="utf-8"))
    for name, pid in pids.items():
        try:
            subprocess.run(["taskkill", "/F", "/PID", str(pid)], check=False, capture_output=True)
            print(f"stopped {name} ({pid})")
        except Exception as e:
            print(f"failed to stop {name}: {e}")
    PIDS_FILE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
