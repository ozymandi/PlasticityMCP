"""Bridge a Plasticity document into Blender with tessellation set per part, then save a .blend.

Runs in GUI Blender (the Plasticity bridge add-on needs bpy.app.timers, so not headless):
  blender --python promo/tools/bridge_export.py -- <config.json> <out.blend> <report.json>

Plasticity must be running with the document open (WebSocket bridge on localhost:8980).

config.json:
  {
    "groups": [                       # first match wins; fnmatch patterns on body names
      {"name": "hero", "match": ["Body", "Headlamp_*"], "tol": 0.0002, "angle": 0.05},
      {"name": "rest", "match": ["*"], "tol": 0.001, "angle": 0.15}
    ],
    "link": [["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]]   # first = source mesh
  }

tol / angle go to the bridge's refacet (curve chord and surface plane alike), tolerance relative to
each body's bounding box, angle in radians - the same values the add-on's Refacet button sends.

Linked duplicates: every later body of a link set whose geometry equals the source's moved, or
mirrored in Y and moved, gets the source mesh plus that transform (checked by vertex count,
bounding box and vertex centroid within LINK_TOL). Bodies that do not match keep their own mesh.
Linked bodies lose their live bridge link: refacet the source before linking, never after.

Blender 5.3 crashes in Mesh.normals_split_custom_set on meshes with degenerate triangles
(seen on the Maserati's Dash_panel). The add-on is left untouched; a runtime shim skips the custom
normals for such meshes and sets sharp edges by angle (30 deg) instead.
"""
import bpy, sys, time, json, fnmatch, addon_utils
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
CONFIG, OUT_BLEND, REPORT = argv[0], argv[1], argv[2]
cfg = json.load(open(CONFIG, encoding="utf-8"))
LINK_TOL = 0.0005  # metres
STABLE_S = 4.0
TIMEOUT_S = 1800

if not addon_utils.check("plasticity")[1]:
    addon_utils.enable("plasticity", default_set=True)

report = {"config": cfg, "log": [], "anomalies": []}
client = None
FacetShapeType = None


def log(msg):
    print("[export]", msg, flush=True)
    report["log"].append(f"{time.strftime('%H:%M:%S')} {msg}")


def install_shim():
    global client, FacetShapeType
    pkg = sys.modules["plasticity"]
    hmod = sys.modules["plasticity.handler"]
    client = pkg.plasticity_client
    FacetShapeType = sys.modules["plasticity.client"].FacetShapeType
    orig = hmod.safe_mesh_import_data
    if getattr(orig, "_export_shim", False):
        return

    def _safe_import(mesh, indices, normals, groups, face_ids):
        idx = np.asarray(indices).reshape(-1, 3)
        nn = np.asarray(normals).size // 3
        deg = int(((idx[:, 0] == idx[:, 1]) | (idx[:, 1] == idx[:, 2]) | (idx[:, 0] == idx[:, 2])).sum()) if len(idx) else 0
        # indices address the normals array (original numbering), not the welded mesh vertices
        oob = int((idx >= nn).sum()) if len(idx) else 0
        mesh.update(calc_edges=True)
        if deg or oob:
            report["anomalies"].append({"mesh": mesh.name, "tris": len(idx), "degenerate": deg, "out_of_range": oob})
            log(f"anomaly {mesh.name}: degenerate {deg}, out of range {oob} -> sharp by angle, no custom normals")
            mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
            mesh.set_sharp_from_angle(angle=0.5236)
            mesh["groups"] = list(groups)
            mesh["face_ids"] = list(face_ids)
            return
        return orig(mesh, indices, normals, groups, face_ids)

    _safe_import._export_shim = True
    hmod.safe_mesh_import_data = _safe_import


def bodies():
    return [o for o in bpy.data.objects if "plasticity_id" in o.keys() and o.type == "MESH"]


def tri_count(objs, unique=False):
    seen, n = set(), 0
    for o in objs:
        if unique and o.data.name in seen:
            continue
        seen.add(o.data.name)
        o.data.calc_loop_triangles()
        n += len(o.data.loop_triangles)
    return n


def group_of(name):
    for g in cfg["groups"]:
        if any(fnmatch.fnmatchcase(name, p) for p in g["match"]):
            return g["name"]
    return None


def world_bbox(o, mesh_only=False):
    pts = [Vector(c) for c in o.bound_box] if mesh_only else [o.matrix_world @ Vector(c) for c in o.bound_box]
    return Vector(map(min, *pts)), Vector(map(max, *pts))


def centroid(mesh):
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", co)
    return Vector(co.reshape(-1, 3).mean(axis=0))


