# Proposal

## Why

The free-form surfacing release (patch G1 / G2, `loft_edges`, rail sweeps, G2 fillets, honest `measure_continuity`) has no promo yet, and the first promo (2026-10-13) shows only prismatic parts. The Maserati 300S and the CUBE boat, both built on 2026-11-20 with the new tools, are the first real free-form objects and show the release best. The laptop is too weak for a final Cycles render (RTX 3050 4 GB), so the heavy part goes to free Google Colab (T4).

## What Changes

- New YouTube promo, 16:9, 1920 × 1080, **24 fps** (60 fps was the first plan; changed to 24 by the Designer on 2026-11-20 to cut render time 2.5×), ~65–70 s. Structure follows the first promo (typed prompt → drawing draws itself with a tool log → 3D → feature cards → drawing sheets → tool count → outro); the look follows the Spectrum promo (Blender animation, After Effects HUD labels and section titles, chromatic aberration, vignette, grain, music bed).
- The release is the subject: each object gets a curvature / zebra capture that shows the CAD surface and that the mesh density follows curvature.
- Per object (Maserati first, then the boat): mesh export from Plasticity 26.1.3 through the Plasticity → Blender bridge with tessellation set per part, a studio scene (base light by Claude, fine-tuned by the Designer), several detail fly-through cameras and one 360° orbit.
- Work is split into five stages with an approval gate before the final render: (1) 3D, (2) curvature capture, (3) edit on previews in After Effects + Audition, (4) approval, (5) final Cycles render on Colab, PNG sequences to G:, swapped into the edit.
- A measured feasibility check on the laptop comes first (triangle count, RAM / VRAM, viewport speed, one Cycles test frame) and decides how much of the work stays local.
- Out of scope: a 9:16 Shorts cut (decided after the 16:9 is approved), Octane (not available on Colab), assembly animations and loft-growing animations in 3D, any change to the MCP server or the skill.

## Capabilities

### New Capabilities
- `promo-render-pipeline`: how promo scenes are prepared, previewed and rendered — self-contained Blender scenes, per-part tessellation, 24 fps camera shots with fixed frame ranges, resumable headless frame rendering on Colab into a folder on Google Drive, and preview footage that the final frames replace in the edit without retiming.

### Modified Capabilities
<!-- none: no server or skill behaviour changes -->

## Impact

- New files under `promo/`: Blender scenes (`promo/blender/maserati.blend`, `cube.blend`), render / setup scripts in `promo/tools/`, an After Effects project in `promo/ae/`, OBS captures and preview clips under `promo/assets/video/`, audio under `promo/assets/audio/`. Renders and videos stay gitignored as before.
- Google Drive: approved scenes and PNG output under `Мій диск/BlenderRender/plasticity-promo/`; the Designer's existing Colab notebook `Colab Notebooks/blender-render.ipynb` is reused with Blender 5.3.
- Tools in use: Plasticity 26.1.3 (pinned build), Blender 5.3 with the `plasticity` bridge add-on, OBS, HyperFrames (2D parts at 24 fps), After Effects through the kumo MCP, Audition; Premiere only if a Shorts cut is made.
- No change to `mcp-server/`, `skills/` or `openspec/specs/` beyond the new capability.
