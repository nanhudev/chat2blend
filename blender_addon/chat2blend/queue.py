"""Thread-safe queue that is drained on Blender's main thread.

bpy is not thread safe: the socket thread only enqueues, `bpy.app.timers`
executes. This is the pattern recommended by Blender for background work.
"""
from __future__ import annotations

import queue as _queue
from typing import Any


class MainThreadQueue:
    def __init__(self) -> None:
        self._q: "_queue.Queue[dict[str, Any]]" = _queue.Queue()

    def push(self, item: dict[str, Any]) -> None:
        self._q.put_nowait(item)

    def push_front(self, item: dict[str, Any]) -> None:
        """Retry support: put an item back at the head of the queue."""
        items = [item]
        while not self._q.empty():
            try:
                items.append(self._q.get_nowait())
            except Exception:  # noqa: BLE001
                break
        for i in items:
            self._q.put_nowait(i)

    def pop(self) -> dict[str, Any] | None:
        try:
            return self._q.get_nowait()
        except Exception:  # noqa: BLE001
            return None

    def clear(self) -> int:
        count = 0
        while not self._q.empty():
            try:
                self._q.get_nowait()
                count += 1
            except Exception:  # noqa: BLE001
                break
        return count

    def __len__(self) -> int:
        return self._q.qsize()
