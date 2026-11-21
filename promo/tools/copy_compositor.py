"""Copy the compositor node tree of one .blend into the scene being opened, then save it.

  blender -b <target.blend> --python promo/tools/copy_compositor.py -- <source.blend> [tree name='Scene Compositor']

Appends the node group from the source file and makes it the target scene's compositing tree (Blender 5:
scene.compositing_node_group), so the target renders with the same glare / bloom as the source.
"""
import bpy, sys
argv = sys.argv[sys.argv.index("--") + 1:]
src = argv[0]; name = argv[1] if len(argv) > 1 else "Scene Compositor"
with bpy.data.libraries.load(src, link=False) as (fr, to):
    to.node_groups = [n for n in fr.node_groups if n == name]
tree = to.node_groups[0]
for sc in bpy.data.scenes:
    if sc.name == "Scene":
        sc.compositing_node_group = tree
        sc.render.use_compositing = True
        print("COMPOSITOR", sc.name, "->", tree.name, [n.name for n in tree.nodes])
bpy.ops.wm.save_mainfile()
