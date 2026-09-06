"""Render the brand SVGs to PNG with headless Chromium.

Every image in the README comes from this script or from term2png.py. Nothing
is drawn by hand and nothing is screenshotted from a design tool, so the whole
set can be regenerated after a palette change with one command:

    python assets/render.py

Requires: pip install playwright && playwright install chromium
"""
import asyncio
from pathlib import Path

from playwright.async_api import async_playwright

HERE = Path(__file__).parent

JOBS = [
    ("icon.svg", "icon.png", 512, 512),
    ("banner.svg", "banner.png", 1600, 460),
]

# The wordmark is monospaced on purpose: this is a terminal product.
FONT = (
    "<link rel='stylesheet' "
    "href='https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap'>"
)


def page_html(svg: str, w: int, h: int) -> str:
    style = f"html,body{{margin:0;background:#0D1117}} svg{{display:block;width:{w}px;height:{h}px}}"
    return f"<html><head>{FONT}<style>{style}</style></head><body>{svg}</body></html>"


async def main() -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for src, out, w, h in JOBS:
            page = await browser.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
            await page.set_content(
                page_html((HERE / src).read_text(encoding="utf-8"), w, h),
                wait_until="networkidle",
            )
            await page.wait_for_timeout(600)
            await page.screenshot(path=str(HERE / out), clip={"x": 0, "y": 0, "width": w, "height": h})
            print("rendered", out)
            await page.close()
        await browser.close()


asyncio.run(main())
