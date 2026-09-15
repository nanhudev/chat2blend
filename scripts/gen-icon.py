#!/usr/bin/env python3
import struct
import sys
import zlib

out = sys.argv[1]
W, H = 128, 128
# fill with Chat2Blend blue-orange-ish
rgba = bytes([0x4A, 0x90, 0xD9, 0xFF] * (W * H))
raw = b""
for y in range(H):
    raw += b"\x00" + rgba[y * W * 4 : (y + 1) * W * 4]

compressed = zlib.compress(raw)

def chunk(type_bytes, data):
    crc = zlib.crc32(type_bytes + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + type_bytes + data + struct.pack(">I", crc)

ihdr_data = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr_data) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
with open(out, "wb") as f:
    f.write(png)
print("generated", out)
