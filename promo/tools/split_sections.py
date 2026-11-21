"""Cut a rendered HyperFrames film into one clip per root scene, frame-exact, for After Effects.

  python promo/tools/split_sections.py <project_dir> <rendered.mp4> <out_dir> [crf=12]

Scene hosts are read from <project_dir>/index.html (data-composition-id, data-start, data-duration,
root data-fps). Each clip is re-encoded (H.264, yuv420p, given CRF) from its first to its last frame
with select=between(n, a, b), so a cut never lands between frames. Prints one line per clip with
the frame count read back by ffprobe.
"""
import re, subprocess, sys, pathlib

proj, src, out = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3])
crf = sys.argv[4] if len(sys.argv) > 4 else "12"
html = (proj / "index.html").read_text(encoding="utf-8")
fps = float(re.search(r'data-fps="([0-9.]+)"', html).group(1))
out.mkdir(parents=True, exist_ok=True)
for cid, start, dur in re.findall(r'data-composition-id="([^"]+)"[^>]*?data-start="([0-9.]+)" data-duration="([0-9.]+)"', html):
    a = round(float(start) * fps)
    n = round(float(dur) * fps)
    b = a + n - 1
    dst = out / f"{cid}.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", f"select=between(n\\,{a}\\,{b}),setpts=N/({fps}*TB)",
                    "-r", str(fps), "-an", "-c:v", "libx264", "-crf", crf, "-pix_fmt", "yuv420p", str(dst)], check=True)
    got = subprocess.run(["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
                          "stream=nb_read_frames,r_frame_rate", "-of", "csv=p=0", str(dst)], capture_output=True, text=True).stdout.strip()
    print(f"SPLIT {cid} frames {a}-{b} ({n}) -> {dst.name}  probe: {got}", flush=True)
