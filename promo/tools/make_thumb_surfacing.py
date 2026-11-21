"""YouTube thumbnail for the surfacing promo: Maserati fly1 frame 40 + title in Adhesive Nr. Eight, tag in Owners.
   python promo/tools/make_thumb_surfacing.py  ->  promo/assets/img/youtube-thumb-surfacing.png (1280x720)
Owners comes from the Adobe Fonts cache (needs Creative Cloud fonts synced on this machine)."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "renders/surfacing/final/maserati_fly1/frame_0040.png")
OUT = os.path.join(ROOT, "assets/img/youtube-thumb-surfacing.png")
ADH = os.path.join(ROOT, "assets/fonts/AdhesiveNrEight.otf")
OWN_MED = os.path.expandvars(r"%APPDATA%/Adobe/CoreSync/plugins/livetype/r/48394")   # Owners-Medium
W, H = 1280, 720
WHITE, TAN, GREY = (255, 255, 255), (201, 165, 126), (200, 200, 200)

im = Image.open(SRC).convert("RGB").resize((W, H), Image.LANCZOS)
# bottom gradient for the type: transparent at 48 % height -> near black at the bottom
grad = Image.new("L", (1, H))
for y in range(H):
    t = max(0.0, (y / H - 0.48) / 0.52)
    grad.putpixel((0, y), int(235 * min(1.0, t * 1.25) ** 1.4))
dark = Image.new("RGB", (W, H), (10, 10, 10))
im = Image.composite(dark, im, grad.resize((W, H)))
d = ImageDraw.Draw(im)

def text_with_shadow(xy, s, font, fill, anchor="ls"):
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ds = ImageDraw.Draw(sh)
    ds.text((xy[0] + 3, xy[1] + 4), s, font=font, fill=(0, 0, 0, 200), anchor=anchor)
    im.paste(sh.filter(ImageFilter.GaussianBlur(6)), (0, 0), sh.filter(ImageFilter.GaussianBlur(6)))
    d.text(xy, s, font=font, fill=fill, anchor=anchor)

X = 56
big = ImageFont.truetype(ADH, 118)
mid = ImageFont.truetype(ADH, 64)
tag = ImageFont.truetype(OWN_MED, 26)
# "PlasticityMCP" with MCP in tan, like the logo
text_with_shadow((X, 560), "Plasticity", mid, WHITE)
w = d.textlength("Plasticity", font=mid)
text_with_shadow((X + w, 560), "MCP", mid, TAN)
text_with_shadow((X, 672), "FREE-FORM SURFACING", big, WHITE)
# tag pill, top-left
s = "145 MCP TOOLS · PLASTICITY"
tw = d.textlength(s, font=tag)
d.rounded_rectangle((X - 2, 40, X + tw + 34, 86), radius=8, fill=(14, 14, 14), outline=(90, 90, 90), width=2)
d.text((X + 16, 63), s, font=tag, fill=GREY, anchor="lm")
im.save(OUT, optimize=True)
print(OUT, os.path.getsize(OUT))
