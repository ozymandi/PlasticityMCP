"""Prepare Plasticity export_drawing SVGs for draw-on animation.

Input: a drawing SVG (polyline/path/ellipse elements, class visible|hidden,
one <g transform="translate(...)"> wrapper).
Output: an SVG where elements are merged into N chunk <path>s per class,
ordered by a spatial sort key so a staggered dashoffset tween reads as a
continuous sweep.  width/height dropped (CSS sizes it), ids are stable.

usage: svgprep.py in.svg out.svg --id nes --chunks 48 [--hidden-chunks 24] [--no-hidden] [--sort x|diag|y]
"""
import argparse, math, re, sys
import xml.etree.ElementTree as ET

NS = "http://www.w3.org/2000/svg"
NUM = re.compile(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?")


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s if s else "0"


def polyline_to_d(points):
    nums = [float(x) for x in NUM.findall(points)]
    pts = list(zip(nums[0::2], nums[1::2]))
    if len(pts) < 2:
        return None, None
    d = "M" + fmt(pts[0][0]) + " " + fmt(pts[0][1]) + "".join(
        "L" + fmt(x) + " " + fmt(y) for x, y in pts[1:])
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    return d, (cx, cy)


def path_key(d):
    nums = [float(x) for x in NUM.findall(d)]
    if len(nums) < 2:
        return None
    xs, ys = nums[0::2], nums[1::2]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def ellipse_to_d(el):
    cx, cy = float(el.get("cx", 0)), float(el.get("cy", 0))
    rx, ry = float(el.get("rx", 0)), float(el.get("ry", 0))
    # two arcs
    d = (f"M{fmt(cx - rx)} {fmt(cy)}A{fmt(rx)} {fmt(ry)} 0 1 0 {fmt(cx + rx)} {fmt(cy)}"
         f"A{fmt(rx)} {fmt(ry)} 0 1 0 {fmt(cx - rx)} {fmt(cy)}")
    return d, (cx, cy)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--id", required=True)
    ap.add_argument("--chunks", type=int, default=48)
    ap.add_argument("--hidden-chunks", type=int, default=24)
    ap.add_argument("--no-hidden", action="store_true")
    ap.add_argument("--sort", default="diag", choices=["x", "y", "diag"])
    a = ap.parse_args()

    ET.register_namespace("", NS)
    tree = ET.parse(a.src)
    root = tree.getroot()
    vb = root.get("viewBox")
    g = root.find(f"{{{NS}}}g")
    transform = g.get("transform", "") if g is not None else ""

    items = {"visible": [], "hidden": []}
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        cls = el.get("class", "visible")
        if cls not in items:
            continue
        if tag == "polyline":
            d, key = polyline_to_d(el.get("points", ""))
        elif tag == "path":
            d = el.get("d", "").strip(); key = path_key(d)
        elif tag == "ellipse":
            d, key = ellipse_to_d(el)
        else:
            continue
        if not d or key is None:
            continue
        items[cls].append((key, d))

    def sortkey(k):
        x, y = k
        return {"x": x, "y": y, "diag": x + y * 0.6}[a.sort]

    out = [f'<svg xmlns="{NS}" viewBox="{vb}" class="dr" data-id="{a.id}">',
           f'<g transform="{transform}">']
    stats = {}
    for cls, n in (("visible", a.chunks), ("hidden", 0 if a.no_hidden else a.hidden_chunks)):
        lst = items[cls]
        if not lst or n <= 0:
            continue
        lst.sort(key=lambda t: sortkey(t[0]))
        per = math.ceil(len(lst) / n)
        short = "v" if cls == "visible" else "h"
        out.append(f'<g class="{short}">')
        count = 0
        for i in range(0, len(lst), per):
            d = "".join(t[1] for t in lst[i:i + per])
            out.append(f'<path id="{a.id}-{short}{count}" d="{d}"/>')
            count += 1
        out.append("</g>")
        stats[cls] = (len(lst), count)
    out.append("</g></svg>")
    with open(a.dst, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(a.dst, vb, stats, f"{sum(len(s) for s in out)//1024} KB")


if __name__ == "__main__":
    main()
