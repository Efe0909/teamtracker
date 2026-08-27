"""PWA ikonlarini uretir (saf Python, bagimlilik yok).

Calistir: .venv/bin/python tools/ikon_uret.py
Uretir: static/icon-180.png (apple-touch-icon), icon-192.png, icon-512.png

Tasarim: paletin mor gradyani (--acc #7c5bff -> #c48fff) uzerine beyaz elmas (rlogo ile ayni).
"""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "static"
ACC = (0x7C, 0x5B, 0xFF)
ACC2 = (0xC4, 0x8F, 0xFF)


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def pixel(x: int, y: int, n: int) -> tuple[int, int, int]:
    """135° gradyan + ortada beyaz elmas (|dx|+|dy| < r), kenarlari yumusak."""
    t = (x / n + y / n) / 2
    bg = tuple(lerp(ACC[i], ACC2[i], t) for i in range(3))
    c, r = (n - 1) / 2, n * 0.30
    d = abs(x - c) + abs(y - c)
    edge = n * 0.012                                  # kenar yumusatma bandi
    if d <= r - edge:
        return (255, 255, 255)
    if d < r + edge:
        k = (r + edge - d) / (2 * edge)               # 0..1
        return tuple(lerp(bg[i], 255, k) for i in range(3))
    return bg


def png(path: Path, n: int) -> None:
    raw = bytearray()
    for y in range(n):
        raw.append(0)                                 # filtre tipi: none
        for x in range(n):
            raw.extend(pixel(x, y, n))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)   # 8-bit truecolor
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                     + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
                     + chunk(b"IEND", b""))
    print(f"{path.name}: {n}x{n}, {path.stat().st_size} bayt")


if __name__ == "__main__":
    for size in (180, 192, 512):
        png(OUT / f"icon-{size}.png", size)
