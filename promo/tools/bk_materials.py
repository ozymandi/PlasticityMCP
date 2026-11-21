"""Pick materials from BlenderKit and assign them to bodies by name pattern, then save the .blend.

Runs in GUI Blender (the BlenderKit client only starts with the UI); the user must be signed in to
BlenderKit in that Blender. Uses the add-on's own search request and its download operator — no
direct API calls with the user's key.

  blender <scene.blend> --python promo/tools/bk_materials.py -- <roles.json> <report.json>

roles.json:
  {"Gold": {"query": "gold polished", "match": ["Wheel_*", "Spinner_*"], "pick": 0}}
  - query: BlenderKit search text (asset type material is added)
  - pick: index among the downloadable results (default 0), or "assetBaseId": "<id>" to force one
  - match: fnmatch patterns on object names; the material lands on the first match and is then
    put on every match (linked meshes once)
  - slot: material slot to fill (default 0). Without "slot" the matches end up with this one
    material only; with it only that slot changes (livery slots made by livery.py stay)

Materials left without users afterwards are removed. The file is saved and Blender quits.
"""
import bpy, sys, json, time, fnmatch, urllib.parse

argv = sys.argv[sys.argv.index("--") + 1:]
ROLES, REPORT = json.load(open(argv[0], encoding="utf-8")), argv[1]
PKG = "bl_ext.user_default.blenderkit"
report = {"roles": {}, "log": []}
state = {"phase": "wait_client", "t0": time.time(), "queue": list(ROLES.keys())}


def log(m):
    print("[bk]", m, flush=True)
    report["log"].append(f"{time.strftime('%H:%M:%S')} {m}")


def mods():
    return (sys.modules[PKG + ".client_lib"], sys.modules[PKG + ".paths"], sys.modules[PKG + ".utils"],
            bpy.context.preferences.addons[PKG].preferences)


def search(text, page_size=12):
    client_lib, paths, utils, prefs = mods()
    url = (f"{paths.BLENDKIT_API}/search/?query={urllib.parse.quote(text)}+asset_type:material"
           f"&page_size={page_size}&dict_parameters=1")
    return client_lib.blocking_request(url, "GET", utils.get_headers(prefs.api_key)).json().get("results", [])


def targets(patterns):
    return [o for o in bpy.data.objects if o.type == "MESH" and any(fnmatch.fnmatchcase(o.name, p) for p in patterns)]


def window_override():
    win = bpy.context.window_manager.windows[0]
    area = next((a for a in win.screen.areas if a.type == "VIEW_3D"), win.screen.areas[0])
    return {"window": win, "area": area}


def tick():
    if time.time() - state["t0"] > 1800:
        log("timeout"); finish(); return None
    ph = state["phase"]
    if ph == "wait_client":
        try:
            search("gold", page_size=1)
            log("client up"); state["phase"] = "next"
        except Exception:
            pass
        return 2.0
    if ph == "next":
        if not state["queue"]:
            finish(); return None
        role = state["queue"].pop(0); spec = ROLES[role]
        objs = targets(spec["match"])
        if not objs:
            log(f"{role}: no objects match {spec['match']}"); return 0.2
        if spec.get("assetBaseId"):
            pick = {"assetBaseId": spec["assetBaseId"], "name": spec["assetBaseId"]}
        else:
            res = [r for r in search(spec["query"]) if r.get("canDownload")]
            if not res:
                log(f"{role}: nothing downloadable for '{spec['query']}'"); return 0.2
            pick = res[min(spec.get("pick", 0), len(res) - 1)]
            report["roles"][role] = {"query": spec["query"],
                                     "candidates": [{"name": r.get("name"), "id": r.get("assetBaseId"),
                                                     "free": r.get("isFree")} for r in res[:6]]}
        report["roles"].setdefault(role, {})["picked"] = {"name": pick.get("name"), "id": pick["assetBaseId"],
                                                          "free": pick.get("isFree")}
        slot = spec.get("slot")
        state.update(role=role, objs=objs, asset=pick["assetBaseId"], t_dl=time.time(), slot=slot)
        with bpy.context.temp_override(**window_override()):
            bpy.ops.scene.blenderkit_download("EXEC_DEFAULT", asset_base_id=pick["assetBaseId"],
                                              target_object=objs[0].name, material_target_slot=slot or 0)
        log(f"{role}: downloading '{pick.get('name')}' ({pick['assetBaseId']}) onto {objs[0].name}")
        state["phase"] = "wait_dl"
        return 1.0
    if ph == "wait_dl":
        first = state["objs"][0]
        si = state["slot"] or 0
        m = first.material_slots[si].material if len(first.material_slots) > si else None
        ad = m.get("asset_data") if m else None
        if ad and ad.get("assetBaseId") == state["asset"]:
            done = set()
            for o in state["objs"]:
                if o.data.name in done:
                    continue
                if state["slot"] is None:
                    o.data.materials.clear(); o.data.materials.append(m)
                else:
                    while len(o.data.materials) <= si:
                        o.data.materials.append(None)
                    o.data.materials[si] = m
                done.add(o.data.name)
            report["roles"][state["role"]]["material"] = m.name
            report["roles"][state["role"]]["objects"] = [o.name for o in state["objs"]]
            log(f"{state['role']}: '{m.name}' on {len(state['objs'])} bodies")
            state["phase"] = "next"; return 0.2
        if time.time() - state["t_dl"] > 300:
            log(f"{state['role']}: download did not arrive in 300 s, skipped"); state["phase"] = "next"
        return 1.0


def finish():
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    bpy.ops.wm.save_mainfile()
    json.dump(report, open(REPORT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    log("saved, done")
    bpy.app.timers.register(lambda: bpy.ops.wm.quit_blender(), first_interval=2.0)


bpy.app.timers.register(tick, first_interval=8.0)
