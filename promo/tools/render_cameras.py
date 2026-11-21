"""Render one still per camera of the scene with the scene's own settings, on the GPU (OptiX).

  blender -b <scene.blend> --python promo/tools/render_cameras.py -- <out_dir> [camera1,camera2,...] [frame]

Without a camera list every camera object is rendered. Prints RENDER <camera> <seconds> per image;
writes <out_dir>/<blend name>_<camera>.png. The .blend is not saved.
"""
import bpy, sys, os, time

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
names = argv[1].split(",") if len(argv) > 1 and argv[1] else None
frame = int(argv[2]) if len(argv) > 2 else None
sc = bpy.context.scene
if frame is not None:
    sc.frame_set(frame)

prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"
prefs.get_devices()
for d in prefs.devices:
    d.use = d.type == "OPTIX"
sc.cycles.device = "GPU"

base = os.path.splitext(os.path.basename(bpy.data.filepath))[0]
cams = [o for o in sc.objects if o.type == "CAMERA" and (names is None or o.name in names)]
for cam in cams:
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, f"{base}_{cam.name}.png")
    t = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    print(f"RENDER {cam.name} {time.perf_counter() - t:.1f}s samples {sc.cycles.samples} -> {sc.render.filepath}", flush=True)
