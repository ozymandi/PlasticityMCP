"""Presentation sheet from export_drawing SVGs, in the layout of the examples' *-presentation.png.

    python examples/tools/presentation.py <drawings dir> <prefix> "<title>" [out.png]

Reads <prefix>-front / back / left / right / top / bottom / isometric / sheet.svg from the
drawings dir (the files export_drawing writes), keeps the visible lines only and lays the views
out one under another: 1600 px wide, title and subtitle, each view under its label in a 1 px
frame, fitted into 1480 x 1200 px, the front / top / right sheet last, footer. The default
output is <drawings dir>/<prefix>-presentation.png.

Needs Pillow, Inkscape (INKSCAPE or the default install path) and the Segoe UI fonts (Windows).
The layout was measured from mountain-bike/drawings/bike-presentation.png.
"""

import os
import re
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

INKSCAPE = os.environ.get("INKSCAPE", r"C:\Program Files\Inkscape\bin\inkscape.exe")
FONTS = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")

WIDTH, MARGIN = 1600, 60
BOX_W, BOX_H = 1480, 1200  # largest view, without the frame
GAP = 109  # from one frame to the next
STROKE_PX = 1.6  # visible lines on the page, whatever the view's scale
SUBTITLE = "Hidden-line drawings, visible lines only, all views"
FOOTER = "Plasticity 26.1.3 via PlasticityMCP export_drawing"
VIEWS = [("Front", "front"), ("Back", "back"), ("Left", "left"), ("Right", "right"), ("Top", "top"),
         ("Bottom", "bottom"), ("Isometric", "isometric"), ("Sheet: front / top / right", "sheet")]


def font(bold: bool, sample: str, ink_rows: int) -> ImageFont.FreeTypeFont:
    """The smallest size whose ink of `sample` is `ink_rows` pixels tall (as measured)."""
    path = os.path.join(FONTS, "segoeuib.ttf" if bold else "segoeui.ttf")
    for size in range(10, 120):
        f = ImageFont.truetype(path, size)
        top, bottom = f.getbbox(sample)[1::2]
        if bottom - top + 1 >= ink_rows:
            return f
    raise RuntimeError("no font size fits")


def render(svg_path: str, work: str) -> Image.Image:
    """The view with its hidden lines removed, fitted into the box, lines STROKE_PX wide."""
    svg = open(svg_path, encoding="utf-8").read()
    size = re.search(r'width="([\d.]+)mm" height="([\d.]+)mm"', svg)
    if not size:
        raise ValueError(f"{svg_path}: not an export_drawing SVG (no size in mm)")
    w_mm, h_mm = float(size[1]), float(size[2])
    scale = min(BOX_W / w_mm, BOX_H / h_mm)  # px per mm
    svg = re.sub(r'<(polyline|path|ellipse)[^>]*class="hidden"[^>]*/>\s*', "", svg)
    svg = svg.replace(".visible { stroke: #000; stroke-width: 0.35; }",
                      f".visible {{ stroke: #000; stroke-width: {STROKE_PX / scale:.4f}; }}")
    name = os.path.splitext(os.path.basename(svg_path))[0]
    visible_svg = os.path.join(work, name + ".svg")
    png = os.path.join(work, name + ".png")
    with open(visible_svg, "w", encoding="utf-8") as f:
        f.write(svg)
    subprocess.run([INKSCAPE, visible_svg, "--export-type=png", f"--export-width={round(w_mm * scale)}",
                    "--export-background=white", "--export-background-opacity=1",
                    f"--export-filename={png}"], check=True, capture_output=True)
    return Image.open(png).convert("RGB")


def main() -> None:
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    src, prefix, title = sys.argv[1:4]
    out = sys.argv[4] if len(sys.argv) == 5 else os.path.join(src, f"{prefix}-presentation.png")

    with tempfile.TemporaryDirectory() as work:
        views = [(label, render(os.path.join(src, f"{prefix}-{view}.svg"), work)) for label, view in VIEWS]

    f_title = font(True, "Mountain bike", 42)
    f_subtitle = font(False, SUBTITLE, 27)
    f_label = font(True, "Front", 24)
    f_footer = font(False, FOOTER, 27)

    first_frame = 289
    height = first_frame + sum(im.height + 2 for _, im in views) + GAP * (len(views) - 1) + 40 + 27 + 34
    page = Image.new("RGB", (WIDTH, height), "white")
    draw = ImageDraw.Draw(page)

    def text_at_ink_top(x: int, y: int, s: str, f: ImageFont.FreeTypeFont, color: tuple) -> None:
        left, top = f.getbbox(s)[:2]
        draw.text((x - left, y - top), s, font=f, fill=color)

    text_at_ink_top(MARGIN, 80, title, f_title, (17, 17, 17))
    text_at_ink_top(MARGIN, 140, SUBTITLE, f_subtitle, (102, 102, 102))
    draw.rectangle((MARGIN, 180, WIDTH - MARGIN, 181), fill=(204, 204, 204))

    top = first_frame
    for label, im in views:
        draw.text((MARGIN, top - 13), label, font=f_label, fill=(34, 34, 34), anchor="ls")
        x = (WIDTH - im.width) // 2
        page.paste(im, (x, top + 1))
        draw.rectangle((x - 1, top, x + im.width, top + im.height + 1), outline=(221, 221, 221))
        bottom = top + im.height + 1
        top = bottom + GAP
    text_at_ink_top(MARGIN, bottom + 40, FOOTER, f_footer, (153, 153, 153))

    page.save(out, optimize=True)
    print(f"{out}: {page.size[0]} x {page.size[1]}")


if __name__ == "__main__":
    main()
