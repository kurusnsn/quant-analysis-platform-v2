#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
from pathlib import Path

from PIL import Image


def _trim_transparent_edges(img: Image.Image) -> Image.Image:
    # If the source has transparency, crop away fully-transparent margins.
    if img.mode not in ("RGBA", "LA") and not (
        img.mode == "P" and "transparency" in img.info
    ):
        return img

    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return img
    return rgba.crop(bbox)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=(
            "Split a side-by-side (light|dark) composite logo into separate PNGs.\n\n"
            "Writes:\n"
            "  ui/public/logo-light-mode.png (right half)\n"
            "  ui/public/logo-dark-mode.png  (left half)\n"
        ),
        formatter_class=argparse.RawTextHelpFormatter,
    )
    ap.add_argument(
        "--in",
        dest="input_path",
        required=True,
        help="Path to the composite image (e.g. 1024x1024 side-by-side).",
    )
    ap.add_argument(
        "--out-dir",
        default="ui/public",
        help="Output directory (default: ui/public).",
    )
    ap.add_argument(
        "--no-trim",
        action="store_true",
        help="Do not trim transparent margins (default trims when alpha is present).",
    )
    args = ap.parse_args()

    src = Path(args.input_path).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(src)
    w, h = img.size
    mid = w // 2
    if mid <= 0:
        raise SystemExit(f"Invalid image width: {w}")

    # Convention based on the provided composite:
    # - Left half is the light-colored logo intended for dark mode backgrounds.
    # - Right half is the dark-colored logo intended for light mode backgrounds.
    left = img.crop((0, 0, mid, h))
    right = img.crop((mid, 0, w, h))

    if not args.no_trim:
        left = _trim_transparent_edges(left)
        right = _trim_transparent_edges(right)

    dark_mode_path = out_dir / "logo-dark-mode.png"
    light_mode_path = out_dir / "logo-light-mode.png"

    left.convert("RGBA").save(dark_mode_path, format="PNG", optimize=True)
    right.convert("RGBA").save(light_mode_path, format="PNG", optimize=True)

    print(f"Wrote {os.path.relpath(dark_mode_path, Path.cwd())}")
    print(f"Wrote {os.path.relpath(light_mode_path, Path.cwd())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
