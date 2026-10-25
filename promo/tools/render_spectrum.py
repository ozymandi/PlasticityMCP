"""Headless Octane render of promo/blender/spectrum.blend, one scene at a time.
usage: blender -b spectrum.blend --python render_spectrum.py -- [scene ...] [--test]
"""
import bpy, sys, time, os
ROOT = r"E:\Projects\PlasticityMCP\promo\renders\spectrum"
SCENES = {"assembly": (1, 240), "fly1": (241, 390), "fly2": (391, 540),
          "fly3": (541, 690), "flip": (691, 810), "iso": (811, 960)}
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
test = "--test" in argv
names = [a for a in argv if a in SCENES] or list(SCENES)
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1920, 1080, 100
sc.render.use_overwrite = False   # resume-friendly: skip frames already on disk
sc.render.use_placeholder = False
for name in names:
    f0, f1 = SCENES[name]
    if test:
        f0 = f1 = (f0 + f1) // 2
    sc.frame_start, sc.frame_end = f0, f1
    sc.render.filepath = os.path.join(ROOT, name, "frame_") if not test else os.path.join(ROOT, f"final-test-{name}-")
    t = time.time()
    print(f"[render] {name} {f0}-{f1} -> {sc.render.filepath}", flush=True)
    bpy.ops.render.render(animation=True)
    print(f"[render] {name} done in {time.time()-t:.0f}s", flush=True)
