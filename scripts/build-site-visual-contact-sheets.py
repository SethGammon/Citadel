#!/usr/bin/env python3
"""Build labeled contact sheets for the Citadel viewport-slice catalog."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "output" / "playwright" / "site-visual-audit" / "before"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--tile-width", type=int, default=320)
    return parser.parse_args()


def build_sheet(entry: dict, input_root: Path, output_root: Path, columns: int, tile_width: int) -> Path:
    slices = entry["slices"]
    viewport = entry["viewport"]
    page = entry["page"]
    ratio = viewport["height"] / viewport["width"]
    tile_height = round(tile_width * ratio)
    label_height = 34
    rows = math.ceil(len(slices) / columns)
    sheet = Image.new("RGB", (columns * tile_width, rows * (tile_height + label_height)), "#071725")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, slice_record in enumerate(slices):
        source = ROOT / slice_record["path"]
        with Image.open(source) as image:
            tile = image.convert("RGB").resize((tile_width, tile_height), Image.Resampling.LANCZOS)
        x = (index % columns) * tile_width
        y = (index // columns) * (tile_height + label_height)
        sheet.paste(tile, (x, y + label_height))
        label = f"{page['id']} / {viewport['id']} / {index + 1:02d} / y={slice_record['scroll_y']}"
        draw.rectangle((x, y, x + tile_width, y + label_height), fill="#0e2b40")
        draw.text((x + 8, y + 10), label, fill="#dff7ff", font=font)
    output_root.mkdir(parents=True, exist_ok=True)
    target = output_root / f"{page['id']}--{viewport['id']}.png"
    sheet.save(target, format="PNG", optimize=True)
    return target


def main() -> None:
    args = arguments()
    input_root = args.input.resolve()
    manifest = json.loads((input_root / "manifest.json").read_text(encoding="utf-8"))
    output_root = input_root / "contact-sheets"
    targets = [
        build_sheet(entry, input_root, output_root, args.columns, args.tile_width)
        for entry in manifest["captures"]
    ]
    print(json.dumps({"contact_sheets": len(targets), "output": str(output_root.relative_to(ROOT))}, indent=2))


if __name__ == "__main__":
    main()
