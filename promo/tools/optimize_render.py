"""Apply the promo's speed settings for Cycles to a scene, then save it (as a new file if given).

  blender -b <scene.blend> --python promo/tools/optimize_render.py -- [out.blend]

Keeps the scene's sample count, denoiser and look; changes only what costs time without a visible
gain on the promo's subjects (glossy paint, metal, clear glass, studio softboxes):
  - adaptive sampling on, noise threshold 0.04, at least 32 samples per pixel
    (Maserati test 2026-11-20: 0.04 renders 2x faster than adaptive off, PSNR 44.7-46.3 dB vs. it)
  - caustics off (reflective and refractive), filter glossy 1.0
  - light paths: total 8, diffuse 3, glossy 4, transmission 8, transparent 8, volume 0
  - indirect clamp 10, light tree on
  - persistent data on (an animation reuses the scene between frames instead of rebuilding it)
"""
import bpy, sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
sc = bpy.context.scene
c = sc.cycles

settings = {
    "use_adaptive_sampling": True, "adaptive_threshold": 0.04, "adaptive_min_samples": 32,
    "caustics_reflective": False, "caustics_refractive": False, "blur_glossy": 1.0,
    "max_bounces": 8, "diffuse_bounces": 3, "glossy_bounces": 4, "transmission_bounces": 8,
    "transparent_max_bounces": 8, "volume_bounces": 0,
    "sample_clamp_indirect": 10.0, "use_light_tree": True,
}
for k, v in settings.items():
    old = getattr(c, k)
    setattr(c, k, v)
    if old != v:
        print(f"OPT {k}: {old} -> {v}", flush=True)
if not sc.render.use_persistent_data:
    sc.render.use_persistent_data = True
    print("OPT use_persistent_data: False -> True", flush=True)

if argv:
    bpy.ops.wm.save_as_mainfile(filepath=argv[0], copy=False)
else:
    bpy.ops.wm.save_mainfile()
print("OPT saved", bpy.data.filepath, flush=True)
