# Tasks

Plasticity runs as the pinned 26.1.3 build; Blender 5.3 with the `plasticity` bridge add-on. Each group ends with a short entry in `task.md` (status, findings, next step). Designer approvals are tasks of their own and are ticked only on the Designer's word.

## 1. Feasibility check on the laptop

- [x] 1.1 Open `maserati_300s.plasticity` in Plasticity 26.1.3, connect the bridge from Blender 5.3 and refacet all bodies at a fine setting; verify by recording the triangle count, Blender RAM and GPU memory use, and viewport frame rate while orbiting
- [x] 1.2 Render one Cycles test frame 960 × 540 with OptiX on the laptop (CPU if it runs out of VRAM); verify by recording the time per frame and the device used, and save the frame under `promo/renders/surfacing/test/`
- [x] 1.3 Report the numbers to the Designer with the proposed laptop / Colab split, and record them in `task.md`

## 2. Maserati scene

- [x] 2.1 Set tessellation per part (fine on close-up parts, coarse elsewhere), replace the four wheels with one mesh and three linked duplicates, save `promo/blender/maserati.blend`; verify by triangle count before / after and a close-up test frame without visible facets
- [x] 2.2 Designer approves the close-up tessellation on the test frames
- [ ] 2.3 Build the base studio in Cycles (Spectrum parameters: near-black world, floor albedo ≈ 0.012 with the 10 / 2 / 1 mm grid, area lights, glossy materials mapped from the Plasticity material names); verify with a 960 × 540 test frame from the orbit angle
- [x] 2.4 Designer fine-tunes the light and materials and approves the look
- [x] 2.5 Set 24 fps and the shots `maserati_fly1..3` and `maserati_orbit` (cameras on markers, DOF on fly-throughs, near clip 1 mm); verify by listing each shot's camera and frame range, and by a Workbench playblast of every shot
- [x] 2.6 Designer approves the cameras and fly-through paths
- [x] 2.7 Tune the render settings (samples, adaptive threshold, denoiser, light paths) on laptop test frames of every shot; verify by test frames of each shot and the time per frame, recorded in `task.md`

## 3. CUBE boat scene

- [x] 3.1 Open `cube_boat.plasticity`, bridge into Blender with tessellation per part, assign the livery colours to the imprinted faces on both sides, save `promo/blender/cube.blend`; verify by a test frame of each side showing matching livery and a smooth close-up of the engraved "CUBE"
- [ ] 3.2 Designer approves the close-up tessellation
- [x] 3.3 Build the base studio (same look as the Maserati scene, scaled to a 6 m object); verify with a 960 × 540 test frame
- [ ] 3.4 Designer fine-tunes the light and materials and approves the look
- [x] 3.5 Set 24 fps and the shots `cube_fly1..3` and `cube_orbit`; verify by the shot list and a Workbench playblast of every shot
- [x] 3.6 Designer approves the cameras and fly-through paths
- [x] 3.7 Tune the render settings on laptop test frames of every shot; verify by test frames and time per frame recorded in `task.md`

## 4. Curvature capture

- [x] 4.1 Test OBS (NVENC, 24 fps) on Plasticity's zebra / curvature view with the full Maserati; verify by checking the recording for dropped or repeated frames, and decide with the Designer between full scene, hidden bodies, 30 fps conformed, or the Blender zebra fallback — done in Blender instead (Designer's choice 2026-11-21): `promo/tools/render_zebra.py`, design-studio light tunnel on black clearcoat + the same with 1 px triangle edges, 96 frames per object, crossfaded in the 4 s slots; no OBS capture
- [x] 4.2 Record the zebra / curvature clip and the mesh-density clip (Blender wireframe) for the Maserati; verify both play at 24 fps without stutter, saved under `promo/assets/video/` — see 4.1
- [x] 4.3 Record the same two clips for the boat; verify the same way — see 4.1

## 5. 2D parts at 24 fps

