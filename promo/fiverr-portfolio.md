# Fiverr portfolio entry — PlasticityMCP promo (2026-10-19)

**Project name** (48/50): `PlasticityMCP — AI models real CAD in Plasticity`

**Industry**: Software Development, Engineering

**Project duration**: 3–6 months (April → October 2026)

**Project cost**: Designer's decision (left blank by default)

**Project started on**: 04 / 26

**Project description** (1330/1400):

PlasticityMCP is an open-source MCP server that lets an AI model (Claude or a local LLM) build real CAD geometry inside Plasticity: true B-rep solids, not meshes. 144 tools cover sketching, extrude / revolve / sweep / loft, booleans, fillets and chamfers, patterns, hollowing, text, measurement, STEP export and 2D drawing sheets.

The goal: give the AI a drawing or a description and get a manufacturable model back. I designed the architecture, the tool catalog and the modelling rules the server teaches the model (blocking first, then refining, no bare edges, fine detail last) and tested every stage on real parts.

Showcase objects modelled this way from reference drawings: a Nintendo NES with two controllers and a cartridge, a Technics SL-1200 turntable, a Nikon F2 with an EL-Nikkor lens and a full-suspension mountain bike. Each has dimensioned drawing sheets, STEP files and renders.

Challenges: the commercial build of Plasticity has no scripting API, so the server works on its native layer and every operation was verified against the kernel's limits. The full tool list is too big for small local models, so a compact 25-tool catalog was added for LM Studio.

Stack: TypeScript / Node, Plasticity 2026.1, Blender for the brushed-steel renders, HyperFrames for the video (16:9 and 9:16 cuts, published on YouTube).

**Attachments** (first file = thumbnail, 1024×768, 4:3):

1. `promo/assets/img/fiverr-cover-tt-1024x768.png` — Technics SL-1200 steel render (thumbnail)
2. `promo/assets/img/fiverr-cover-nes-1024x768.png` — NES steel render
3. `promo/videos/plasticity-mcp-16x9/renders/final-16x9.mp4` — 68 s, 1080p30, 43 MB (check Fiverr's video size limit)
4. `promo/assets/steel/cam-steel.png`, `promo/assets/steel/bike-steel.png` — Nikon F2 and MTB steel renders (16:9)
5. `promo/assets/img/nes-sheet.png`, `promo/assets/img/tt-sheet.png` — drawing sheets

Both covers: the 1920×1080 steel render scaled to 86 % and anchored to the bottom of a 1440×1080 canvas (#161616), title block top-left ("Plasticity" #ece9e2 + "MCP" #c9a57e in Adhesive Nr. Eight 132 px, subtitle "AI models real CAD in Plasticity" in Cascadia Mono 34 px as a stand-in for JetBrains Mono), then scaled to 1024×768.


---

# Fiverr portfolio entry — ZX Spectrum 128 promo (2026-10-26)

**Project name** (46/50): `ZX Spectrum 128 — AI-built CAD to Octane promo`

**Industry**: Industrial & Product Design, Software Development

**Project duration**: 1–2 weeks (October 2026)

**Project cost**: Designer's decision

**Project started on**: 10 / 26

**Project description** (≈1180/1400):

A 1986 ZX Spectrum 128 "toastrack" built by an AI inside Plasticity through PlasticityMCP, then turned into a 44-second promo.

The CAD part: from five reference photos the model drove Plasticity's own kernel to 188 solids: the two-part case with its seam and chamfers, 58 low keys with finger pads and the full 128K legend set, the finned heatsink with its notch, the rear edge connector, RGB DIN, RS232 and keypad sockets, screws, feet and vent slots. Every body is a valid B-rep with real fillets and chamfers, exported to STEP and to dimensioned drawing sheets.

The render part: the model went over Plasticity's Blender bridge into Octane with scripted materials, a key-legend texture atlas and a 1 / 2 / 10 mm grid floor; six camera scenes (assembly, three slow fly-throughs with depth of field, a somersault, an axonometric hold) at 1000 samples per pixel.

The cut: After Effects, opening with a pixel-exact Spectrum 128 boot — menu, 10 PRINT "hello speccy", LOAD "" — and a tape loader whose border stripes are simulated from the ROM loader's timing; the title frame loads as a SCREEN$ and the video starts in the same window. HUD labels, live timecode, section titles, progress bar, radial chromatic aberration, grain, and an 8-bit chiptune track.

Stack: PlasticityMCP (TypeScript), Plasticity 2026.1, Blender 5.2 + Octane, After Effects 2026, Python for the Spectrum simulation.

**Attachments** (first file = thumbnail, 1024×768, 4:3):

1. `promo/assets/img/fiverr-cover-zx-1024x768.png` — axonometric Octane frame with the title block (thumbnail)
2. `promo/videos/spectrum/spectrum-final-15mbps.mp4` — 44 s, 1080p30, 77 MB
3. `examples/zx-spectrum-128/drawings/spectrum-presentation.png` — drawing sheet board
4. `examples/zx-spectrum-128/detail-keys.png`, `detail-rear-ports.png` — Plasticity detail screenshots

Cover: same recipe as the other two (1440×1080 #161616 canvas, image at 86 % anchored bottom, title block Adhesive Nr. Eight 132 px + Cascadia Mono 34 px, scaled to 1024×768), but the image is the Octane axonometric frame re-rendered without the floor with an alpha channel (`promo/assets/steel/zx-rgba.png`) so the Spectrum sits cut out on the background like the steel renders.
