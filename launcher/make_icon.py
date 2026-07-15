#!/usr/bin/env python3
"""Generate the PFi app icon as a 1024x1024 RGBA PNG (stdlib only).

Draws a rounded-square (macOS squircle-ish) dark background with three
ascending bars in a blue->green gradient — a portfolio/growth mark.
"""
import math
import struct
import sys
import zlib

W = 1024


def write_png(path, width, height, px):
    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: none
        raw += px[y * width * 4:(y + 1) * width * 4]
    out = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) +
           chunk(b"IDAT", zlib.compress(bytes(raw), 9)) +
           chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(out)


def rbox_sdf(px, py, cx, cy, hw, hh, r):
    """Signed distance to a rounded box; < 0 inside."""
    dx = abs(px - cx) - hw + r
    dy = abs(py - cy) - hh + r
    return math.hypot(max(dx, 0.0), max(dy, 0.0)) + min(max(dx, dy), 0.0) - r


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def over(dst, src, a):
    """Alpha-composite src (rgb) with coverage a over dst (rgba tuple)."""
    da = dst[3] / 255.0
    oa = a + da * (1 - a)
    if oa <= 0:
        return (0, 0, 0, 0)
    out = []
    for i in range(3):
        c = (src[i] * a + dst[i] * da * (1 - a)) / oa
        out.append(c)
    return (out[0], out[1], out[2], oa * 255.0)


# Background squircle geometry.
M = 96.0
HW = (W - 2 * M) / 2.0
CX = CY = W / 2.0
R_BG = 200.0

TOP = (30, 41, 66)      # #1e2942
BOT = (11, 15, 26)      # #0b0f1a

# Three capsule bars (cx, top_y, color).
BASE = 752.0
BARS = [
    (342.0, 568.0, (59, 130, 246)),   # blue   #3b82f6
    (512.0, 452.0, (56, 189, 248)),   # sky    #38bdf8
    (682.0, 320.0, (34, 197, 94)),    # green  #22c55e
]
BHW = 58.0
BR = 34.0

px = bytearray(W * W * 4)
for y in range(W):
    for x in range(W):
        # background squircle with ~1px AA
        d = rbox_sdf(x + 0.5, y + 0.5, CX, CY, HW, HW, R_BG)
        cov = min(max(0.5 - d, 0.0), 1.0)
        t = (y - M) / (W - 2 * M)
        t = min(max(t, 0.0), 1.0)
        bg = lerp(TOP, BOT, t)
        cur = (bg[0], bg[1], bg[2], cov * 255.0)
        # bars (clipped to the squircle mask)
        for bcx, btop, col in BARS:
            bcy = (btop + BASE) / 2.0
            bhh = (BASE - btop) / 2.0
            bd = rbox_sdf(x + 0.5, y + 0.5, bcx, bcy, BHW, bhh, BR)
            bcov = min(max(0.5 - bd, 0.0), 1.0) * cov
            if bcov > 0:
                cur = over(cur, col, bcov)
        i = (y * W + x) * 4
        px[i] = int(cur[0] + 0.5)
        px[i + 1] = int(cur[1] + 0.5)
        px[i + 2] = int(cur[2] + 0.5)
        px[i + 3] = int(cur[3] + 0.5)

write_png(sys.argv[1] if len(sys.argv) > 1 else "/tmp/pfi_icon_1024.png", W, W, px)
print("wrote", sys.argv[1] if len(sys.argv) > 1 else "/tmp/pfi_icon_1024.png")
