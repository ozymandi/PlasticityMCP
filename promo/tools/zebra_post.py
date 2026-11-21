"""Grey the zebra frames from render_zebra.py and lay them on the #161616 background, in place.

  python promo/tools/zebra_post.py <folder with RGBA frame_*.png> [gain=1.0]

The preset matcap is blue-violet. Each frame: luminance of the model, stretched so the brightest stripe of the
FIRST frame reaches 235 (one factor for the whole clip, so it does not flicker), then composited by its alpha on
a flat (22, 22, 22) background; written back as RGB PNG.
"""
import sys, glob, os
from PIL import Image, ImageChops
d = sys.argv[1]; gain = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0
files = sorted(glob.glob(os.path.join(d, "*.png")))
first = Image.open(files[0])
if first.mode != "RGBA":
    sys.exit("frames are not RGBA (already processed?)")
L0 = first.convert("RGB").convert("L"); a0 = first.getchannel("A")
hi = max(v for v, m in zip(L0.getdata(), a0.getdata()) if m > 250) or 1
k = 235.0 / hi * gain
for f in files:
    im = Image.open(f)
    if im.mode != "RGBA":
        continue
    L = im.convert("RGB").convert("L").point(lambda v: min(255, int(v * k + 0.5)))
    bg = Image.new("L", im.size, 22)
    out = Image.composite(L, bg, im.getchannel("A")).convert("RGB")
    out.save(f)
print(f"ZEBRAPOST {d}: {len(files)} frames, stripe max {hi} -> x{k:.2f}")
