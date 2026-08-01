#!/usr/bin/env python3
"""Run public verification commands and render their exact output as a short terminal demo."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import textwrap
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg


ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "docs" / "assets" / "application"
OUTPUT = MEDIA / "citadel-live-verification-demo.mp4"
TRANSCRIPT = MEDIA / "live-verification-output.json"
WIDTH, HEIGHT = 1920, 1080
FPS = 15
SLIDE_SECONDS = 14
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
COMMANDS = (
    ("Representative repository replay", "representative:v2:verify"),
    ("Generated public evidence", "application:evidence:check"),
    ("Fresh-clone receipt replay", "onboarding:fresh-clone:verify"),
)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "consolab.ttf" if bold else "consola.ttf"
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), size=size)


def execute(label: str, script: str) -> dict[str, object]:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    command = [npm, "run", script]
    completed = subprocess.run(command, cwd=ROOT, text=True, encoding="utf-8", errors="replace", capture_output=True)
    output = ANSI.sub("", (completed.stdout + completed.stderr).replace("\r\n", "\n")).strip()
    record = {
        "label": label,
        "command": f"npm run {script}",
        "exit_code": completed.returncode,
        "output": output,
        "output_sha256": hashlib.sha256(output.encode("utf-8")).hexdigest(),
    }
    if completed.returncode != 0:
        raise RuntimeError(f"{record['command']} failed:\n{output}")
    return record


def wrapped_lines(record: dict[str, object]) -> list[str]:
    lines = [f"$ {record['command']}", ""]
    for original in str(record["output"]).splitlines():
        lines.extend(textwrap.wrap(original, width=105, replace_whitespace=False, drop_whitespace=False) or [""])
    lines.extend(["", f"exit {record['exit_code']}  ·  stdout sha256:{str(record['output_sha256'])[:16]}…"])
    return lines[-22:]


def render(record: dict[str, object], index: int, target: Path) -> None:
    image = Image.new("RGB", (WIDTH, HEIGHT), "#030812")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, WIDTH, 96), fill="#07192a")
    draw.text((72, 30), "CITADEL · RECORDED REAL COMMAND OUTPUT", font=font(25, True), fill="#49e2ff")
    draw.text((WIDTH - 250, 30), f"{index + 1} / {len(COMMANDS)}", font=font(25, True), fill="#7fa6c2")
    draw.rounded_rectangle((72, 140, WIDTH - 72, HEIGHT - 72), radius=22, fill="#020a16", outline="#3a86aa", width=2)
    draw.line((94, 141, WIDTH - 94, 141), fill="#b8edff", width=1)
    draw.rectangle((72, 140, WIDTH - 72, 204), fill="#102b47")
    for offset, color in enumerate(("#ff6b73", "#f4bd4f", "#45d483")):
        draw.ellipse((102 + offset * 38, 162, 120 + offset * 38, 180), fill=color)
    draw.text((250, 157), str(record["label"]), font=font(22, True), fill="#f4fbff")
    y = 242
    for line in wrapped_lines(record):
        color = "#62e39d" if line.startswith("exit 0") else ("#49e2ff" if line.startswith("$") else "#b8d5e8")
        draw.text((110, y), line, font=font(25, line.startswith("$") or line.startswith("exit 0")), fill=color)
        y += 34
    image.save(target, quality=95)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reuse-recorded-output",
        action="store_true",
        help="Rebuild the visual track without rerunning commands or changing the committed transcript.",
    )
    args = parser.parse_args()
    MEDIA.mkdir(parents=True, exist_ok=True)
    if args.reuse_recorded_output:
        payload = json.loads(TRANSCRIPT.read_text(encoding="utf-8"))
        records = payload["commands"]
    else:
        records = [execute(label, script) for label, script in COMMANDS]
        payload = {
            "schema": 1,
            "kind": "citadel-recorded-verification-output",
            "recorded_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source_revision": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
            "commands": records,
        }
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        payload["transcript_sha256"] = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        TRANSCRIPT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.TemporaryDirectory(prefix="citadel-live-verification-") as temporary:
        temp = Path(temporary)
        segments: list[Path] = []
        for index, record in enumerate(records):
            frame = temp / f"frame-{index:02d}.jpg"
            segment = temp / f"segment-{index:02d}.mp4"
            render(record, index, frame)
            subprocess.run([
                ffmpeg, "-loglevel", "error", "-y", "-loop", "1", "-i", str(frame), "-t", str(SLIDE_SECONDS),
                "-r", str(FPS), "-vf", f"fade=t=in:st=0:d=0.35,fade=t=out:st={SLIDE_SECONDS - 0.35}:d=0.35",
                "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-an", str(segment),
            ], check=True)
            segments.append(segment)
        concat = temp / "segments.txt"
        concat.write_text("".join(f"file '{item.as_posix()}'\n" for item in segments), encoding="utf-8")
        subprocess.run([ffmpeg, "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", "-movflags", "+faststart", str(OUTPUT)], check=True)
    print(f"rendered {OUTPUT} and {TRANSCRIPT}")


if __name__ == "__main__":
    main()
