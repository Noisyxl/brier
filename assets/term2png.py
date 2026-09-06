"""Render a captured ANSI terminal transcript as a PNG in the brand's frame.

    brier score > assets/score.txt
    python assets/term2png.py assets/score.txt assets/score.png [max_lines]

Screenshots taken by hand drift: a different terminal, a different font, a
different width, and the README stops looking like one product. This script
takes the bytes the program actually wrote — escape codes and all — and paints
them in the palette from docs/design-tokens.json, so every terminal image in
the README is the real output and they all match.

Requires: pip install playwright && playwright install chromium
"""
import asyncio
import html
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

ANSI = re.compile(r"\x1b\[([0-9;]*)m")
# Cursor moves, line clears and the carriage returns a progress spinner leaves
# behind. They are not colour and they must not reach the page.
NOISE = re.compile(r"\x1b\[[0-9;?]*[A-HJKSTfhlsu]|\x1b\][^\x07]*\x07|\r")
FONT = (
    "<link rel='stylesheet' "
    "href='https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap'>"
)

PAPER = "#0D1117"
PANEL = "#161B22"
LINE = "#2E3643"
INK = "#E8E3D9"

# The 24-bit colours util/fmt.ts emits, mapped to names for the CSS below.
TRUECOLOR = re.compile(r"38;2;(\d+);(\d+);(\d+)")
TRUEBG = re.compile(r"48;2;(\d+);(\d+);(\d+)")


def ansi_to_html(text: str) -> str:
    out: list[str] = []
    fg: str | None = None
    bg: str | None = None
    dim = False
    pos = 0

    def open_span() -> str:
        style = []
        if fg:
            style.append(f"color:{fg}")
        if bg:
            style.append(f"background:{bg};padding:1px 5px;border-radius:2px")
        if dim:
            style.append("opacity:.7")
        return f"<span style='{';'.join(style)}'>" if style else "<span>"

    out.append(open_span())
    for m in ANSI.finditer(text):
        out.append(html.escape(text[pos:m.start()]))
        pos = m.end()
        code = m.group(1) or "0"

        out.append("</span>")
        if code in ("0", ""):
            fg, bg, dim = None, None, False
        elif code == "2":
            dim = True
        else:
            c = TRUECOLOR.search(code)
            b = TRUEBG.search(code)
            if c:
                fg = f"rgb({c.group(1)},{c.group(2)},{c.group(3)})"
            if b:
                bg = f"rgb({b.group(1)},{b.group(2)},{b.group(3)})"
        out.append(open_span())

    out.append(html.escape(text[pos:]))
    out.append("</span>")
    return "".join(out)


def page(body: str, title: str) -> str:
    return f"""<html><head>{FONT}<style>
      html,body{{margin:0;background:{PAPER};font-family:'JetBrains Mono',ui-monospace,monospace}}
      .frame{{margin:24px;border:1px solid {LINE};background:{PANEL}}}
      .bar{{display:flex;gap:8px;align-items:center;padding:8px 14px;border-bottom:1px solid {LINE};
            color:#8B94A3;font-size:12px;letter-spacing:2px;text-transform:uppercase}}
      .dot{{width:8px;height:8px;border-radius:50%;background:{LINE}}}
      pre{{margin:0;padding:16px 18px;color:{INK};font-size:13px;line-height:1.5;white-space:pre;
           overflow:hidden;font-variant-numeric:tabular-nums}}
    </style></head><body>
      <div class="frame">
        <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span style="margin-left:6px">{html.escape(title)}</span></div>
        <pre>{body}</pre>
      </div>
    </body></html>"""


async def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        raise SystemExit(2)

    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    max_lines = int(sys.argv[3]) if len(sys.argv) > 3 else 0

    raw = NOISE.sub("", src.read_text(encoding="utf-8", errors="replace"))
    # `script` leaves a lone backslash where it wrapped the pty; it is not output.
    raw = "\n".join(l.rstrip() for l in raw.split("\n") if l.strip() != "\\").strip("\n")
    if max_lines:
        raw = "\n".join(raw.split("\n")[:max_lines])

    width = max((len(ANSI.sub("", l)) for l in raw.split("\n")), default=80)
    px_width = min(1600, max(760, int(width * 7.9) + 90))

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        pg = await browser.new_page(viewport={"width": px_width, "height": 400}, device_scale_factor=2)
        await pg.set_content(page(ansi_to_html(raw), f"brier {src.stem}"), wait_until="networkidle")
        await pg.wait_for_timeout(400)
        await pg.locator(".frame").screenshot(path=str(dst))
        await browser.close()
    print("rendered", dst)


asyncio.run(main())