- [x] 5.1 Prepare the Maserati and CUBE drawing SVGs with `promo/tools/svgprep.py` and new HyperFrames templates (prompt, two drawing draw-ons with tool logs, surfacing feature cards, sheets, "145 MCP TOOLS", outro) in a new `promo/src/surfacing/`; verify `npx hyperframes check` passes
- [x] 5.2 Render each 2D section at 1920 × 1080, 24 fps; verify frame rate and duration of every clip with ffprobe

## 6. Previews and edit

- [x] 6.1 (superseded: the final PNG sequences were rendered before the edit, so the cut uses them directly; no previews) Render a preview of every 3D shot on the laptop (Workbench or EEVEE, 960 × 540, 24 fps, same frame range); verify each preview's frame count equals its shot range
- [x] 6.2 Build the After Effects project `promo/ae/surfacing-cut.aep` (1920 × 1080, 24 fps): sections in the draft running order, HUD labels, timecode at 24 fps, section titles, progress bar, CA / vignette / grain post stack as in the Spectrum cut; verify by frame captures of every section boundary — built 2026-11-21 (comps "Surfacing video" / "Surfacing composite" / "Surfacing cut", 81 s, HUD and post carried over from the Spectrum cut); zebra slots hold placeholders until group 4; checked with `promo/ae/check/surf3_sheet.png` and `surf4_sheet.png`
- [x] 6.3 Choose and mix the music bed and SFX in Audition to −16 LUFS integrated; verify by a loudness measurement of the mixdown, then place it in the comp — `promo/audio/surfacing-mix.wav`, −16.0 LUFS / −1.3 dBTP, music A + 42 SFX (see task.md)
- [x] 6.4 Export a review render of the whole cut from the previews; verify duration, 24 fps and audio with ffprobe — from the final frames, `promo/videos/surfacing/surfacing-review.mp4` (+ 15 Mbps copy): 81.000 s, 24 fps, 1944 frames, −16.1 LUFS

## 7. Approval

- [x] 7.1 Designer approves the edit and the camera timings; record in `task.md` that camera motion and frame ranges are now locked — approved 2026-11-21 ("Апрув") on the review render; camera motion and frame ranges locked

## 8. Final render on Colab

- [ ] 8.1 Pack all textures into the approved scenes, copy them to `Мій диск/BlenderRender/plasticity-promo/`, and check free Drive space for ≈ 3–5 GB of frames; verify the .blend opens on headless Blender 5.3 on Colab without missing files
- [ ] 8.2 Render one 1920 × 1080 frame of the slowest shot on the Colab T4 with the Designer's notebook; verify time per frame and that it matches the laptop test frame, and adjust samples if the total does not fit
- [x] 8.3 Render the Maserati shots, one run per shot, into `out/<shot>/`; verify every shot folder has exactly its frame count with no gaps (resume after any disconnect) — done on the laptop before the edit (Designer's word, 2026-11-20) into `promo/renders/surfacing/final/`; 84/84/84/192 frames, 0 empty; one stop at frame 432 resumed
- [x] 8.4 Render the boat shots the same way; verify the same way — fly1–fly3 on the laptop, orbit frames 253–409 on the Colab T4 (packed copy, Blender 5.3.0) and 410–444 on the laptop; 84/84/84/192 frames, 0 empty; no step at the seam (409→410 difference equals neighbouring frames). This also covers 8.1 / 8.2 for the boat only; the Maserati never went to Colab
- [x] 8.5 Replace the previews in `surfacing-cut.aep` with the final PNG sequences; verify in / out points are unchanged and capture frames at every 3D section — n/a: the cut was built on the final PNG sequences from the start (no previews)
- [x] 8.6 Render the final mp4 (H.264, 1920 × 1080, 24 fps, audio at −16 LUFS) to `promo/videos/surfacing/`; verify with ffprobe and a full watch by the Designer, then record the result in `task.md` — the approved review render is the final: `promo/videos/surfacing/surfacing-final.mp4` (810 MB master) and `surfacing-final-15mbps.mp4` (154 MB), 81.000 s, 1944 frames, 24 fps, −16.1 LUFS

## Workflow follow-up

- Decide on a 9:16 Shorts cut after the 16:9 is approved.
- Archive the change after the Designer accepts the final video.
