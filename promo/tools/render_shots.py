"""Final render of every shot (timeline marker with a camera) to PNG sequences, resumable.

  blender -b <scene.blend> --python promo/tools/render_shots.py -- <out_root> [shot1,shot2,...]

Each shot renders its own frame range (marker to the frame before the next marker, the last one to
frame_end) into <out_root>/<shot>/frame_####.png with the scene's own settings, on the GPU (OptiX).
Existing frames are skipped and a placeholder is written before a frame starts, so a crashed or
stopped run picks up where it left off when started again (same idea as the Spectrum render).
Prints SHOT <name> <first>-<last> start / done with the time spent.
"""
import bpy, sys, os, time

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
only = set(argv[1].split(",")) if len(argv) > 1 and argv[1] else None
sc = bpy.context.scene
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"; prefs.get_devices()
for d in prefs.devices:
    d.use = d.type == "OPTIX"
sc.cycles.device = "GPU"
r = sc.render
r.use_overwrite = False
r.use_placeholder = True
im = r.image_settings
if hasattr(im, "media_type"):
    im.media_type = "IMAGE"
im.file_format, im.color_mode, im.color_depth, im.compression = "PNG", "RGB", "8", 15

end = sc.frame_end
marks = sorted([m for m in sc.timeline_markers if m.camera], key=lambda m: m.frame)
ranges = [(m, m.frame, (marks[i + 1].frame - 1) if i + 1 < len(marks) else end) for i, m in enumerate(marks)]
for m, first, last in ranges:
    if only and m.name not in only:
        continue
    d = os.path.join(OUT, m.name)
    os.makedirs(d, exist_ok=True)
    sc.camera = m.camera
    sc.frame_start, sc.frame_end = first, last
    r.filepath = os.path.join(d, "frame_####")
    t = time.perf_counter()
    print(f"SHOT {m.name} {first}-{last} start {time.strftime('%H:%M:%S')}", flush=True)
    bpy.ops.render.render(animation=True)
    print(f"SHOT {m.name} {first}-{last} done in {(time.perf_counter() - t) / 60:.1f} min", flush=True)
