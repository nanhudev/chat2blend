bl_info = {
    "name": "Chat2Blend",
    "author": "Chat2Blend contributors",
    "version": (0, 1, 0),
    "blender": (4, 0, 0),
    "location": "View3D > Sidebar > Chat2Blend",
    "description": "Execute LLM generated Blender Python streamed from a local bridge (ChatGPT -> Chat2Blend -> Blender)",
    "category": "Development",
}

ADDON_VERSION = "0.1.0"
PROTOCOL_VERSION = "c2b/1"

import importlib
import sys

# Support live reload during development (`bpy.ops.script.reload()`), and make
# sure a stale copy of the modules is never used after a reinstall.
_modules = [
    "state",
    "connection",
    "queue",
    "executor",
    "ui",
    "addon",
]

for _m in _modules:
    _full = f"{__name__}.{_m}"
    if _full in sys.modules:
        try:
            importlib.reload(sys.modules[_full])
        except Exception:
            sys.modules.pop(_full, None)

from . import state  # noqa: E402
from . import connection  # noqa: E402
from . import queue  # noqa: E402
from . import executor  # noqa: E402
from . import ui  # noqa: E402
from . import addon  # noqa: E402


def register():
    addon.register()


def unregister():
    addon.unregister()


if __name__ == "__main__":
    register()
