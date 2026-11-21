"""Paint Plasticity faces of a bridged body with extra material slots, then save.

  blender -b <scene.blend> --python promo/tools/livery.py -- <livery.json>

livery.json:
  {"object": "hull",
   "slots": ["Hull_main", "Livery_yellow", "Livery_orange"],
   "faces": {"1": [78679, 85650], "2": [83658, 85651]}}

Slot 0 keeps everything not listed. Materials named in "slots" are created as plain placeholders
when missing (BlenderKit or hand-made materials replace them per slot later). Faces are matched by
the Plasticity face id the bridge stores on the mesh ("face_ids" with "groups" = loop start / count
pairs), so the split follows the imprinted lines exactly. Prints the polygon count per slot.
"""
import bpy, sys, json

cfg = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
o = bpy.data.objects[cfg["object"]]
m = o.data

while len(m.materials) < len(cfg["slots"]):
    m.materials.append(None)
for i, name in enumerate(cfg["slots"]):
    if m.materials[i] is None or (i > 0 and m.materials[i].name != name):
        m.materials[i] = bpy.data.materials.get(name) or bpy.data.materials.new(name)

groups, fids = list(m["groups"]), list(m["face_ids"])
slot_of = {int(f): int(s) for s, fl in cfg["faces"].items() for f in fl}
ranges = []
for i, fid in enumerate(fids):
    s = slot_of.get(int(fid))
    if s is not None:
        ranges.append((groups[2 * i], groups[2 * i] + groups[2 * i + 1], s))
missing = set(slot_of) - {int(f) for f in fids}
if missing:
    print("LIVERY face ids not on the mesh:", sorted(missing), flush=True)

count = [0] * len(cfg["slots"])
for p in m.polygons:
    idx = 0
    for a, b, s in ranges:
        if a <= p.loop_start < b:
            idx = s
            break
    p.material_index = idx
    count[idx] += 1
for i, n in enumerate(count):
    print(f"LIVERY slot {i} {cfg['slots'][i]}: {n} polygons", flush=True)
bpy.ops.wm.save_mainfile()
print("LIVERY saved", bpy.data.filepath, flush=True)
