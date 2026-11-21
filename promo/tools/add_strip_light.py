"""Add a rectangular area light (a light strip) that is on only during one shot, then save.

  blender -b <scene.blend> --python promo/tools/add_strip_light.py -- <name> <shot> x,y,z ax,ay,az length width watts

The strip sits at x,y,z, faces the aim point ax,ay,az, is <length> m along X and <width> m across,
and is invisible to the camera (it shows only through reflections and the light it gives). Its
power is keyed constant: <watts> from the shot's marker to the frame before the next marker, 0
elsewhere, so other shots keep their look. An object of the same name is replaced.
"""
import bpy, sys
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
name, shot = a[0], a[1]
loc, aim = Vector(map(float, a[2].split(","))), Vector(map(float, a[3].split(",")))
length, width, watts = float(a[4]), float(a[5]), float(a[6])
sc = bpy.context.scene

old = bpy.data.objects.get(name)
if old:
    bpy.data.objects.remove(old, do_unlink=True)
L = bpy.data.lights.new(name, "AREA")
L.shape, L.size, L.size_y = "RECTANGLE", length, width
ob = bpy.data.objects.new(name, L)
col = bpy.data.collections.get("Studio") or bpy.data.collections.get("Studio.001") or sc.collection
col.objects.link(ob)
ob.location = loc
ob.rotation_euler = (aim - loc).to_track_quat("-Z", "Y").to_euler()
ob.visible_camera = False

marks = sorted([m for m in sc.timeline_markers if m.camera], key=lambda m: m.frame)
i = next(k for k, m in enumerate(marks) if m.name == shot)
first = marks[i].frame
last = marks[i + 1].frame - 1 if i + 1 < len(marks) else sc.frame_end
for f, e in ((sc.frame_start, 0.0), (first, watts), (last + 1, 0.0)):
    L.energy = e
    L.keyframe_insert("energy", frame=f)
from bpy_extras.anim_utils import action_get_channelbag_for_slot
ad = L.animation_data
for fc in action_get_channelbag_for_slot(ad.action, ad.action_slot).fcurves:
    for kp in fc.keyframe_points:
        kp.interpolation = "CONSTANT"
print(f"STRIP {name} on {first}-{last} at {watts} W, {length} x {width} m, loc {tuple(loc)} -> {tuple(aim)}", flush=True)
bpy.ops.wm.save_mainfile()
print("STRIP saved", bpy.data.filepath, flush=True)
