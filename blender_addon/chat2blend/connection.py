"""Loopback transport: newline delimited JSON over a plain TCP socket.

Runs in a background thread. It never calls bpy - it only pushes messages into
a callback that the main-thread timer drains.
"""
from __future__ import annotations

import json
import socket
import threading
import time
from typing import Any, Callable

from . import state

RECV_BUFFER = 1 << 16


class BridgeConnection(threading.Thread):
    def __init__(
        self,
        host: str,
        port: int,
        on_message: Callable[[dict[str, Any]], None],
        on_status: Callable[[bool, str], None],
    ) -> None:
        super().__init__(daemon=True, name="c2b-bridge-connection")
        self.host = host
        self.port = port
        self.on_message = on_message
        self.on_status = on_status
        self._sock: socket.socket | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._buffer = ""
        self.retry_delay = 1.0

    # ------------------------------------------------------------------ api
    def send(self, message: dict[str, Any]) -> bool:
        with self._lock:
            if self._sock is None:
                return False
            try:
                payload = (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
                self._sock.sendall(payload)
                return True
            except Exception as exc:  # noqa: BLE001
                state.log(f"send failed: {exc}", "WARN")
                return False

    def stop(self) -> None:
        self._stop.set()
        with self._lock:
            if self._sock is not None:
                try:
                    self._sock.shutdown(socket.SHUT_RDWR)
                except Exception:
                    pass
                try:
                    self._sock.close()
                except Exception:
                    pass
                self._sock = None

    @property
    def running(self) -> bool:
        return not self._stop.is_set()

    # --------------------------------------------------------------- thread
    def run(self) -> None:
        while not self._stop.is_set():
            try:
                self._connect()
                self._read_loop()
            except Exception as exc:  # noqa: BLE001
                state.log(f"connection error: {exc}", "WARN")
            if self._stop.is_set():
                break
            state.connection_status = "connecting"
            self.on_status(False, str(state.last_error or "disconnected"))
            delay = self.retry_delay
            self.retry_delay = min(self.retry_delay * 1.5, 5.0)
            state.log(f"reconnecting in {delay:.1f}s", "INFO")
            self._stop.wait(delay)

    def _connect(self) -> None:
        state.connection_status = "connecting"
        state.mark_dirty()
        sock = socket.create_connection((self.host, self.port), timeout=5)
        sock.settimeout(None)
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        with self._lock:
            self._sock = sock
        self.retry_delay = 1.0
        state.connected = True
        state.connection_status = "connected"
        state.last_error = ""
        state.log(f"connected to bridge {self.host}:{self.port}", "INFO")
        self.send(
            {
                "type": "hello",
                "addonVersion": state.ADDON_VERSION,
                "blenderVersion": _blender_version(),
                "protocol": "c2b/1",
            }
        )
        self.on_status(True, "connected")

    def _read_loop(self) -> None:
        assert self._sock is not None
        self._buffer = ""
        while not self._stop.is_set():
            try:
                data = self._sock.recv(RECV_BUFFER)
            except Exception as exc:  # noqa: BLE001
                raise ConnectionError(str(exc)) from exc
            if not data:
                raise ConnectionError("bridge closed the connection")
            self._buffer += data.decode("utf-8", errors="replace")
            while "\n" in self._buffer:
                line, self._buffer = self._buffer.split("\n", 1)
                line = line.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except Exception as exc:  # noqa: BLE001
                    state.log(f"bad frame: {exc}", "WARN")
                    continue
                if message.get("type") == "ping":
                    self.send({"type": "pong", "t": message.get("t", 0)})
                    state.last_heartbeat = time.time()
                    continue
                self.on_message(message)


def _blender_version() -> str:
    try:
        import bpy

        return ".".join(str(v) for v in bpy.app.version)
    except Exception:  # noqa: BLE001
        return "unknown"


class FakeConnection:
    """Used by the add-on's self test (no bridge required)."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def send(self, message: dict[str, Any]) -> bool:
        self.sent.append(message)
        return True

    def stop(self) -> None:
        pass
