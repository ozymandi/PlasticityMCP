"""Generate <audio> clips for bed + SFX and inject into src/<fmt>/index.html between AUDIO markers."""
import pathlib, sys
FMT = sys.argv[1]
ROOT = pathlib.Path(__file__).resolve().parent.parent
p = ROOT / "src" / FMT / "index.html"
s = p.read_text(encoding="utf-8")

def clips():
    out = []
    DUR = {"sfx/chime.mp3": 2.5, "sfx/click-soft.mp3": 0.37, "sfx/impact-bass-1.mp3": 2.12, "sfx/key-press.mp3": 0.4, "sfx/whoosh-short.mp3": 0.58}
    busy = {9: [], 10: [], 11: [], 12: []}   # per-track (start,end) windows: pick the first free track
    def a(i, src, t, vol, dur=None, extra=""):
        d = dur or DUR[src]
        for tr in busy:
            if all(t >= e or t + d <= s0 for s0, e in busy[tr]):
                busy[tr].append((t, t + d)); break
        else:
            tr = 12
        out.append(f'      <audio id="sfx-{i}" src="assets/audio/{src}" data-start="{t:.2f}" data-duration="{d}" data-track-index="{tr}" data-volume="{vol}"{extra}></audio>')
    n = [0]
    def nxt(): n[0] += 1; return n[0]
    if FMT == "16x9":
        total = 68.3
        out.append(f'      <audio id="bed" src="assets/audio/bed-16x9.mp3" data-start="0" data-duration="{total}" data-track-index="8" data-volume="0.55"></audio>')
        # s1 typing 0.5 .. ~2.5 : key presses every 0.5s (sparse, under the typewriter)
        for k in range(5): a(nxt(), "sfx/key-press.mp3", 0.5 + k * 0.42, 0.25)
        a(nxt(), "sfx/click-soft.mp3", 4.5 - 1.0 + 0.5 * 0 + 2.75, 0.5)   # "connected" tick at ~3.25
        # scene cuts (whoosh-short)
        for t in (4.5, 20.5, 32.5, 50.8, 58.3, 64.3): a(nxt(), "sfx/whoosh-short.mp3", t - 0.15, 0.45)
        # s2 log lines: 12 lines from 4.5+0.8 every 0.55
        for k in range(12): a(nxt(), "sfx/click-soft.mp3", 4.5 + 0.8 + k * 0.55, 0.35)
        a(nxt(), "sfx/chime.mp3", 4.5 + 7.5, 0.5)         # strokes flash → render
        a(nxt(), "sfx/click-soft.mp3", 4.5 + 9.7, 0.4)    # steel beat
        for t in (12.0, 13.4, 14.7): a(nxt(), "sfx/click-soft.mp3", 4.5 + t, 0.45)  # detail cuts
        # s4 log lines: 14 from 20.5+0.8 every 0.72
        for k in range(14): a(nxt(), "sfx/click-soft.mp3", 20.5 + 0.8 + k * 0.72, 0.3)
        # s5 gallery: 3 slots of 6.1 → chime at render, click at steel
        for i in range(3):
            at = 32.5 + i * 6.1
            if i: a(nxt(), "sfx/whoosh-short.mp3", at - 0.1, 0.35)
            a(nxt(), "sfx/chime.mp3", at + 2.4, 0.45)
            a(nxt(), "sfx/click-soft.mp3", at + 4.2, 0.4)
        # s7 stats
        a(nxt(), "sfx/impact-bass-1.mp3", 58.3 + 0.2, 0.9)
        for k in range(4): a(nxt(), "sfx/click-soft.mp3", 58.3 + 2.2 + k * 0.16, 0.4)
        # s8 outro
        a(nxt(), "sfx/impact-bass-1.mp3", 64.3 + 0.6, 0.7)
    else:
        total = 34.5
        out.append(f'      <audio id="bed" src="assets/audio/bed-shorts.mp3" data-start="0" data-duration="{total}" data-track-index="8" data-volume="0.55"></audio>')
        for k in range(4): a(nxt(), "sfx/click-soft.mp3", 0.15 + k * 0.13, 0.4)  # hook words
        for t in (2.2, 14.7, 21.7, 31.75): a(nxt(), "sfx/whoosh-short.mp3", t - 0.15, 0.45)
        for k in range(8): a(nxt(), "sfx/click-soft.mp3", 2.2 + 0.6 + k * 0.5, 0.35)   # v2 log
        a(nxt(), "sfx/chime.mp3", 2.2 + 5.2, 0.5)
        a(nxt(), "sfx/click-soft.mp3", 2.2 + 7.6, 0.4)
        for t in (9.5, 11.0): a(nxt(), "sfx/click-soft.mp3", 2.2 + t, 0.45)
        for k in range(6): a(nxt(), "sfx/click-soft.mp3", 14.7 + 0.8 + k * 0.7, 0.3)   # v4 log
        for i in range(3):
            at = 21.7 + i * 3.35
            if i: a(nxt(), "sfx/whoosh-short.mp3", at - 0.1, 0.35)
            a(nxt(), "sfx/chime.mp3", at + 1.3, 0.45)
            a(nxt(), "sfx/click-soft.mp3", at + 2.3, 0.4)
        a(nxt(), "sfx/impact-bass-1.mp3", 31.75 + 0.15, 0.9)
    return "\n".join(out)

block = "      <!-- AUDIO:start -->\n" + clips() + "\n      <!-- AUDIO:end -->\n"
if "<!-- AUDIO:start -->" in s:
    i = s.index("      <!-- AUDIO:start -->"); j = s.index("<!-- AUDIO:end -->\n") + len("<!-- AUDIO:end -->\n")
    s = s[:i] + block + s[j:]
else:
    s = s.replace("    </div>\n    <script>", block + "    </div>\n    <script>", 1)
p.write_text(s, encoding="utf-8")
print(FMT, "audio clips:", block.count("<audio"))
