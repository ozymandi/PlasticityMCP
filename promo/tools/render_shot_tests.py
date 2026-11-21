"""Render the middle frame of every shot (timeline marker with a camera) with the scene's settings.

  blender -b <scene.blend> --python promo/tools/render_shot_tests.py -- <out_dir>

GPU (OptiX). Writes <out_dir>/<shot>_f<frame>.png and prints SHOTTEST <shot> <frame> <seconds>.
The .blend is not saved.
"""
import bpy, sys, os, time

OUT = sys.argv[sys.argv.index("--") + 1]
sc = bpy.context.scene
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"; prefs.get_devices()
for d in prefs.devices:
    d.use = d.type == "OPTIX"
sc.cycles.device = "GPU"

end = sc.frame_end
marks = sorted([m for m in sc.timeline_markers if m.camera], key=lambda m: m.frame)
for i, m in enumerate(marks):
    last = marks[i + 1].frame - 1 if i + 1 < len(marks) else end
    f = (m.frame + last) // 2
    sc.frame_set(f)
    sc.camera = m.camera
    sc.render.filepath = os.path.join(OUT, f"{m.name}_f{f:04d}.png")
    t = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    print(f"SHOTTEST {m.name} {f} {time.perf_counter() - t:.1f}s", flush=True)
