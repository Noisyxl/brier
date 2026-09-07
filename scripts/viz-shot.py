#!/usr/bin/env python3
"""
Renders `assets/process.html` to the stills the README uses.

The page animates on a fixed clock and accepts `?t=<seconds>`, which freezes it
at that moment. Every frame here is the real page at a real instant, so a still
and the live page can never disagree.

    python3 scripts/viz-shot.py
"""

from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PAGE = (ROOT / "assets" / "process.html").as_uri()
OUT = ROOT / "assets"

# (filename, seconds into the loop, viewport, device scale)
#  50.0  the run complete and the verdict held
FRAMES = [
    ("process.png", 50.0, (1600, 1200), 2),
]


def hero(browser) -> None:
    """The README hero. A fixed-size page, so it is a screenshot, not a design file."""
    frag = (ROOT / "assets" / "hero.template.html").read_text()
    cut = frag.index("</style>") + len("</style>")
    doc = "<!doctype html><html><head><meta charset=utf-8>" + frag[:cut] + "</head><body>" + frag[cut:] + "</body></html>"
    tmp = ROOT / "assets" / ".hero.build.html"
    tmp.write_text(doc)
    page = browser.new_page(viewport={"width": 1983, "height": 793}, device_scale_factor=1)
    page.goto(tmp.as_uri(), wait_until="load")
    page.wait_for_timeout(300)
    page.screenshot(path=str(OUT / "hero.png"))
    page.close()
    tmp.unlink()
    print("  hero.png  1983x793")


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        hero(browser)
        for name, t, (w, h), scale in FRAMES:
            page = browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=scale)
            page.goto(f"{PAGE}?t={t}", wait_until="load")
            # The page draws from requestAnimationFrame; one frame is enough, but
            # wait for the gauges to exist rather than for a fixed delay.
            page.wait_for_function("document.querySelectorAll('#gauges svg path').length > 0")
            page.wait_for_timeout(350)
            page.screenshot(path=str(OUT / name), full_page=True)
            print(f"  {name}  {w}x{h} @{scale}x  t={t}s")
            page.close()
        browser.close()


if __name__ == "__main__":
    main()
