"""ZX Spectrum tape-loader border, simulated from the ROM loader timing (LD-BYTES).

The ULA border colour is toggled by the loader on every edge of the tape signal:
  pilot tone   : pulses of 2168 T-states, border red <-> cyan   (header pilot 8063 pulses, data pilot 3223)
  sync         : 667 T + 735 T
  data bits    : bit 0 = two 855 T pulses, bit 1 = two 1710 T pulses, border blue <-> yellow
  between blocks: ~1 s pause, border back to the system colour (white)
One ULA frame is 69888 T (312 lines x 224 T) at 3.5 MHz = 50 Hz. A pixel at (x, y) of the output shows the
border colour at T = frame_start + line(y) * 224 + x_T(x), so colour changes land mid-line as on real hardware.

usage: python pilot_tone.py out.mp4 [seconds] [fps]
"""
import sys, subprocess, numpy as np

OUT = sys.argv[1] if len(sys.argv) > 1 else "zx-loader-border.mp4"
SECONDS = float(sys.argv[2]) if len(sys.argv) > 2 else 32.0
FPS = int(sys.argv[3]) if len(sys.argv) > 3 else 30
W, H = 1920, 1080
CLOCK = 3_500_000
FRAME_T, LINES, LINE_T = 69888, 312, 224

PAL = {"blue": (0, 0, 0xD8), "red": (0xD8, 0, 0), "cyan": (0, 0xD8, 0xD8), "yellow": (0xD8, 0xD8, 0), "white": (0xD8, 0xD8, 0xD8)}
PAIRS = np.array([[PAL["red"], PAL["cyan"]], [PAL["blue"], PAL["yellow"]], [PAL["white"], PAL["white"]]], dtype=np.uint8)

rng = np.random.default_rng(1982)
pulses, kinds = [], []          # pulse lengths in T, kind of the interval that FOLLOWS each edge
def add(length, kind, n=1):
    pulses.extend([length] * n); kinds.extend([kind] * n)
def block(pilot_pulses, data):
    add(2168, 0, pilot_pulses)
    add(667, 0); add(735, 1)
    for byte in data:
        for bit in range(7, -1, -1):
            add(1710 if (byte >> bit) & 1 else 855, 1, 2)
def pause(seconds):
    add(int(seconds * CLOCK), 2)

header = bytes([0x00, 0x03]) + b"spectrum  " + bytes([0x00, 0x1B, 0x00, 0x80, 0x00, 0x00, 0x00])
block(8063, header + bytes([np.bitwise_xor.reduce(np.frombuffer(header, np.uint8))]))
pause(1.0)
need_T = SECONDS * CLOCK * 1.05
data = rng.integers(0, 256, size=int(need_T / 1300 / 8) + 64, dtype=np.uint8)   # random program bytes
block(3223, bytes([0xFF]) + data.tobytes())
edges = np.cumsum(np.array(pulses, dtype=np.int64))
kinds = np.array(kinds, dtype=np.int8)

ys = (np.arange(H) * LINES // H).astype(np.int64) * LINE_T          # T offset of each output row
xs = (np.arange(W) * LINE_T // W).astype(np.int64)                   # T offset along the line
grid = ys[:, None] + xs[None, :]

ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                       "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "12", "-pix_fmt", "yuv420p",
                       "-movflags", "+faststart", OUT], stdin=subprocess.PIPE)
n_frames = int(SECONDS * FPS)
for n in range(n_frames):
    t0 = (int(n / FPS * CLOCK) // FRAME_T) * FRAME_T               # start of the ULA frame being displayed
    T = grid + t0
    idx = np.searchsorted(edges, T, side="right")                   # edges seen so far -> parity picks the colour
    idx = np.minimum(idx, len(edges) - 1)
    kind = kinds[idx]
    frame = PAIRS[kind, idx & 1]
    ff.stdin.write(np.ascontiguousarray(frame).tobytes())
    if n % 120 == 0:
        print(f"frame {n}/{n_frames}", flush=True)
ff.stdin.close(); ff.wait()
print("done", OUT, "edges:", len(edges), "tape length s:", edges[-1] / CLOCK)
