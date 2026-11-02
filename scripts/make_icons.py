#!/usr/bin/env python3
"""Draw the Lift Log icon. No third-party image libraries."""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'site'


def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size, pixel):
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel(x, y, size))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def icon_pixel(x, y, size, glyph_scale=1):
    bg = (12, 14, 18, 255)
    plate = (16, 36, 30, 255)
    mint = (142, 240, 194, 255)
    cx = cy = (size - 1) / 2
    radius = size * 0.46
    if (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2:
        return bg
    gx = (x - cx) / glyph_scale + cx
    gy = (y - cy) / glyph_scale + cy
    left = size * 0.30
    right = size * 0.70
    bar = size * 0.075
    plate_r = size * 0.145
    on_bar = abs(gy - cy) <= bar / 2 and left <= gx <= right
    on_left = (gx - left) ** 2 + (gy - cy) ** 2 <= plate_r ** 2
    on_right = (gx - right) ** 2 + (gy - cy) ** 2 <= plate_r ** 2
    if on_bar or on_left or on_right:
        return mint
    return plate


def main():
    write_png(ROOT / 'favicon.png', 32, lambda x, y, s: icon_pixel(x, y, s))
    write_png(ROOT / 'icons/apple-touch-icon.png', 180, lambda x, y, s: icon_pixel(x, y, s))
    write_png(ROOT / 'icons/icon-192.png', 192, lambda x, y, s: icon_pixel(x, y, s))
    write_png(ROOT / 'icons/icon-512.png', 512, lambda x, y, s: icon_pixel(x, y, s))
    write_png(ROOT / 'icons/icon-maskable-512.png', 512, lambda x, y, s: icon_pixel(x, y, s, glyph_scale=0.72))


if __name__ == '__main__':
    main()
