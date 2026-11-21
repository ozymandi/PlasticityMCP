"""Blender 5.x headless: render an OBJ with one brushed-steel material, studio lights, iso camera.
usage: blender -b --factory-startup -P blender_steel.py -- <in.obj> <out.png> [--samples 256] [--w 1920 --h 1080]
        [--az 45 --el 35 --ortho 1] [--mat steel|graphite] [--fill 0.78]
"""
import bpy, sys, math, argparse
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("src"); ap.add_argument("dst")
ap.add_argument("--samples", type=int, default=256)
ap.add_argument("--w", type=int, default=1920); ap.add_argument("--h", type=int, default=1080)
ap.add_argument("--az", type=float, default=-45)   # camera azimuth around Z (deg), -45 = front-right iso
ap.add_argument("--el", type=float, default=32)    # elevation
ap.add_argument("--fill", type=float, default=0.80)  # fraction of frame the model fills
ap.add_argument("--bg", default="161616")
ap.add_argument("--glass", default="")  # comma-separated object name prefixes rendered as clear acrylic
a = ap.parse_args(argv)

# ---------- scene ----------
scene = bpy.context.scene
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices: d.use = (d.type == "OPTIX") or d.type == "CPU"
    scene.cycles.device = "GPU"
except Exception as e:
    print("GPU setup failed, CPU:", e)
scene.cycles.samples = a.samples
scene.cycles.use_denoising = True
scene.render.resolution_x = a.w; scene.render.resolution_y = a.h; scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"; scene.view_settings.look = "AgX - Medium High Contrast"

# ---------- import ----------
bpy.ops.wm.obj_import(filepath=a.src, forward_axis="Y", up_axis="Z")
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print("imported", len(objs), "objects")
for o in objs:
    o.select_set(True)
    for p in o.data.polygons: p.use_smooth = True
    m = o.modifiers.new("smooth", "SMOOTH_BY_ANGLE") if hasattr(bpy.types, "SmoothByAngleModifier") else None
    if m is None:
        try: bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))
        except Exception: pass
    else:
        m.angle = math.radians(30)

# bounds (mm units in the OBJ; keep them, scale lights/camera to fit)
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
center = (mn + mx) / 2; size = mx - mn; diag = size.length
print("bounds", tuple(round(v, 1) for v in mn), tuple(round(v, 1) for v in mx), "diag", round(diag, 1))

# ---------- material: brushed steel ----------
mat = bpy.data.materials.new("Steel"); mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
out = nt.nodes.new("ShaderNodeOutputMaterial")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Base Color"].default_value = (0.72, 0.73, 0.75, 1)
bsdf.inputs["Metallic"].default_value = 1.0
bsdf.inputs["Roughness"].default_value = 0.30
if "Anisotropic" in bsdf.inputs: bsdf.inputs["Anisotropic"].default_value = 0.55
if "Anisotropic Rotation" in bsdf.inputs: bsdf.inputs["Anisotropic Rotation"].default_value = 0.25
if "Coat Weight" in bsdf.inputs: bsdf.inputs["Coat Weight"].default_value = 0.15
nt.links.new(bsdf.outputs[0], out.inputs[0])
glass = bpy.data.materials.new("Acrylic"); glass.use_nodes = True
gn = glass.node_tree; gn.nodes.clear()
go = gn.nodes.new("ShaderNodeOutputMaterial"); gb = gn.nodes.new("ShaderNodeBsdfGlass")
gb.inputs["Color"].default_value = (0.92, 0.95, 0.98, 1); gb.inputs["Roughness"].default_value = 0.04; gb.inputs["IOR"].default_value = 1.49
gn.links.new(gb.outputs[0], go.inputs[0])
glass_names = [g for g in a.glass.split(",") if g]
for o in objs:
    o.data.materials.clear()
    o.data.materials.append(glass if any(o.name.startswith(g) for g in glass_names) else mat)
scene.cycles.max_bounces = 16; scene.cycles.transparent_max_bounces = 16; scene.cycles.glossy_bounces = 8; scene.cycles.transmission_bounces = 12

# ---------- floor (shadow catcher-ish dark matte) ----------
bpy.ops.mesh.primitive_plane_add(size=diag * 12, location=(center.x, center.y, mn.z - 0.01))
floor = bpy.context.active_object; floor.name = "Floor"
fm = bpy.data.materials.new("Floor"); fm.use_nodes = True
fb = fm.node_tree.nodes["Principled BSDF"]
r, g, b = (int(a.bg[i:i + 2], 16) / 255 for i in (0, 2, 4))
fb.inputs["Base Color"].default_value = (r ** 2.2 * 1.15, g ** 2.2 * 1.15, b ** 2.2 * 1.15, 1)
fb.inputs["Roughness"].default_value = 0.6
floor.data.materials.append(fm)
floor.is_shadow_catcher = True
scene.render.film_transparent = True

