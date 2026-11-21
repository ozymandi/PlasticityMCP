"""Build HyperFrames compositions from promo/src/<fmt>/ templates.

- inlines <!--@svg:name--> with promo/assets/svg/<name>.svg
- inlines <!--@common--> with promo/src/common.css contents
- copies referenced assets (img/video) into videos/<proj>/assets/
usage: build.py 16x9 | shorts | surfacing
"""
import pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
FMT = sys.argv[1]
PROJ = {"16x9": "plasticity-mcp-16x9", "shorts": "plasticity-mcp-shorts", "surfacing": "surfacing-2d"}[FMT]
SRC = ROOT / "src" / FMT
DST = ROOT / "videos" / PROJ
COMMON = (ROOT / "src" / "common.css").read_text(encoding="utf-8")
HELPERS = (ROOT / "src" / "helpers.js").read_text(encoding="utf-8")
SVG_RE = re.compile(r"<!--@svg:([a-z0-9-]+)-->")
ASSET_RE = re.compile(r"assets/(img|video|audio|fonts|photoreal|steel)/([A-Za-z0-9_./-]+\.[a-z0-9]+)")

(DST / "compositions").mkdir(exist_ok=True)
(DST / "assets").mkdir(exist_ok=True)
copied = set()
for src in sorted(SRC.glob("*.html")):
    html = src.read_text(encoding="utf-8")
    html = html.replace("/*@common*/", COMMON).replace("//@helpers", HELPERS)

    def svg(m):
        return (ROOT / "assets" / "svg" / f"{m.group(1)}.svg").read_text(encoding="utf-8")

    html = SVG_RE.sub(svg, html)
    for kind, name in ASSET_RE.findall(html):
        s = ROOT / "assets" / kind / name
        d = DST / "assets" / kind / name
        if s.is_file() and name not in copied:
            d.parent.mkdir(parents=True, exist_ok=True)
            if not d.exists() or d.stat().st_mtime < s.stat().st_mtime:
                shutil.copy2(s, d)
            copied.add(name)
    out = DST / ("index.html" if src.name == "index.html" else f"compositions/{src.name}")
    out.write_text(html, encoding="utf-8")
    print(f"{out.relative_to(ROOT)}  {len(html)//1024} KB")
print("assets:", sorted(copied))
