import subprocess, json, sys, pathlib
CL = "C:/Users/ozyma/AppData/Local/hermes/skills/creative/comfy-local/scripts/comfy_local.py"
WF = "C:/Users/ozyma/AppData/Local/hermes/skills/creative/comfy-local/workflows/qwen_image21_edit_api.json"
SRC = "E:/Projects/PlasticityMCP/promo/assets/img"
OUT = pathlib.Path("E:/Projects/PlasticityMCP/promo/assets/photoreal"); OUT.mkdir(exist_ok=True)
COMMON = (" Keep the exact same object, the same isometric camera angle, the same framing, position, scale and proportions, "
          "the same parts in the same places. Remove the grey matcap look and render it as a photorealistic studio product photograph: "
          "real materials, soft studio key light from the upper left with a gentle rim light, subtle contact shadows on a dark neutral "
          "matte surface, dark charcoal background close to hex 161616, shallow but sharp focus on the object. No user interface, "
          "no axis gizmo, no grid, no text overlays, no watermark, no extra objects.")
JOBS = {
 "nes": "Transform <image1>, a CAD matcap render of a Nintendo Entertainment System console with two controllers and a cartridge, into a photo of the real 1985 NES: a two-tone grey ABS plastic box, light warm grey upper shell with the darker grey front-loading flap, the horizontal vent grooves on the top, the small red POWER and RESET buttons on the front, two black controller ports; two rectangular grey controllers with a smooth clean faceplate, a black plastic cross-shaped D-pad in one piece, two small black SELECT and START buttons and two round red A and B buttons, each controller with one black coiled cable. Smooth, flat, unmarked plastic surfaces: absolutely no printed text, no logos, no lettering, no labels, no stickers, no tiny symbols, no specks, no dirt, no screws on the visible faces." + COMMON,
 "tt": "Transform <image1>, a CAD matcap render of a Technics SL-1200 MK2 DJ turntable, into a photo of the real, iconic Technics SL-1200 MK2: a heavy brushed silver aluminium plinth that is ONE solid rectangular slab with four straight vertical sides, four closed corners and a continuous flat top (never split, stepped, sunk or nested); the black die-cast platter with the thick black rubber slip mat and a black vinyl record, the strobe dots on the platter rim lit by the small red strobe lamp, the large round silver START/STOP button at the front left, the two small 33 / 45 speed buttons beside it, the long pitch fader with its lit scale on the front right, the S-shaped chrome tonearm with the headshell and the round counterweight at the rear right, the small knob and the target light at the rear left; four rubber feet. Every part sits on top of the flat slab." + COMMON,
 "cam": "Transform <image1>, a CAD matcap render of a Nikon F2 film camera with a lens, into a photo of the real camera: chrome top plate with engraved markings, black leatherette body covering, black metal lens barrel with the aperture ring and white engraved numbers, glass front element with a faint reflection." + COMMON,
 "bike": "Transform <image1>, a CAD matcap render of a full-suspension mountain bike, into a photo of the real bike: matte dark olive aluminium frame, black fork and shock, black rubber knobby tyres on black rims with spokes, silver chainring and cassette, black saddle and grips." + COMMON,
}
argv=[a for a in sys.argv[1:] if not a.startswith("--var=")]
var=next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--var=")),None)
only = argv or list(JOBS)
results = {}
for i, k in enumerate(only):
    args = [sys.executable, CL, "run", WF, "--input-image", f"image={SRC}/{k}-iso.png",
            "--set", f"459:484/on_false={JOBS[k]}", "--set", "459:474/resolution=1536", "--args", '{"seed": -1}']
    if i < len(only) - 1: args.append("--keep")
    print("==", k, flush=True)
    r = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = r.stdout.strip().splitlines()
    js = None
    for line in reversed(tail):
        if line.startswith("{"):
            try: js = json.loads(line); break
            except Exception: pass
    if js is None:
        # try the whole stdout from the first '{'
        s = r.stdout[r.stdout.find("{"):]
        try: js = json.loads(s)
        except Exception: js = None
    if js and js.get("outputs"):
        f = pathlib.Path(js["outputs"][0]["file"])
        dst = OUT / (f"{k}-photoreal-v{var}.png" if var else f"{k}-photoreal.png")
        dst.write_bytes(f.read_bytes()); results[k] = str(dst); print("  ->", dst, flush=True)
    else:
        print("  FAILED rc", r.returncode); print(r.stdout[-1500:]); print(r.stderr[-1500:])
print(json.dumps(results, indent=1))
