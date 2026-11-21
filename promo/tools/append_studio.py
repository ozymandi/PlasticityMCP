"""Append a studio (lights, backdrop, world, colour management) from another .blend into the scene, then save.

  blender -b <scene.blend> --python promo/tools/append_studio.py -- <studio.blend> [exclude1,exclude2,...] [dx,dy,dz]

dx,dy,dz (metres) moves every appended studio object, e.g. to lower the floor under parts that hang
below the model's zero (the CUBE boat's props and rudder) or to centre the cove on a long model.

Every object of the studio's scene is appended into a new collection "Studio", except the names
listed in the exclude argument (default: "REPLACE ME,Camera" — the BlenderKit studio's placeholder
sphere and its camera). The studio scene's world becomes the scene world, and its view transform,
look, exposure and gamma are copied. An existing "Studio" collection is removed first, so the
script can be run again after the studio file changes.
"""
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:]
STUDIO = argv[0]
EXCLUDE = set((argv[1] if len(argv) > 1 and argv[1] else "REPLACE ME,Camera").split(","))
OFFSET = [float(x) for x in argv[2].split(",")] if len(argv) > 2 else [0.0, 0.0, 0.0]
sc = bpy.context.scene

old = bpy.data.collections.get("Studio")
if old:
    for o in list(old.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(old)

with bpy.data.libraries.load(STUDIO, link=False) as (src, dst):
    dst.scenes = list(src.scenes)
# prefer the scene that holds a "Studio*" collection (a finished promo file may carry extra scenes)
studio_scene = next((s for s in dst.scenes
                     if any(c.name.startswith("Studio") for c in s.collection.children_recursive)), dst.scenes[0])
for s in dst.scenes:
    if s is not studio_scene:
        bpy.data.scenes.remove(s)

col = bpy.data.collections.new("Studio")
sc.collection.children.link(col)
# A source that already holds a collection named "Studio*" (e.g. a finished promo scene) gives only
# that collection's objects; a bare studio file gives every object of its scene.
src_cols = [c for c in studio_scene.collection.children_recursive if c.name.startswith("Studio")]
src_objs = list(src_cols[0].all_objects) if src_cols else list(studio_scene.objects)
for o in list(studio_scene.objects):
    if o not in src_objs:
        bpy.data.objects.remove(o, do_unlink=True)
for o in src_objs:
    if o.name in EXCLUDE:
        continue
    for c in list(o.users_collection):
        c.objects.unlink(o)
    col.objects.link(o)
    if o.parent is None:
        o.location = (o.location.x + OFFSET[0], o.location.y + OFFSET[1], o.location.z + OFFSET[2])
    print("STUDIO +", o.name, o.type, flush=True)

if studio_scene.world:
    sc.world = studio_scene.world
    print("STUDIO world", sc.world.name, flush=True)
v, sv = sc.view_settings, studio_scene.view_settings
v.view_transform, v.look, v.exposure, v.gamma = sv.view_transform, sv.look, sv.exposure, sv.gamma
sc.cycles.samples = studio_scene.cycles.samples
print("STUDIO view", v.view_transform, v.look, v.exposure, v.gamma, "samples", sc.cycles.samples, flush=True)

bpy.data.scenes.remove(studio_scene)
bpy.data.orphans_purge(do_recursive=True)
bpy.ops.wm.save_mainfile()
print("STUDIO saved", bpy.data.filepath, flush=True)
