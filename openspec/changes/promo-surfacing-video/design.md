# Design

## Context

See proposal.md for why. Constraints that shape the approach:

- Laptop: Ryzen 7 5800H (16 threads), 16 GB RAM, RTX 3050 Laptop 4 GB; Blender 5.3 with the `plasticity` bridge add-on installed; no Octane.
- Models: `examples/maserati-300s/maserati_300s.plasticity` (40 bodies, wire wheels 2 × 36 spokes) and `examples/cube-boat/cube_boat.plasticity` (20 Solids, livery split lines imprinted as faces). Both were saved in Plasticity 26.1.3; the pinned build is still on disk (`C:\Program Files\Plasticitypp-26.1.3`, backup on `E:\Soft`).
- Final render: free Colab, usually a T4 (16 GB VRAM, OptiX), with GPU time limited per day and idle disconnects. The Designer's notebook `Мій диск/Colab Notebooks/blender-render.ipynb` already renders with `gdrive_direct` into a configured Drive folder, with start / end frame fields and OptiX.
- References: the first promo (`promo/videos/plasticity-mcp-16x9/STORYBOARD.md`, HyperFrames templates in `promo/src/16x9/`) for structure; the Spectrum promo (task.md, "ZX Spectrum 128 — Octane animation", `promo/ae/spectrum-cut.aep`) for look, HUD and post stack.

## Goals / Non-Goals

**Goals:**
- Every heavy step is measured on the laptop first, so the split between laptop and Colab rests on numbers.
- The Designer approves at four points: tessellation of close-ups, light, cameras, the edit.
- The edit is built once on previews and never retimed by the final render.

**Non-Goals:**
- Reproducing the Octane look exactly; the Spectrum look is rebuilt in Cycles as close as practical.
- Automating the Colab notebook beyond the fields it already has.

## Decisions

**1. Mesh source: the Plasticity → Blender bridge, not `export_mesh`.** The bridge refacets per object natively (the Designer's choice) and carries Plasticity face ids into Blender, so the boat livery can be assigned per face — `set_material` in Plasticity works per body only. The bridge works over the WebSocket channel on both 26.1.3 and 26.2.1; 26.1.3 is used because the files were saved there. Alternative `export_mesh` (OBJ per body, used for the first promo) has one tolerance per call and loses face ids.

**2. Renderer: Cycles on Colab (T4), not Octane.** Octane needs a licensed server and does not run on Colab. Cycles with OptiX and the OptiX denoiser, adaptive sampling. The Spectrum look carries over as parameters: near-black background, floor albedo ≈ 0.012, specular ≈ 0.12, roughness ≈ 0.8, 10 / 2 / 1 mm floor grid, glossy materials, DOF on fly-throughs only, near clip 1 mm.

**3. One scene per object, shots as markers.** `promo/blender/maserati.blend` and `cube.blend`, each with a studio collection, cameras bound to timeline markers (as in Spectrum), 24 fps. Shot names: `<object>_fly1..3`, `<object>_orbit`. The Colab notebook renders one shot per run by its frame range; output goes to `Мій диск/BlenderRender/plasticity-promo/out/<shot>/`.

**4. Heavy repeated parts as linked duplicates.** The four Maserati wheels (the heaviest bodies) are kept as one mesh with three linked duplicates (mirrored ones by negative scale). RAM and VRAM hold one wheel.

**5. Tessellation by shot.** Fine settings only on parts that a fly-through gets close to; everything else is coarse. The Designer approves the close-up quality on test frames before the light stage.

**6. Previews for the edit.** Each shot is rendered on the laptop as a fast preview (Workbench or EEVEE, 960 × 540, 24 fps, same frame range) and placed in After Effects. Final PNG sequences replace the preview footage (`footage.replace`), so in / out points stay.

**7. Curvature capture.** Zebra / curvature from Plasticity's own display, recorded with OBS (NVENC encoder, 24 fps), a slow turn from one angle rather than a hand orbit; mesh density from Blender's wireframe overlay, recorded the same way or rendered as a viewport playblast. Blender's material preview with a zebra preset is the fallback for the zebra if Plasticity cannot hold a smooth frame rate.

**8. 2D parts in HyperFrames at 24 fps.** Drawing draw-on, tool log, feature cards, sheets and the tool count reuse the first promo's templates (`promo/src/16x9/`, `promo/tools/build.py`, `svgprep.py`) with the Maserati and CUBE SVGs from `examples/*/drawings/`, rendered at 24 fps and placed in After Effects as clips. Rebuilding thousands of strokes with Trim Paths in AE is avoided.

**9. Assembly in After Effects through the kumo MCP, sound in Audition.** The comp follows the Spectrum cut: HUD labels, live timecode at 24 fps, section titles, progress bar, CA / vignette / grain post stack. Music and SFX mixed in Audition to −16 LUFS. Premiere only if a Shorts cut is ordered later.

**Draft running order (≈ 65–70 s, refined at the edit stage):**

```
 0-4    typed prompt + "plasticity-mcp · 145 tools · free-form surfacing"
 4-12   Maserati drawing draws on + tool log
 12-16  Maserati zebra / mesh-density capture
 16-34  Maserati fly1-3 + 360 orbit
 34-40  CUBE drawing draws on + tool log
 40-44  CUBE zebra / mesh-density capture
 44-58  CUBE fly1-3 + 360 orbit
 58-62  surfacing feature cards
 62-66  drawing sheets, "145 MCP TOOLS"
 66-70  lockup + GitHub URL
```

## Risks / Trade-offs

- [4 GB VRAM on the laptop overflows on Cycles test frames] → test at 960 × 540 or a crop region; fall back to CPU (16 threads); full 1080p check on Colab.
- [Mesh too heavy for 16 GB RAM / viewport] → measured in the feasibility check; coarser settings on non-close-up parts, linked wheels.
- [Plasticity viewport cannot hold 24 fps while OBS records] → hide bodies outside the frame during capture; or record at a lower rate and conform; Blender zebra fallback.
- [Free Colab GPU time: ≈ 890 frames (both objects at 24 fps) at ~20 s each is ≈ 5 GPU-hours, several days of sessions] → per-shot runs, resumable output, samples tuned on the first Colab test frame; shorten fly-throughs to ≈ 2.5 s if needed.
- [Drive space: PNG frames ≈ 1–2 MB each, ≈ 3–5 GB in total] → check free space before the final render.
- [Cycles look differs from Octane] → accepted; the Designer fine-tunes light and materials on laptop test frames.
- [Camera changes after approval break the edit] → ranges locked by the spec; light and materials remain free.

## Migration Plan

None: new files only. Rollback is deleting the new scenes and renders.

## Open Questions

- Which three details each fly-through shows (proposed: Maserati headlamp, wire wheel, cockpit; boat canopy and mast, outboards and prop, the engraved "CUBE") — settled at the camera stage.
- Exact durations of each section — settled at the edit stage.
- Music: a new Suno track or another source — settled before the sound stage.
