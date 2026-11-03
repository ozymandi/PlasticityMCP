# Refractor telescope on a tripod, 70/900

Built in Plasticity 26.1.3 through the MCP server on 2026-11-03, from profiles drawn in place and
published specifications. The prototype is the Celestron AstroMaster 70AZ, but the model is not a
copy of it: most sizes are estimates. 160 solid bodies in seven groups: optical_tube (15),
focuser_and_eyepiece (23), mount (8), tripod (25), finder (20), tray_spreaders (29), small_screws (40).
Overall 955 x 717 x 1347 mm, with the tube raised 25 degrees.

Files: `telescope.plasticity`, `telescope.step`, `view-*.png` (six axis views in X-ray plus four
isometrics), `detail-*.png`, `section-*.png` (the optics and internals cut through the tube axis),
`drawings/` (hidden-line SVG drawings `telescope-{front,back,left,right,top,bottom,isometric,sheet}.svg`
from `export_drawing`, 1 unit = 1 mm, and `telescope-presentation.png`, all eight rasterised in one column).

## Dimensions and where they come from

No drawing of the prototype was available, and the product pages could not be opened: the
specifications are from search result texts only.

| Item | Value | Source |
|------|-------|--------|
| Aperture, focal length | 70 mm, 900 mm | B&H, Skroutz listings |
| Tube, dew shield front to focuser rear | 914 mm | one listing (others give 890 and 571); read this way so that the focus lands at the eyepiece |
| Leg diameter | 31.75 mm | one listing |
| Tripod height with mount | 813-1295 mm | one listing |
| Diagonal and eyepiece fit | 31.75 mm | 90AZ listing; assumed for the 70AZ |
| Tilt axis height | 1100 mm | estimate within the range above |
| Tube outer diameter | 76 mm | estimate |
| Dew shield | 88 x 130 mm | estimate |
| Focuser body | 45 x 90 mm | estimate |
| Focuser knobs | 22 mm | estimate |
| Foot circle | about 900 mm | estimate |
| Mount, tube rings, pan handle, tripod head, tray | by proportion | estimate |
| Objective | air-spaced doublet, 71 mm lenses, 70 mm clear aperture, threaded retaining ring (1 mm pitch) | clear aperture from the listings; curvatures and thicknesses are estimates, not an optical design |
| Eyepiece | field stop, two identical cemented pairs, 32.8 mm | estimate |
| Focus | 900 mm along the folded light path ends at the field stop, within 5 mm, focuser retracted | built to this |
| Finder | red-dot, 127 x 31.75 x 60.32 mm, lens 23 mm, CR2032 on top | shape from a StarPointer photo; overall size and lens from search results; internals and knob positions estimated |
| Spreader fastening | split clamp on the upper leg, 5 x 11 mm strip on two bolts, hub 100 mm | a typical design, not checked against the prototype; estimate |
| Seating gaps | 0.2-0.4 mm, sockets chamfered 0.3 mm | design choice |

## Details

- Separate parts are seated in sockets with a small gap instead of being pushed into each other.
- Pan handle grip: a rubber sleeve with a pyramid pattern, made flat and deformed onto the wall with `unwrap_faces` and `deform`.
- Knobs: zig-zag knurling.
- Tube ring: neutral engraving `D=70 F=900`, 0.4 mm deep, chamfered.
- Focuser: rack on the drawtube, 12-tooth pinion on the knob axis.

## Known limits

- Rack and pinion teeth overlap where they mesh, and screw shanks overlap the parts under their heads.
- The thread on the retaining ring is a separate body: uniting it failed with kernel error 21653.
- The junction of the finder bracket with the finder body has no bevel.
- The inner junction of the ring strap and the lens rim have no bevel; other parts cover them.
- Nothing moves: every part stands in its working position.

## Left out

Brand logos, a second eyepiece, a smartphone adapter.
