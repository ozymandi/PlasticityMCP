"""ZX Spectrum 128 boot / BASIC / tape-load intro, rendered pixel-style into the main cut's video window.

The "screen" is a 320x180 Spectrum-like raster (40 columns, 8x8 cells, 15-colour palette) scaled nearest into the
1766x994 window at (77, 43) with 7 px rounded corners — exactly where the main cut's video sits (92 % of the frame),
so the cut from the loaded SCREEN$ to the video is seamless. The border around it runs the ROM-loader simulation.

Timeline (s):  0.0 power-on black  0.3 128K menu  1.4 ENTER on "128 BASIC"  1.6-4.4 type 10 PRINT "hello speccy"
               4.5 ENTER  4.8-5.3 type RUN  5.4 ENTER -> hello speccy + report  5.9-6.9 type LOAD ""  7.0 ENTER -> tape
               7.0 pilot  8.4 header -> Program: toastrack  9.0 pilot  9.7-12.0 SCREEN$ loads (bitmap, then attributes)
The tape signal is the same ROM-loader simulation as pilot_tone.py; the main cut's border continues it from t = 12 s
(`--border out.mp4` renders sim time 12..44 s as the full-frame border video).

usage: python speccy_intro.py intro.mp4 [--border border.mp4] [--screen frame.png]
"""
import sys, subprocess, numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1]
BORDER_OUT = sys.argv[sys.argv.index("--border") + 1] if "--border" in sys.argv else None
SCREEN_SRC = sys.argv[sys.argv.index("--screen") + 1] if "--screen" in sys.argv else r"E:\Projects\PlasticityMCP\promo\renders\spectrum\iso\frame_0960.png"
FONT = r"E:\Projects\PlasticityMCP\promo\assets\fonts\zx_spectrum-7.ttf"
FPS, INTRO_S, MAIN_S = 30, 12.0, 32.0
W, H = 1920, 1080
SW, SH, COLS, ROWS = 320, 180, 40, 22                 # Spectrum-like raster, 8x8 cells (row 22 is a half row)
WIN = (77, 43, 1766, 994)                             # x, y, w, h of the video window in the main cut (92 %)
WIN_RADIUS = 7
CLOCK, FRAME_T, LINES, LINE_T = 3_500_000, 69888, 312, 224

PAL = {0: (0, 0, 0), 1: (0, 0, 0xD8), 2: (0xD8, 0, 0), 3: (0xD8, 0, 0xD8), 4: (0, 0xD8, 0), 5: (0, 0xD8, 0xD8), 6: (0xD8, 0xD8, 0), 7: (0xD8, 0xD8, 0xD8),
       9: (0, 0, 0xFF), 10: (0xFF, 0, 0), 11: (0xFF, 0, 0xFF), 12: (0, 0xFF, 0), 13: (0, 0xFF, 0xFF), 14: (0xFF, 0xFF, 0), 15: (0xFF, 0xFF, 0xFF)}
BLACK, BLUE, RED, CYAN, YELLOW, WHITE = PAL[0], PAL[1], PAL[2], PAL[5], PAL[6], PAL[7]
PALETTE = np.array(list(PAL.values()), dtype=np.float32)

font = ImageFont.truetype(FONT, 20)                   # 8 px cell at size 20 (two grey levels)
GLYPH_Y = -7

# ---------------------------------------------------------------- tape simulation (shared with the main border)
rng = np.random.default_rng(128)
pulses, kinds = [], []
def add(length, kind, n=1): pulses.extend([length] * n); kinds.extend([kind] * n)
def block(pilot_pulses, data):
    add(2168, 0, pilot_pulses); add(667, 0); add(735, 1)
    for byte in data:
        for bit in range(7, -1, -1): add(1710 if (byte >> bit) & 1 else 855, 1, 2)
TAPE_START = 7.0
add(int(TAPE_START * CLOCK), 2)
header = bytes([0x00, 0x03]) + b"toastrack " + bytes([0x00, 0x1B, 0x00, 0x40, 0x00, 0x00, 0x00])
block(2260, header + bytes([np.bitwise_xor.reduce(np.frombuffer(header, np.uint8))]))
add(int(0.5 * CLOCK), 2)
data = rng.integers(0, 256, size=int((INTRO_S + MAIN_S + 2) * CLOCK / 1300 / 8) + 64, dtype=np.uint8)
block(1130, bytes([0xFF]) + data.tobytes())
edges = np.cumsum(np.array(pulses, dtype=np.int64)); kinds = np.array(kinds, dtype=np.int8)
PAIRS = np.array([[RED, CYAN], [BLUE, YELLOW], [WHITE, WHITE]], dtype=np.uint8)
phase_change = [(edges[i] / CLOCK, int(kinds[i + 1])) for i in np.where(np.diff(kinds) != 0)[0]]
T_HEADER_DONE = [t for t, k in phase_change if k == 2][0]
T_DATA = [t for t, k in phase_change if k == 1][-1]
print("tape phases:", [(round(t, 2), k) for t, k in phase_change])

