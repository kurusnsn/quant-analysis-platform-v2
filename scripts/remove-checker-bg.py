#!/usr/bin/env python3

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def remove_checker_background(
    img: Image.Image,
    *,
    gray_diff_threshold: int = 3,
    min_luminance: int = 200,
    trim: bool = True,
) -> Image.Image:
    """
    Remove a baked-in checkerboard "transparent" background (light/gray squares)
    and replace it with actual alpha transparency.

    Heuristic:
    - Candidate background pixels are near-gray (RGB channels close to each other)
      AND bright enough (min_luminance).
    - We flood-fill candidates from the image border to avoid removing interior
      whites (e.g. logo outlines).
    """

    rgba = img.convert("RGBA")
    arr = np.array(rgba, dtype=np.uint8)  # (H, W, 4)

    rgb = arr[..., :3].astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = (r + g + b) / 3.0

    near_gray = (
        (np.abs(r - g) <= gray_diff_threshold)
        & (np.abs(r - b) <= gray_diff_threshold)
        & (np.abs(g - b) <= gray_diff_threshold)
    )
    candidate = near_gray & (lum >= float(min_luminance))

    h, w = candidate.shape
    bg = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def seed(y: int, x: int) -> None:
        if candidate[y, x] and not bg[y, x]:
            bg[y, x] = True
            q.append((y, x))

    for x in range(w):
        seed(0, x)
        seed(h - 1, x)
    for y in range(h):
        seed(y, 0)
        seed(y, w - 1)

    while q:
        y, x = q.popleft()
        if y > 0:
            seed(y - 1, x)
        if y + 1 < h:
            seed(y + 1, x)
        if x > 0:
            seed(y, x - 1)
        if x + 1 < w:
            seed(y, x + 1)

    # Turn the connected background into actual transparency.
    alpha = arr[..., 3]
    alpha[bg] = 0
    arr[..., 3] = alpha

    out = Image.fromarray(arr)

    if trim:
        bbox = out.getchannel("A").getbbox()
        if bbox:
            out = out.crop(bbox)

    return out


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Remove checkerboard backgrounds from logo PNGs and output a transparent PNG.",
    )
    ap.add_argument("--in", dest="input_path", required=True, help="Input image path.")
    ap.add_argument("--out", dest="output_path", required=True, help="Output PNG path.")
    ap.add_argument(
        "--gray-diff",
        type=int,
        default=3,
        help="Max |R-G|/|R-B|/|G-B| for a pixel to be considered gray (default: 3).",
    )
    ap.add_argument(
        "--min-lum",
        type=int,
        default=200,
        help="Min average luminance for a pixel to be considered background (default: 200).",
    )
    ap.add_argument(
        "--no-trim",
        action="store_true",
        help="Do not trim transparent margins (default trims).",
    )
    args = ap.parse_args()

    src = Path(args.input_path).expanduser().resolve()
    dst = Path(args.output_path).expanduser().resolve()
    dst.parent.mkdir(parents=True, exist_ok=True)

    img = Image.open(src)
    out = remove_checker_background(
        img,
        gray_diff_threshold=args.gray_diff,
        min_luminance=args.min_lum,
        trim=(not args.no_trim),
    )
    out.save(dst, format="PNG", optimize=True)

    print(f"Wrote {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

