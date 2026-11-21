"""Workbench playblast of every shot (timeline marker with a camera) to mp4, without saving the scene.

  blender -b <scene.blend> --python promo/tools/playblast.py -- <out_dir> [percent=50] [MATERIAL|SOLID]

A shot runs from its marker to the frame before the next marker (the last one to frame_end).
Writes <out_dir>/<shot>.mp4 (H.264) and prints PLAYBLAST <shot> <first>-<last> <seconds>.
"""
import bpy, sys, os, time

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
PCT = int(argv[1]) if len(argv) > 1 else 50
COLOR = argv[2] if len(argv) > 2 else "MATERIAL"
sc = bpy.context.scene
os.makedirs(OUT, exist_ok=True)

sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light, sh.color_type = "STUDIO", COLOR
sh.show_specular_highlight = True
sc.render.resolution_percentage = PCT
im = sc.render.image_settings
if hasattr(im, "media_type"):
    im.media_type = "VIDEO"
im.file_format = "FFMPEG"
sc.render.ffmpeg.format = "MPEG4"
sc.render.ffmpeg.codec = "H264"
sc.render.ffmpeg.constant_rate_factor = "HIGH"

end = sc.frame_end
marks = sorted([m for m in sc.timeline_markers if m.camera], key=lambda m: m.frame)
ranges = [(m, m.frame, (marks[i + 1].frame - 1) if i + 1 < len(marks) else end) for i, m in enumerate(marks)]
for m, first, last in ranges:
    sc.frame_start, sc.frame_end = first, last
    sc.camera = m.camera
    sc.render.filepath = os.path.join(OUT, f"{m.name}.mp4")
    t = time.perf_counter()
    bpy.ops.render.render(animation=True)
    print(f"PLAYBLAST {m.name} {first}-{last} {time.perf_counter() - t:.1f}s -> {sc.render.filepath}", flush=True)
