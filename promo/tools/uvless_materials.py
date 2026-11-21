"""Make texture-based materials work on meshes without UVs (bridge meshes have none), then save.

  blender -b <scene.blend> --python promo/tools/uvless_materials.py [-- <box_blend>]

Every link from a Texture Coordinate node's UV output is moved to its Object output, and every
image texture is switched to Box projection (default blend 0.25), so textures wrap the part in
its own object space instead of collapsing to one texel.
"""
import bpy, sys

BLEND = float(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else 0.25

for m in bpy.data.materials:
    if not m.node_tree:
        continue
    nt, changed = m.node_tree, 0
    for n in nt.nodes:
        if n.type == "TEX_COORD":
            for link in list(n.outputs["UV"].links):
                nt.links.new(n.outputs["Object"], link.to_socket)  # replaces the UV link on that input
                changed += 1
        elif n.type == "TEX_IMAGE":
            n.projection = "BOX"
            n.projection_blend = BLEND
            changed += 1
    if changed:
        print("UVLESS", m.name, changed, flush=True)

bpy.ops.wm.save_mainfile()
print("UVLESS saved", bpy.data.filepath, flush=True)
