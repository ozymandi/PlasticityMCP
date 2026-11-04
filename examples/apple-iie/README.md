# Apple IIe workstation (1983)

Built in Plasticity 26.1.3 through the MCP server on 2026-11-04, from photos and published
dimensions: the computer, the Monitor II beside it on the left and an AppleMouse on the right.
No Disk II. 138 solid bodies in three groups: Computer (101), Monitor (29), Mouse (8). Overall
993 x 493 x 270 mm, including the mouse cable. No materials: the parts read through geometry.

An unaffiliated modelling example. Apple, the Apple logo and Apple IIe are trademarks of Apple Inc.

Files: `apple-iie.plasticity`, `apple-iie.step`, `view-*.png` (six axis views plus four
isometrics), `detail-*.png`, `drawings/` (hidden-line SVG drawings
`apple-iie-{front,back,left,right,top,bottom,isometric,sheet}.svg` from `export_drawing`, 1 unit = 1 mm,
and `apple-iie-presentation.png`, the seven single views rasterised in one column),
`source/` (what generated the key layout and the legends, below).

All screenshots, the isometrics and details too, were taken with X-ray on in the viewport, so
inner edges show through the housings. The shape is easier to read in the drawings or in Plasticity.

## Dimensions and where they come from

| Item | Value | Source |
|------|-------|--------|
| Computer | 387 x 451 x 108 mm | Vectronics, 15.25 x 17.75 x 4.25 in |
| Monitor | 370 x 318 x 270 mm; the model is 322 deep with the rear hood | Apple document for the Monochrome Monitor IIe, quoted on the 68kmla forum; width matches photos; estimate |
| Mouse | 56 x 98 x 30 mm | Retro Tech Collection entry for A2M2070; proportion matches a photo of the M0100; estimate |
| Key pitch | 19.05 mm | keyboard width about 0.70 of the case on photos; estimate |
| Keyboard panel slope | 10.77 degrees | read off a side photo; estimate |
| Side silhouette: front edge, step start, lid plane | Z 30; Y 210, Z 70; Z 108 | side photo; estimate |
| Keys | 63, US layout, 5 rows plus Reset in its own recess | count on photos, total from Apple Rescue of Denver |
| Computer rear | 12 numbered knockouts, DE-9 with standoffs, RCA, 2 mini-jacks, IEC with pins, power switch, I/O marks | photo; sizes and positions estimated |
| Monitor rear | niche, 2 fields of 22 vent slots, hood with badge, lower panel with IEC, 3 knobs and RCA | photo; estimate |
| Screws | 32 | photos show only those of the monitor niche and the sockets; the rest are estimated places |

Rejected: 280 x 255 x 380 mm (Science Museum) and 330 x 305 x 241 mm (Tempe) for the monitor do
not match its width on photos.

Reference photos are not copied here: all are on Wikimedia Commons (CC BY or CC BY-SA), for example
[Apple IIe](https://commons.wikimedia.org/wiki/File:Apple_IIe.jpg),
[the keyboard](https://commons.wikimedia.org/wiki/File:Apple_IIe_keyboard_detail_(398576947).jpg),
[the rear](https://commons.wikimedia.org/wiki/File:Iie-rear.jpg),
[the system with monitor](https://commons.wikimedia.org/wiki/File:Apple_IIe_%2B_Disk_II_drives_%2B_Apple_Monitor_II.JPG),
[Macintosh mouse M0100](https://commons.wikimedia.org/wiki/File:Apple_Macintosh_Mouse_M0100.jpg).

## Details

- Legends on 62 keys, the Open and Closed Apple marks included, are cut as geometry, chamfered 0.07 mm:
  a Google font (Arimo Regular) is turned into SVG with `fontTools`, imported with `import_svg`,
  its regions extruded and subtracted. About 2040 edges were chamfered. Only the space bar has no legend.
- The keyboard was built flat, then tilted to the panel slope as one group.
- Badge: `apple` and `e` in Arimo Bold; the apple and `//` are drawn as outlines.
- Parting lines of the computer and the monitor are chamfered.

`source/`: `keyboard_layout.py` writes `keyboard_layout.json`; `make_legends.py` writes `legends.svg`,
with `--badges` the `badges.svg` and `badge_monitor.svg`, with `--panel` the `panel_digits.svg` and
`panel_power.svg`. The font is under the SIL Open Font License, `source/fonts/OFL.txt`.

## Known limits

- Legend outlines without a chamfer, kernel error 16065 on segments of about 0.005 mm: control (1),
  return (2), reset (1), the inner outline of 4.
- Smaller chamfers: N 0.05 mm, M 0.03 mm; some outlines on shift, caps lock, return, tab and backtick
  0.03 mm, on 2 and control 0.05 mm. Segments under 0.05 mm are skipped on 11 keys and, at 0.02-0.04 mm,
  on the badge.
- `key_Tab`: the top of the body is 0.05 mm proud; the body is valid.
- No chamfers: the 48 vent slots of the computer, the cable hole, the rear panel digits and I/O marks,
  the seat of the right IEC screw on the computer, which runs into the socket chamfer.
- The parting line chamfers on the base and on both monitor parts are lofted ring cutters, because
  `chamfer` left spikes at the corners. Bounds grew by up to 0.3 mm and go about 0.03 mm below the
  table. Not inspected up close.
- The computer rear panel is 46 mm high against about 75 mm on the photo: changing it needs a change
  to the underside of the lid.
- Key tops are flat; the real ones are slightly concave.
- A 20 x 30 mm boss on the right side of the monitor adds 2 mm to its bounds.
- Every body passes `check_bodies`. Two unused test materials stay in the document: the server has no
  command to delete them, and no body uses them.

## Left out

Disk II, inner parts, monitor and power cables, rear stickers and small rear text, plastic texture,
the embossed mouse badge, feet under the base, icons next to the monitor buttons.
