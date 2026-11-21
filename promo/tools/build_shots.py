"""Build the animated shot cameras of a promo scene from a JSON config, bind them to markers, then save.

  blender -b <scene.blend> --python promo/tools/build_shots.py -- <shots.json>

shots.json:
  {"fps": 24, "start": 1, "shots": [
     {"name": "maserati_fly1", "seconds": 3.5, "lens": 50, "fstop": 2.8,
      "keys": [{"t": 0, "cam": [x, y, z], "aim": [x, y, z]}, {"t": 1, "cam": [...], "aim": [...]}]},
     {"name": "maserati_orbit", "seconds": 8, "lens": 35, "fstop": null,
      "orbit": {"center": [x, y, z], "radius": 5, "z": 2.6, "start_deg": -52, "turns": 1}}]}

Every shot gets a camera "<name>" and an aim empty "<name>_aim" (the camera tracks it; with fstop it
is also the focus object). Keys are placed at t × (frames − 1) from the shot's first frame with
eased Bezier interpolation; an orbit is linear and constant-speed (one key per 15°). Shots run back
to back from "start"; each gets a timeline marker bound to its camera. Near clip 1 mm. Objects and
markers of the same names from an earlier run are replaced; other cameras are left alone.
Prints SHOT <name> <first>-<last> per shot; scene frame_end becomes the last shot frame.
"""
import bpy, sys, json, math
from mathutils import Vector

cfg = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
sc = bpy.context.scene
sc.render.fps, sc.render.fps_base = cfg["fps"], 1.0

col = bpy.data.collections.get("Shots") or bpy.data.collections.new("Shots")
if col.name not in sc.collection.children:
    sc.collection.children.link(col)


def fresh(name, data):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    ob = bpy.data.objects.new(name, data)
    col.objects.link(ob)
    return ob


def fcurves(ob):
    """F-curves of the object's action (Blender 5 keeps them in a channelbag per action slot)."""
    from bpy_extras.anim_utils import action_get_channelbag_for_slot
    ad = ob.animation_data
    if not ad or not ad.action:
        return []
    cb = action_get_channelbag_for_slot(ad.action, ad.action_slot)
    return list(cb.fcurves) if cb else []


def ease(ob):
    for fc in fcurves(ob):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"


def linear(ob):
    for fc in fcurves(ob):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


frame = cfg.get("start", 1)
for shot in cfg["shots"]:
    name = shot["name"]
    n = int(round(shot["seconds"] * cfg["fps"]))
    first, last = frame, frame + n - 1
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = shot["lens"]
    cam_data.clip_start = 0.001
    cam_data.clip_end = 200
    cam = fresh(name, cam_data)
    aim = fresh(name + "_aim", None)
    aim.empty_display_size = 0.05
    con = cam.constraints.new("TRACK_TO")
    con.target, con.track_axis, con.up_axis = aim, "TRACK_NEGATIVE_Z", "UP_Y"
    if shot.get("fstop"):
        cam_data.dof.use_dof = True
        cam_data.dof.focus_object = aim
        cam_data.dof.aperture_fstop = shot["fstop"]

    if "orbit" in shot:
        o = shot["orbit"]
        c = Vector(o["center"])
        steps = max(2, int(360 * o.get("turns", 1) / 15) + 1)
        aim.location = c
        for i in range(steps):
            u = i / (steps - 1)
            a = math.radians(o["start_deg"] + 360 * o.get("turns", 1) * u)
            cam.location = (c.x + o["radius"] * math.cos(a), c.y + o["radius"] * math.sin(a), o["z"])
            cam.keyframe_insert("location", frame=first + u * (n - 1))
        linear(cam)
    else:
        for k in shot["keys"]:
            f = first + k["t"] * (n - 1)
            cam.location = k["cam"]; cam.keyframe_insert("location", frame=f)
            aim.location = k["aim"]; aim.keyframe_insert("location", frame=f)
        ease(cam); ease(aim)

    m = sc.timeline_markers.get(name)
    if m:
        sc.timeline_markers.remove(m)
    m = sc.timeline_markers.new(name, frame=first)
    m.camera = cam
    print(f"SHOT {name} {first}-{last} ({n} frames, lens {shot['lens']}, fstop {shot.get('fstop')})", flush=True)
    frame = last + 1

sc.frame_start = cfg.get("start", 1)
sc.frame_end = frame - 1
sc.camera = bpy.data.objects[cfg["shots"][0]["name"]]
bpy.ops.wm.save_mainfile()
print("SHOT saved", bpy.data.filepath, "frames", sc.frame_start, "-", sc.frame_end, "fps", sc.render.fps, flush=True)
