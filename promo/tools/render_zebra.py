"""Zebra and mesh-density clips for the promo's curvature slots, rendered from the shot scene.

  blender -b promo/blender/<scene>.blend --python promo/tools/render_zebra.py -- <out_root> <prefix> <zebra|wire> [frames=96] [test] [sweep=60]

The camera starts where the scene's <prefix>_orbit camera starts and turns SWEEP degrees around the same centre
and at the same radius / height / lens, in the orbit's direction, linear, over `frames` frames at 24 fps.
Only the Plasticity collection renders (studio, shots and lights hidden), on a #161616 background.
  zebra: Workbench, MatCap check_reflection_horizontal (Blender's reflection-check preset) on a white single colour,
         with alpha; then run promo/tools/zebra_post.py on the folder (grey stripes on #161616).
  wire:  EEVEE, one override material: near-black surface with the triangle edges in white (Wireframe node,
         1 px), so the tessellation density from the Plasticity bridge shows.
Writes <out_root>/<prefix>_<mode>/frame_####.png (frames 1..N). `test` renders only frames 1 and N.
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, PREFIX, MODE = argv[0], argv[1], argv[2]
N = int(argv[3]) if len(argv) > 3 else 96
TEST = "test" in argv[4:]
SWEEP = float(next((a.split("=")[1] for a in argv[4:] if a.startswith("sweep=")), 60))  # degrees
BG = 0.0080  # #161616 in linear

sc = bpy.context.scene
orbit = bpy.data.objects[f"{PREFIX}_orbit"]
mark = next(m for m in sc.timeline_markers if m.camera == orbit)
aim = next(c.target for c in orbit.constraints if c.type == "TRACK_TO")
sc.frame_set(mark.frame); p0 = orbit.matrix_world.translation.copy(); centre = aim.matrix_world.translation.copy()
sc.frame_set(mark.frame + 1); p1 = orbit.matrix_world.translation.copy()
lens = orbit.data.lens
rel = p0 - centre
r = math.hypot(rel.x, rel.y); z = rel.z; a0 = math.atan2(rel.y, rel.x)
d1 = p1 - centre
direction = 1 if (math.atan2(d1.y, d1.x) - a0 + math.pi) % (2 * math.pi) - math.pi > 0 else -1

# new camera + target
tgt = bpy.data.objects.new(f"{PREFIX}_zebra_aim", None); sc.collection.objects.link(tgt); tgt.location = centre
cd = bpy.data.cameras.new(f"{PREFIX}_zebra"); cd.lens = lens; cd.clip_start = 0.001; cd.dof.use_dof = False
cam = bpy.data.objects.new(f"{PREFIX}_zebra", cd); sc.collection.objects.link(cam)
tt = cam.constraints.new("TRACK_TO"); tt.target = tgt; tt.track_axis = "TRACK_NEGATIVE_Z"; tt.up_axis = "UP_Y"
for f in range(1, N + 1):
    a = a0 + direction * math.radians(SWEEP) * (f - 1) / (N - 1)
    cam.location = centre + Vector((r * math.cos(a), r * math.sin(a), z))
    cam.keyframe_insert("location", frame=f)
from bpy_extras.anim_utils import action_get_channelbag_for_slot
cb = action_get_channelbag_for_slot(cam.animation_data.action, cam.animation_data.action_slot)
for fc in cb.fcurves:
    for k in fc.keyframe_points:
        k.interpolation = "LINEAR"
sc.camera = cam
sc.timeline_markers.clear()

# only the model renders
for c in sc.collection.children:
    c.hide_render = c.name != "Plasticity"
for o in sc.objects:
    if o.type == "LIGHT":
        o.hide_render = True

r_ = sc.render
r_.resolution_x, r_.resolution_y, r_.resolution_percentage = 1920, 1080, 100
r_.fps, r_.fps_base = 24, 1
r_.film_transparent = False
sc.view_settings.view_transform = "Standard"; sc.view_settings.look = "None"
sc.view_settings.exposure = 0; sc.view_settings.gamma = 1
im = r_.image_settings
if hasattr(im, "media_type"):
    im.media_type = "IMAGE"
im.file_format, im.color_mode, im.color_depth = "PNG", "RGB", "8"
world = bpy.data.worlds.new("zebra_bg"); world.color = (BG, BG, BG); world.use_nodes = True
bgn = world.node_tree.nodes.get("Background")
if bgn:
    bgn.inputs["Color"].default_value = (BG, BG, BG, 1); bgn.inputs["Strength"].default_value = 1
sc.world = world

if MODE == "zebra":
    r_.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "MATCAP"; sh.studio_light = "check_reflection_horizontal.exr"
    sh.color_type = "SINGLE"; sh.single_color = (1, 1, 1)
    sh.show_cavity = False; sh.show_shadows = False; sh.show_specular_highlight = False
    sh.background_type = "WORLD"
    sc.display.render_aa = "16"
    r_.film_transparent = True   # the preset matcap is blue-violet: zebra_post.py greys it and lays it on #161616
    im.color_mode = "RGBA"
elif MODE in ("tunnel", "tunnelwire"):
    # Design-studio light tunnel: thin longitudinal light lines on a half cylinder around the model's long (X)
    # axis, put in the WORLD so every reflection of them is exact and EEVEE needs no probes; camera rays see
    # the flat #161616 background. The model gets one black clearcoat paint, so the lines run over it as zebra.
    r_.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = 64
    wt = world.node_tree; wt.nodes.clear(); L = wt.links.new
    wo = wt.nodes.new("ShaderNodeOutputWorld")
    tc = wt.nodes.new("ShaderNodeTexCoord")
    sep = wt.nodes.new("ShaderNodeSeparateXYZ"); L(tc.outputs["Generated"], sep.inputs[0])
    ang = wt.nodes.new("ShaderNodeMath"); ang.operation = "ARCTAN2"; L(sep.outputs["Z"], ang.inputs[0]); L(sep.outputs["Y"], ang.inputs[1])
    frq = wt.nodes.new("ShaderNodeMath"); frq.operation = "MULTIPLY"; frq.inputs[1].default_value = 18.0; L(ang.outputs[0], frq.inputs[0])
    sin = wt.nodes.new("ShaderNodeMath"); sin.operation = "SINE"; L(frq.outputs[0], sin.inputs[0])
    thin = wt.nodes.new("ShaderNodeMapRange"); thin.inputs["From Min"].default_value = 0.82; thin.inputs["From Max"].default_value = 0.97
    L(sin.outputs[0], thin.inputs["Value"])
    up = wt.nodes.new("ShaderNodeMapRange"); up.inputs["From Min"].default_value = -0.25; up.inputs["From Max"].default_value = 0.05
    L(sep.outputs["Z"], up.inputs["Value"])                       # no lines below the horizon (the "floor"); lower lines turned the paint into chrome
    lines = wt.nodes.new("ShaderNodeMath"); lines.operation = "MULTIPLY"; L(thin.outputs[0], lines.inputs[0]); L(up.outputs[0], lines.inputs[1])
    gain = wt.nodes.new("ShaderNodeMath"); gain.operation = "MULTIPLY_ADD"; gain.inputs[1].default_value = 6.0; gain.inputs[2].default_value = 0.015
    L(lines.outputs[0], gain.inputs[0])
    env = wt.nodes.new("ShaderNodeBackground"); L(gain.outputs[0], env.inputs["Strength"]); env.inputs["Color"].default_value = (1, 1, 1, 1)
    cambg = wt.nodes.new("ShaderNodeBackground"); cambg.inputs["Color"].default_value = (BG, BG, BG, 1)
    lp = wt.nodes.new("ShaderNodeLightPath")
    mx = wt.nodes.new("ShaderNodeMixShader"); L(lp.outputs["Is Camera Ray"], mx.inputs[0]); L(env.outputs[0], mx.inputs[1]); L(cambg.outputs[0], mx.inputs[2])
    L(mx.outputs[0], wo.inputs["Surface"])
    m = bpy.data.materials.new("tunnel_paint"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear(); L = nt.links.new
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bs = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bs.inputs["Base Color"].default_value = (0.006, 0.006, 0.006, 1); bs.inputs["Roughness"].default_value = 0.12
    bs.inputs["Coat Weight"].default_value = 1.0; bs.inputs["Coat Roughness"].default_value = 0.0
    if MODE == "tunnel":
        L(bs.outputs[0], out.inputs["Surface"])
    else:
        wf = nt.nodes.new("ShaderNodeWireframe"); wf.use_pixel_size = True; wf.inputs["Size"].default_value = 1.0
        em = nt.nodes.new("ShaderNodeEmission"); em.inputs["Color"].default_value = (0.22, 0.22, 0.22, 1)  # dim: at 1 px the dense tessellation turned white at 0.75; em.inputs["Strength"].default_value = 1.0
        mx2 = nt.nodes.new("ShaderNodeMixShader"); L(wf.outputs["Fac"], mx2.inputs[0]); L(bs.outputs[0], mx2.inputs[1]); L(em.outputs[0], mx2.inputs[2])
        L(mx2.outputs[0], out.inputs["Surface"])
    bpy.context.view_layer.material_override = m
else:
    r_.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = 32
    m = bpy.data.materials.new("mesh_density"); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    wf = nt.nodes.new("ShaderNodeWireframe"); wf.use_pixel_size = True; wf.inputs["Size"].default_value = 1.0
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.35
    base = nt.nodes.new("ShaderNodeMix"); base.data_type = "RGBA"
    base.inputs["A"].default_value = (0.012, 0.012, 0.012, 1); base.inputs["B"].default_value = (0.05, 0.05, 0.05, 1)
    nt.links.new(lw.outputs["Facing"], base.inputs["Factor"])
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.inputs["B"].default_value = (0.85, 0.85, 0.85, 1)
    nt.links.new(wf.outputs["Fac"], mix.inputs["Factor"]); nt.links.new(base.outputs["Result"], mix.inputs["A"])
    em = nt.nodes.new("ShaderNodeEmission"); nt.links.new(mix.outputs["Result"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    bpy.context.view_layer.material_override = m

d = os.path.join(OUT, f"{PREFIX}_{MODE}"); os.makedirs(d, exist_ok=True)
r_.filepath = os.path.join(d, "frame_####")
sc.frame_start, sc.frame_end = 1, N
print(f"ZEBRA {PREFIX} {MODE} r={r:.2f} z={z:.2f} lens={lens} start={math.degrees(a0):.1f} dir={direction}", flush=True)
if TEST:
    for f in (1, N):
        sc.frame_set(f); r_.filepath = os.path.join(d, f"test_{f:04d}"); bpy.ops.render.render(write_still=True)
else:
    bpy.ops.render.render(animation=True)
print(f"ZEBRA {PREFIX} {MODE} done", flush=True)
