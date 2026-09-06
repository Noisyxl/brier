#!/usr/bin/env python3
"""
Records `assets/process.html` running, and writes the two files a README needs.

    assets/process.mp4   the full loop, h264, for anyone who wants to watch it
    assets/process.gif   the same run, smaller, because GitHub plays a GIF inline

This records the real page in real time rather than compositing frames, so what
the video shows is what the page does. The clock is the page's own: one lap is
the walkthrough, then the rest of the run, then the verdict held.

    python3 scripts/viz-video.py [seconds]

Requires ffmpeg.
"""

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PAGE = (ROOT / "assets" / "process.html").as_uri()
OUT = ROOT / "assets"

# Tall enough for the whole panel in its longest state; the ground is black, so
# a shorter state simply leaves black at the foot rather than a seam.
W, H = 1600, 1470

# One full lap of the page's clock, plus a beat so the loop does not cut mid-frame.
DURATION = float(sys.argv[1]) if len(sys.argv) > 1 else 55.0


def run(*args: str) -> None:
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> None:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is not on PATH")

    tmp = Path(tempfile.mkdtemp(prefix="brier-video-"))
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(
            viewport={"width": W, "height": H},
            record_video_dir=str(tmp),
            record_video_size={"width": W, "height": H},
        )
        page = ctx.new_page()
        page.goto(PAGE, wait_until="load")
        page.wait_for_function("document.querySelectorAll('#gauges svg path').length > 0")
        print(f"  recording {DURATION:.0f}s at {W}x{H} …")
        page.wait_for_timeout(int(DURATION * 1000))
        ctx.close()          # flushes the video
        browser.close()

    raw = next(tmp.glob("*.webm"))
    mp4 = OUT / "process.mp4"
    gif = OUT / "process.gif"

    # h264 in yuv420p, faststart: the combination every browser and player takes.
    run(
        "ffmpeg", "-y", "-i", str(raw),
        "-vf", "scale=1440:-2:flags=lanczos",
        "-c:v", "libx264", "-preset", "slow", "-crf", "23",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        "-an", str(mp4),
    )

    # The GIF is the one a README plays inline, so it is cut rather than shipped
    # whole: three records going through the loop, then the run finishing and the
    # verdict. The middle of the walk repeats itself and costs megabytes to say so.
    cuts = [(0.0, 10.0), (35.5, 49.5)]
    parts = []
    for i, (start, end) in enumerate(cuts):
        part = tmp / f"cut{i}.mp4"
        run("ffmpeg", "-y", "-ss", str(start), "-t", str(end - start), "-i", str(raw),
            "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(part))
        parts.append(part)

    listing = tmp / "cuts.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in parts))
    cut = tmp / "cut.mp4"
    run("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(cut))

    # A GIF has 256 colours at most, and this page uses about six. Building the
    # palette from the footage — and capping it — is what keeps the file small
    # without banding the one yellow that carries the meaning.
    palette = tmp / "palette.png"
    chain = "fps=10,scale=900:-1:flags=lanczos"
    run("ffmpeg", "-y", "-i", str(cut), "-vf", f"{chain},palettegen=max_colors=64:stats_mode=diff", str(palette))
    run(
        "ffmpeg", "-y", "-i", str(cut), "-i", str(palette),
        "-lavfi", f"{chain}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        "-loop", "0", str(gif),
    )

    shutil.rmtree(tmp, ignore_errors=True)
    for f in (mp4, gif):
        print(f"  {f.name}  {f.stat().st_size / 1_048_576:.1f} MB")


if __name__ == "__main__":
    main()
