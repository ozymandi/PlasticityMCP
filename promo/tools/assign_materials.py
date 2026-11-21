"""Create Principled materials and assign them to bodies by name pattern, then save the .blend.

  blender -b <scene.blend> --python promo/tools/assign_materials.py -- <materials.json>

materials.json:
  {"Glass": {"match": ["Windscreen", "Headlamp_cover_*"],
             "principled": {"Base Color": [1, 1, 1, 1], "Roughness": 0.0, "IOR": 1.5, "Transmission Weight": 1.0}}}

A colour may be given as "#rrggbb" (sRGB, converted to linear). An existing material of the same
name is updated in place. A mesh shared by linked duplicates gets the material once. Bodies
matching no entry keep what they have and are listed as UNMATCHED. Every material that is not in
the config and has no users afterwards is removed. Prints one line per assignment.
"""
import bpy, sys, json, fnmatch

cfg = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def value(v):
    if isinstance(v, str) and v.startswith("#"):
        return [srgb_to_linear(int(v[i:i + 2], 16) / 255) for i in (1, 3, 5)] + [1.0]
    return v


matched = set()
for name, spec in cfg.items():
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    for key, val in spec.get("principled", {}).items():
        bsdf.inputs[key].default_value = value(val)
    done = set()
    for o in bpy.data.objects:
        if o.type != "MESH" or not any(fnmatch.fnmatchcase(o.name, p) for p in spec["match"]):
            continue
        if o.data.name not in done:
            o.data.materials.clear()
            o.data.materials.append(mat)
            done.add(o.data.name)
        matched.add(o.name)
        print("MAT", name, "->", o.name, flush=True)

for o in bpy.data.objects:
    if o.type == "MESH" and o.name not in matched:
        print("UNMATCHED", o.name, flush=True)
for m in list(bpy.data.materials):
    if m.name not in cfg and m.users == 0:
        print("REMOVED", m.name, flush=True)
        bpy.data.materials.remove(m)

bpy.ops.wm.save_mainfile()
print("MAT saved", bpy.data.filepath, flush=True)
