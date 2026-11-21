"""Render one still from a camera placed by coordinates, with the scene's own light and settings.

  blender -b <scene.blend> --python promo/tools/render_view.py -- <out.png> cx,cy,cz ax,ay,az [lens=50] [fstop]

A temporary camera at c looks at a (metres); with fstop it focuses on a. GPU (OptiX). Not saved.
Prints VIEW <out> <seconds>.
"""
import bpy, sys, time
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
out, c, aim = a[0], Vector(map(float, a[1].split(","))), Vector(map(float, a[2].split(",")))
lens = float(a[3]) if len(a) > 3 else 50
fstop = float(a[4]) if len(a) > 4 else None
sc = bpy.context.scene
cam = bpy.data.objects.new("view_cam", bpy.data.cameras.new("view_cam"))
sc.collection.objects.link(cam)
cam.location = c
cam.rotation_euler = (aim - c).to_track_quat("-Z", "Y").to_euler()
cam.data.lens, cam.data.clip_start = lens, 0.001
if fstop:
    cam.data.dof.use_dof, cam.data.dof.focus_distance, cam.data.dof.aperture_fstop = True, (aim - c).length, fstop
sc.camera = cam
prefs = bpy.context.preferences.addons["cycles"].preferences
prefs.compute_device_type = "OPTIX"; prefs.get_devices()
for d in prefs.devices:
    d.use = d.type == "OPTIX"
sc.cycles.device = "GPU"
sc.render.filepath = out
t = time.perf_counter()
bpy.ops.render.render(write_still=True)
print(f"VIEW {out} {time.perf_counter() - t:.1f}s", flush=True)