def link_sets():
    out = []
    for names in cfg.get("link", []):
        src = bpy.data.objects.get(names[0])
        if not src:
            log(f"link: source {names[0]} missing")
            continue
        s_lo, s_hi = world_bbox(src, mesh_only=True)
        s_c = centroid(src.data)
        for n in names[1:]:
            dst = bpy.data.objects.get(n)
            if not dst:
                log(f"link: {n} missing"); continue
            if len(dst.data.vertices) != len(src.data.vertices):
                log(f"link: {n} vertex count differs, kept"); continue
            d_lo, d_hi = world_bbox(dst, mesh_only=True)
            d_c = centroid(dst.data)
            done = False
            for mirror in (False, True):
                S = Matrix.Diagonal((1, -1, 1, 1)) if mirror else Matrix.Identity(4)
                c_lo = S @ s_lo; c_hi = S @ s_hi
                c_lo, c_hi = Vector(map(min, c_lo, c_hi)), Vector(map(max, c_lo, c_hi))
                t = d_lo - c_lo
                M = Matrix.Translation(t) @ S
                ok = ((c_hi + t) - d_hi).length < LINK_TOL and ((M @ s_c) - d_c).length < LINK_TOL
                if ok:
                    old = dst.data
                    dst.data = src.data
                    dst.matrix_world = M
                    if old.users == 0:
                        bpy.data.meshes.remove(old)
                    out.append({"object": n, "source": src.name, "mirror": mirror, "offset_m": [round(x, 4) for x in t]})
                    log(f"link: {n} -> {src.name}{' mirrored' if mirror else ''}")
                    done = True
                    break
            if not done:
                log(f"link: {n} does not match {src.name}, kept")
    return out


state = {"phase": "connect", "t0": time.time(), "sig": None, "since": None, "queue": []}


def stable(sig):
    now = time.time()
    if sig != state["sig"]:
        state["sig"], state["since"] = sig, now
        return False
    return now - state["since"] > STABLE_S


def vert_sig():
    return sum(len(o.data.vertices) for o in bodies())


def tick():
    if time.time() - state["t0"] > TIMEOUT_S:
        log("timeout"); finish(); return None
    ph = state["phase"]
    if ph == "connect":
        client.connect("localhost:8980"); state["phase"] = "wait_connect"; log("connecting")
    elif ph == "wait_connect":
        if client.connected:
            log("connected"); client.list_all(); state["phase"] = "wait_list"
    elif ph == "wait_list":
        if bodies() and stable(len(bodies())):
            objs = bodies()
            report["before"] = {"bodies": len(objs), "tris": tri_count(objs)}
            log(f"listed {len(objs)} bodies, {report['before']['tris']} tris")
            per = {}
            for o in objs:
                g = group_of(o.name)
                per.setdefault(g, []).append(o)
            report["groups"] = {str(g): sorted(o.name for o in v) for g, v in per.items()}
            state["queue"] = [(g, per[g["name"]]) for g in cfg["groups"] if g["name"] in per]
            state["phase"] = "next"
    elif ph == "next":
        if not state["queue"]:
            state["phase"] = "link"; return 0.5
        g, objs = state["queue"].pop(0)
        filename = objs[0]["plasticity_filename"]
        client.refacet_some(filename, [o["plasticity_id"] for o in objs], relative_to_bbox=True,
                            curve_chord_tolerance=g["tol"], curve_chord_angle=g["angle"],
                            surface_plane_tolerance=g["tol"], surface_plane_angle=g["angle"],
                            match_topology=True, max_sides=3, plane_angle=0,
                            min_width=0, max_width=0, curve_chord_max=0, shape=FacetShapeType.CUT)
        state["current"] = g["name"]; state["sig"] = None; state["t_ref"] = time.time()
        state["before_sig"] = vert_sig()
        log(f"refacet {g['name']}: {len(objs)} bodies, tol {g['tol']}, angle {g['angle']}")
        state["phase"] = "wait_refacet"
    elif ph == "wait_refacet":
        sig = vert_sig()
        changed = sig != state["before_sig"] or time.time() - state["t_ref"] > 30
        if changed and stable(sig):
            log(f"refacet {state['current']} settled")
            state["phase"] = "next"
    elif ph == "link":
        objs = bodies()
        report["after_refacet"] = {"tris": tri_count(objs),
                                   "per_group": {g: tri_count([bpy.data.objects[n] for n in names])
                                                 for g, names in report["groups"].items()}}
        report["linked"] = link_sets()
        report["after_link"] = {"tris_drawn": tri_count(objs), "tris_unique": tri_count(objs, unique=True)}
        finish(); return None
    return 0.5


def finish():
    try:
        bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
        log(f"saved {OUT_BLEND}")
    except Exception as e:
        log(f"save failed: {e}")
    with open(REPORT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, ensure_ascii=False)
    log("done")


def start():
    install_shim()
    for o in list(bpy.data.objects):
        if o.name in ("Cube", "Camera", "Light"):
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.app.timers.register(tick, first_interval=0.5)


bpy.app.timers.register(start, first_interval=6.0)