ys_full = (np.arange(H) * LINES // H).astype(np.int64) * LINE_T
xs_full = (np.arange(W) * LINE_T // W).astype(np.int64)
grid_full = ys_full[:, None] + xs_full[None, :]
def border_frame(t):
    t0 = (int(t * CLOCK) // FRAME_T) * FRAME_T
    idx = np.minimum(np.searchsorted(edges, grid_full + t0, side="right"), len(edges) - 1)
    return PAIRS[kinds[idx], idx & 1]

# ---------------------------------------------------------------- SCREEN$ of the title frame (320x180, 2 colours per cell)
def make_screen(path):
    im = Image.open(path).convert("RGB").resize((SW, SH), Image.LANCZOS)
    px = np.asarray(im).astype(np.float32)
    px = (np.clip((px / 255.0) ** 0.75 * 1.2, 0, 1) * 255).astype(np.float32)   # gentle lift: floor stays black paper
    d = ((px[:, :, None, :] - PALETTE[None, None, :, :]) ** 2).sum(-1); q = d.argmin(-1)
    nrows = (SH + 7) // 8
    bits = np.zeros((SH, SW), np.uint8); ink = np.zeros((nrows, COLS), np.int64); paper = np.zeros((nrows, COLS), np.int64)
    bayer = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], np.float32) / 16.0
    for r in range(nrows):
        for c in range(COLS):
            y0, y1 = r * 8, min((r + 1) * 8, SH)
            cell = q[y0:y1, c * 8:(c + 1) * 8]
            vals, counts = np.unique(cell, return_counts=True); order = np.argsort(-counts)
            p_i = vals[order[0]]; i_i = vals[order[1]] if len(vals) > 1 else p_i
            paper[r, c], ink[r, c] = p_i, i_i
            P, I = PALETTE[p_i], PALETTE[i_i]; v = I - P; n = (v * v).sum()
            blockpx = px[y0:y1, c * 8:(c + 1) * 8]
            tt = ((blockpx - P) * v).sum(-1) / n if n > 0 else np.zeros(blockpx.shape[:2])
            bits[y0:y1, c * 8:(c + 1) * 8] = (tt > np.tile(bayer, (2, 2))[:y1 - y0]).astype(np.uint8)
    return bits, ink, paper, nrows
BITS, INK, PAPER, NROWS = make_screen(SCREEN_SRC)
# display-file order generalised to this raster: thirds of 8 character rows, line-in-row outer, row, column
order = []
for third in range(3):
    for l in range(8):
        for r in range(third * 8, min(third * 8 + 8, NROWS)):
            y = r * 8 + l
            if y < SH:
                for c in range(COLS): order.append((y, c))
DF_Y = np.array([o[0] for o in order]); DF_C = np.array([o[1] for o in order]); NBYTES = len(order); NATTR = NROWS * COLS
def screen_loading(p):
    split = NBYTES / (NBYTES + NATTR)
    nb = int(min(p / split, 1.0) * NBYTES); na = int(max(0.0, (p - split) / (1 - split)) * NATTR)
    loaded = np.zeros((SH, COLS), bool); loaded[DF_Y[:nb], DF_C[:nb]] = True
    attr_loaded = np.zeros((NROWS, COLS), bool); attr_loaded.flat[:na] = True
    ink_px = np.where(attr_loaded, INK, 0); paper_px = np.where(attr_loaded, PAPER, 7)
    ink_rgb = PALETTE[np.repeat(np.repeat(ink_px, 8, 0), 8, 1)[:SH]].astype(np.uint8)
    paper_rgb = PALETTE[np.repeat(np.repeat(paper_px, 8, 0), 8, 1)[:SH]].astype(np.uint8)
    loaded_px = np.repeat(loaded, 8, 1)
    return loaded_px, np.where(BITS[..., None] == 1, ink_rgb, paper_rgb)

# ---------------------------------------------------------------- Spectrum text screen
class Screen:
    def __init__(self):
        self.im = Image.new("RGB", (SW, SH), WHITE); self.d = ImageDraw.Draw(self.im)
    def cls(self, paper=WHITE): self.d.rectangle([0, 0, SW - 1, SH - 1], fill=paper)
    def text(self, col, row, s, ink=BLACK, paper=WHITE):
        if not s: return
        self.d.rectangle([col * 8, row * 8, col * 8 + len(s) * 8 - 1, row * 8 + 7], fill=paper)
        mask = Image.new("L", (len(s) * 8 + 8, 24), 0); ImageDraw.Draw(mask).text((0, 8 + GLYPH_Y), s, font=font, fill=255)
        mask = mask.crop((0, 8, len(s) * 8, 16)).point(lambda v: 255 if v > 127 else 0)
        self.im.paste(Image.new("RGB", mask.size, ink), (col * 8, row * 8), mask)
    def cursor(self, col, row, on): self.d.rectangle([col * 8, row * 8, col * 8 + 7, row * 8 + 7], fill=BLACK if on else WHITE)

MENU = ["Tape Loader", "128 BASIC", "Calculator", "48 BASIC", "Tape Tester"]
def draw_menu(scr, selected):
    scr.cls(WHITE)
    x0, y0 = (COLS - 14) // 2, 5
    scr.d.rectangle([x0 * 8 - 1, y0 * 8 - 1, (x0 + 14) * 8, (y0 + 7) * 8], outline=BLACK)
    for i, col in enumerate([RED, YELLOW, PAL[4], CYAN]):
        scr.d.rectangle([(x0 + 10 + i) * 8, y0 * 8, (x0 + 11 + i) * 8 - 1, y0 * 8 + 7], fill=col)
    scr.text(x0, y0, " 128 ", BLACK, WHITE)
    for i, item in enumerate(MENU):
        sel = i == selected
        scr.text(x0, y0 + 2 + i, item.ljust(14), WHITE if sel else BLACK, BLUE if sel else WHITE)
    scr.text(2, ROWS - 2, "\u00a9 1986 Sinclair Research Ltd", BLACK, WHITE)

def key_times(start, n, rate=8.0, seed=1):
    r = np.random.default_rng(seed); t = start; out = []
    for _ in range(n):
        t += (1.0 / rate) * r.uniform(0.6, 1.6); out.append(t)
    return out
LINE1 = '10 PRINT "hello speccy"'; T1 = key_times(1.6, len(LINE1), seed=1)
RUNS = "RUN"; T2 = key_times(4.8, len(RUNS), rate=7, seed=2)
LOADS = 'LOAD ""'; T3 = key_times(5.9, len(LOADS), rate=7, seed=3)
T_ENTER1, T_ENTER2, T_REPORT, T_ENTER3 = 4.5, 5.4, 5.7, TAPE_START
REPORT_ROW = ROWS - 1

def typed(line, times, t): return line[:sum(1 for x in times if x <= t)]
def flash(t): return int(t * 50) % 32 < 16

def render_screen(t):
    scr = Screen()
    if t < 0.3: scr.cls(BLACK); return scr.im, BLACK
    if t < 1.5: draw_menu(scr, 0 if t < 1.1 else 1); return scr.im, WHITE
    scr.cls(WHITE)
    if t < T_ENTER1:
        s = typed(LINE1, T1, t); scr.text(0, 0, s); scr.cursor(len(s), 0, flash(t)); return scr.im, WHITE
    if t < T_ENTER2:
        scr.text(0, 0, LINE1); s = typed(RUNS, T2, t); scr.text(0, 1, s); scr.cursor(len(s), 1, flash(t)); return scr.im, WHITE
    if t < 5.9:
        scr.text(0, 0, "hello speccy")
        if t >= T_REPORT: scr.text(0, REPORT_ROW, "0 OK, 10:1")
        return scr.im, WHITE
    if t < T_ENTER3:
        scr.text(0, 0, LINE1); s = typed(LOADS, T3, t); scr.text(0, 1, s); scr.cursor(len(s), 1, flash(t)); return scr.im, WHITE
    scr.cls(WHITE)
    if t >= T_HEADER_DONE: scr.text(0, 0, "Program: toastrack")
    if t >= T_DATA:
        p = min(1.0, (t - T_DATA) / (INTRO_S - T_DATA - 0.15))
        loaded, pic = screen_loading(p)
        arr = np.asarray(scr.im).copy(); arr[loaded] = pic[loaded]; return Image.fromarray(arr), None
    return scr.im, None

# window mask with rounded corners (same as the AE mask on the video window)
wx, wy, ww, wh = WIN
win_mask = Image.new("L", (ww, wh), 0); ImageDraw.Draw(win_mask).rounded_rectangle([0, 0, ww - 1, wh - 1], radius=WIN_RADIUS, fill=255)
WIN_MASK = np.asarray(win_mask) > 127

def encode(path, frames):
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                           "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path],
                          stdin=subprocess.PIPE)
    for f in frames: ff.stdin.write(np.ascontiguousarray(f).tobytes())
    ff.stdin.close(); ff.wait()

def intro_frames():
    for n in range(int(INTRO_S * FPS)):
        t = n / FPS
        screen, border = render_screen(t)
        frame = np.empty((H, W, 3), np.uint8)
        if border is not None: frame[:] = border
        else: frame[:] = border_frame(t)
        big = np.asarray(screen.resize((ww, wh), Image.NEAREST))
        sub = frame[wy:wy + wh, wx:wx + ww]; sub[WIN_MASK] = big[WIN_MASK]
        if n % 60 == 0: print(f"intro frame {n}", flush=True)
        yield frame
encode(OUT, intro_frames()); print("intro done", OUT)

if BORDER_OUT:
    def border_frames():
        for n in range(int(MAIN_S * FPS)):
            yield border_frame(INTRO_S + n / FPS)
    encode(BORDER_OUT, border_frames()); print("border done", BORDER_OUT)
