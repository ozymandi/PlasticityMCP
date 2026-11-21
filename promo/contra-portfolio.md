# Contra portfolio — PlasticityMCP (2026-10-26)

Two short entries for Contra (project cards are short: title, one-line tagline, a paragraph, skills, media).

---

## 1. PlasticityMCP — AI models real CAD in Plasticity

**Tagline:** An open-source MCP server that lets an AI build real B-rep CAD in Plasticity — 144 tools, verified on real parts.

**Description (≈650 chars):**

PlasticityMCP connects Claude or a local LLM to Plasticity and lets it build real CAD geometry: solids, not meshes. 144 tools cover sketching, extrude / revolve / sweep / loft, booleans, fillets and chamfers, patterns, text, measurement, STEP export and drawing sheets. I designed the architecture, the tool catalog and the modelling rules the server teaches the model, then tested it on real objects: a Nintendo NES, a Technics SL-1200, a Nikon F2, a mountain bike and a ZX Spectrum 128. Each one has dimensioned drawings, a STEP file and renders. Stack: TypeScript / Node, Plasticity 2026.1, Blender, After Effects.

**Skills / tags:** AI agents · MCP · CAD · Plasticity · TypeScript · Product design · 3D rendering · Technical art

**Media:** `promo/videos/plasticity-mcp-16x9/renders/final-16x9.mp4`, covers `promo/assets/img/fiverr-cover-tt-1024x768.png`, `fiverr-cover-nes-1024x768.png`

**Link:** https://github.com/ozymandi/PlasticityMCP

---

## 2. ZX Spectrum 128 — from AI-built CAD to an Octane promo

**Tagline:** A 1986 toastrack modelled by an AI through PlasticityMCP, rendered in Octane and cut in After Effects with a working Spectrum tape-loader intro.

**Description (≈700 chars):**

The ZX Spectrum 128 "toastrack" was modelled from reference photos by an AI driving Plasticity through PlasticityMCP: 188 solids with 58 keys and legends, the finned heatsink, the rear edge connector and ports, screws and vents, all with real fillets and chamfers. The model went over Plasticity's Blender bridge straight into Octane: materials, key-legend atlas, a millimetre grid floor and six camera scenes (assembly, three slow fly-throughs, a somersault, an axonometric hold) at 1000 samples. The cut in After Effects opens with a pixel-exact Spectrum 128 boot: menu, `10 PRINT "hello speccy"`, `LOAD ""` and a tape loader whose border stripes are simulated from the ROM loader's timing, then loads the title frame as a SCREEN$ before the video starts. HUD, timecode, section titles, chiptune track.

**Skills / tags:** CAD · Plasticity · Octane · Blender · After Effects · Motion design · Retro computing · AI agents

**Media:** `promo/videos/spectrum/spectrum-final-15mbps.mp4` (44 s), cover `promo/assets/img/fiverr-cover-zx-1024x768.png`, drawings `examples/zx-spectrum-128/drawings/spectrum-presentation.png`

**Link:** https://github.com/ozymandi/PlasticityMCP/tree/main/examples/zx-spectrum-128

---

## 3. PlasticityMCP surfacing update (2026-11-21)

Same format as the live first post (https://contra.com/p/OvP7Z27g-plasticity-mcp-is-an-mcp-server): text post + video, tags.

**Text:**

PlasticityMCP update: free-form surfacing. Until now the LLM built solids in Plasticity; now it builds surfaces and checks the seams itself.

Everything in this video was modelled by a language model through the server, no mouse: a 1955 Maserati 300S from one side drawing and a 6 m boat, CUBE, from a single photo. The zebra and the mesh density are rendered from the same geometry; the shots are Cycles renders in Blender, cut in After Effects.

What's new

• patch with G0 / G1 / G2 continuity to the neighbouring faces
• loft between surface edges, clamped at both ends
• sweep along 1–3 rails
• round, conic and G2 fillets
• measure_continuity: the angle between face normals across a seam (G2 at 0.000002°)
• 145 tools now

Video: https://youtu.be/lPXfhR7Ib30
Source and docs: https://github.com/ozymandi/PlasticityMCP

**Tags:** 3D Modeler · MCP · Plasticity · Surface Modeling

**Media:** `promo/videos/surfacing/surfacing-final-15mbps.mp4` (81 s, 154 MB); thumbnail `promo/assets/img/youtube-thumb-surfacing-ae.jpg` if a cover is asked for

### 3a. Feed post (Contra community, short)

PlasticityMCP got free-form surfacing 🚗🚤

The LLM in Plasticity now builds surfaces, not only solids: G0/G1/G2 patches, edge lofts, 1–3 rail sweeps, conic and G2 fillets, and it checks its own seams (G2 at 0.000002°). Test pieces: a Maserati 300S from one drawing and a 6 m boat from one photo. No mouse.

Full video: https://youtu.be/lPXfhR7Ib30

Tags: #Plasticity #MCP #3DModeling

### 3b. Update block for the existing project (append at the end of https://contra.com/p/OvP7Z27g-plasticity-mcp-is-an-mcp-server)

Update, November 2026: free-form surfacing

The server now builds surfaces, not only solids, and checks the seams itself. New: patch with G0 / G1 / G2 continuity, loft between surface edges (clamped), sweep along 1–3 rails, round / conic / G2 fillets, measure_continuity (G2 at 0.000002°). 145 tools.

Test pieces: a 1955 Maserati 300S from one side drawing and a 6 m boat, CUBE, from a single photo.

[video: surfacing-final-15mbps.mp4 or the YouTube link https://youtu.be/lPXfhR7Ib30]

### 3c. Images for the existing project (files in `promo/assets/img/contra/`, upload in this order)

| File | Place | Caption |
|---|---|---|
| 01-nes-steel.jpg | after Part 1 | NES, modelled from drawings by the LLM; Cycles render of the exported mesh |
| 02-nikon-f2-steel.jpg | after Part 1 | Nikon F2 with an EL-Nikkor 50 |
| 03-nes-viewport.jpg | after Part 1 | The same NES in Plasticity: native bodies, every step undoable |
| 04-technics-tonearm-viewport.jpg | after Part 1 | Technics SL-1200 MK2 tonearm in the Plasticity viewport |
| 05-maserati-on-drawing.jpg | after Part 2 | Maserati 300S over the 1955 side drawing it was built from (drawing in red) |
| 06-maserati-headlamp-viewport.jpg | after Part 2 | Headlamp bowl blended into the nose: one continuous surface |
| 07-maserati-zebra.jpg | after Part 2 | Zebra: light lines run unbroken across the seams where the surfaces meet in G2 |
| 08-maserati-mesh.jpg | after Part 2 | Mesh density follows the curvature: dense on the fenders, sparse on the flats |
| 09-cube-boat-viewport.jpg | after Part 2 | CUBE, a 6 m boat built from a single photo, at the photo's angle |
| 10-maserati-wire-wheel.jpg | after Part 2 | 36-spoke wire wheel, one linked mesh per wheel |
