#!/usr/bin/env python3
"""Render the two-minute evaluator walkthrough from committed Citadel media."""

from __future__ import annotations

import argparse
import asyncio
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
import edge_tts
import imageio_ffmpeg


ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / "docs" / "assets" / "application"
OUTPUT = MEDIA / "citadel-sentient-walkthrough.mp4"
NARRATION = MEDIA / "walkthrough-narration.txt"
CAPTIONS = MEDIA / "citadel-sentient-walkthrough.vtt"
VOICE = "en-US-AndrewMultilingualNeural"
RATE = "+25%"
WIDTH, HEIGHT = 1920, 1080
FPS = 15
SLIDE_SECONDS = 20

SLIDES = (
    ("01-product-entry.png", "Start with /do.", "Progressive power without another IDE or orchestration language."),
    ("01-product-entry.png", "The operation is the unit.", "Route, execute, verify, record, and resume from repository state."),
    ("02-evidence-hero.png", "Every claim has a boundary.", "Observed runtime, model-external verdicts, explicit cost lenses, signed receipts."),
    ("03-policy-comparison.png", "V1: savings not robust.", "27/36 verified cells · timeout sensitivity reverses the economic direction."),
    ("03-policy-comparison.png", "V2: matched completion. More cost.", "12 escalations · 15.7% more GPU energy · plausible policy rejected."),
    ("02-evidence-hero.png", "V3: artifacts passed. Economics failed.", "6/12 each · zero false passes · 7.1% energy reduction missed the gate."),
)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidate = Path("C:/Windows/Fonts") / ("segoeuib.ttf" if bold else "segoeui.ttf")
    return ImageFont.truetype(str(candidate), size=size)


def slide(source: Path, title: str, subtitle: str, output: Path) -> None:
    image = Image.open(source).convert("RGB")
    canvas = ImageOps.fit(image, (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS, centering=(0.5, 0.48)).convert("RGBA")
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for y in range(HEIGHT - 350, HEIGHT):
        alpha = int(225 * ((y - (HEIGHT - 350)) / 350))
        draw.line((0, y, WIDTH, y), fill=(3, 8, 18, alpha))
    draw.rounded_rectangle((92, HEIGHT - 268, WIDTH - 92, HEIGHT - 72), radius=26, fill=(10, 29, 48, 232), outline=(58, 134, 170, 235), width=2)
    draw.line((118, HEIGHT - 267, WIDTH - 118, HEIGHT - 267), fill=(184, 237, 255, 28), width=2)
    draw.rectangle((92, HEIGHT - 268, 100, HEIGHT - 72), fill=(73, 226, 255, 255))
    draw.text((138, HEIGHT - 235), title, font=font(55, True), fill=(244, 251, 255, 255))
    draw.text((140, HEIGHT - 158), subtitle, font=font(28), fill=(184, 213, 232, 255))
    draw.text((WIDTH - 382, HEIGHT - 112), "CITADEL · OPEN EVIDENCE", font=font(19, True), fill=(73, 226, 255, 235))
    Image.alpha_composite(canvas, overlay).convert("RGB").save(output, quality=94)


def run(command: list[str]) -> None:
    subprocess.run(command, check=True)


async def synthesize(text: str, output: Path, captions: Path) -> None:
    communicator = edge_tts.Communicate(text, VOICE, rate=RATE)
    subtitles = edge_tts.SubMaker()
    with output.open("wb") as audio:
        async for chunk in communicator.stream():
            if chunk["type"] == "audio":
                audio.write(chunk["data"])
            elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
                subtitles.feed(chunk)
    srt = subtitles.get_srt()
    vtt = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", srt)
    captions.write_text(f"WEBVTT\n\n{vtt.strip()}\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reuse-existing-audio",
        action="store_true",
        help="Rebuild the visual track offline while preserving the committed walkthrough audio and captions.",
    )
    args = parser.parse_args()
    required = [MEDIA / item[0] for item in SLIDES]
    missing = [path for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError(f"missing application images: {missing}")
    text = NARRATION.read_text(encoding="utf-8").strip()
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    if args.reuse_existing_audio and not OUTPUT.exists():
        raise FileNotFoundError(f"cannot reuse audio because {OUTPUT} does not exist")
    with tempfile.TemporaryDirectory(prefix="citadel-walkthrough-") as temporary:
        temp = Path(temporary)
        if args.reuse_existing_audio:
            audio = temp / "narration.m4a"
            run([ffmpeg, "-loglevel", "error", "-y", "-i", str(OUTPUT), "-vn", "-c:a", "copy", str(audio)])
        else:
            audio = temp / "narration.mp3"
            asyncio.run(synthesize(text, audio, CAPTIONS))
        segment_paths: list[Path] = []
        for index, (filename, title, subtitle) in enumerate(SLIDES):
            rendered = temp / f"slide-{index:02d}.jpg"
            segment = temp / f"segment-{index:02d}.mp4"
            slide(MEDIA / filename, title, subtitle, rendered)
            run([
                ffmpeg, "-loglevel", "error", "-y", "-loop", "1", "-i", str(rendered), "-t", str(SLIDE_SECONDS),
                "-r", str(FPS), "-vf", f"fade=t=in:st=0:d=0.5,fade=t=out:st={SLIDE_SECONDS - 0.5}:d=0.5",
                "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-an", str(segment),
            ])
            segment_paths.append(segment)
        concat = temp / "segments.txt"
        concat.write_text("".join(f"file '{path.as_posix()}'\n" for path in segment_paths), encoding="utf-8")
        silent = temp / "silent.mp4"
        run([ffmpeg, "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(silent)])
        run([
            ffmpeg, "-loglevel", "error", "-y", "-i", str(silent), "-i", str(audio), "-t", "120",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(OUTPUT),
        ])
    print(f"rendered {OUTPUT} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