# ---------- world ----------
world = bpy.data.worlds.new("W"); scene.world = world; world.use_nodes = True
wn = world.node_tree; wn.nodes.clear()
wo = wn.nodes.new("ShaderNodeOutputWorld"); bg = wn.nodes.new("ShaderNodeBackground")
bg.inputs["Color"].default_value = (r ** 2.2, g ** 2.2, b ** 2.2, 1); bg.inputs["Strength"].default_value = 1.0
wn.links.new(bg.outputs[0], wo.inputs[0])
# camera-rays see flat bg; the model gets a soft gradient env for reflections
lp = wn.nodes.new("ShaderNodeLightPath"); mix = wn.nodes.new("ShaderNodeMixShader")
env = wn.nodes.new("ShaderNodeBackground")
grad = wn.nodes.new("ShaderNodeTexGradient"); grad.gradient_type = "LINEAR"
mapn = wn.nodes.new("ShaderNodeMapping"); tc = wn.nodes.new("ShaderNodeTexCoord")
ramp = wn.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (0.02, 0.02, 0.025, 1)
ramp.color_ramp.elements[1].position = 0.9; ramp.color_ramp.elements[1].color = (0.9, 0.92, 1.0, 1)
mapn.inputs["Rotation"].default_value = (0, math.radians(-90), 0)
wn.links.new(tc.outputs["Generated"], mapn.inputs[0]); wn.links.new(mapn.outputs[0], grad.inputs[0])
wn.links.new(grad.outputs["Fac"], ramp.inputs[0]); wn.links.new(ramp.outputs["Color"], env.inputs["Color"])
env.inputs["Strength"].default_value = 2.2
wn.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0]); wn.links.new(env.outputs[0], mix.inputs[1]); wn.links.new(bg.outputs[0], mix.inputs[2])
wn.links.new(mix.outputs[0], wo.inputs[0])

# ---------- lights: key / rim / fill (area) ----------
def area(name, pos, size, energy, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA"); ld.energy = energy; ld.size = size; ld.color = color
    lo = bpy.data.objects.new(name, ld); scene.collection.objects.link(lo)
    lo.location = center + Vector(pos)
    d = (center - lo.location).normalized(); lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return lo
D = diag
area("Key", (-1.1 * D, -0.9 * D, 1.6 * D), 1.4 * D, 6.0e6 * (D / 500) ** 2, (1.0, 0.98, 0.95))
area("Rim", (1.3 * D, 1.0 * D, 1.0 * D), 0.6 * D, 7.0e6 * (D / 500) ** 2, (0.85, 0.9, 1.0))
area("Fill", (1.2 * D, -1.4 * D, 0.5 * D), 2.2 * D, 1.6e6 * (D / 500) ** 2, (0.95, 0.97, 1.0))
area("Top", (0, 0, 2.4 * D), 2.5 * D, 1.5e6 * (D / 500) ** 2)

# ---------- camera: orthographic iso ----------
cam_d = bpy.data.cameras.new("Cam"); cam_d.type = "ORTHO"
cam = bpy.data.objects.new("Cam", cam_d); scene.collection.objects.link(cam); scene.camera = cam
az = math.radians(a.az); el = math.radians(a.el)
dirv = Vector((math.cos(el) * math.sin(az), -math.cos(el) * math.cos(az), math.sin(el)))  # from center to camera
cam.location = center + dirv * D * 3
cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
cam_d.clip_end = D * 10
# fit: project bbox corners into camera space, size ortho_scale to fill
inv = cam.matrix_world.inverted()
xs = []; ys = []
for o in objs:
    for c in o.bound_box:
        p = inv @ (o.matrix_world @ Vector(c)); xs.append(p.x); ys.append(p.y)
w = max(xs) - min(xs); h = max(ys) - min(ys)
asp = a.w / a.h
cam_d.ortho_scale = max(w, h * asp) / a.fill
# recenter on bbox middle in camera plane
cx = (max(xs) + min(xs)) / 2; cy = (max(ys) + min(ys)) / 2
cam.location += cam.matrix_world.to_3x3() @ Vector((cx, cy, 0))

scene.render.filepath = a.dst
bpy.ops.render.render(write_still=True)
print("WROTE", a.dst)
