# ZX Spectrum 128 "toastrack" (1985)

Built in Plasticity 26.1.3 through the MCP server on 2026-10-25, from photos and published
dimensions. 116 bodies in five groups: Case (upper, lower, heatsink), Keys (58),
Connectors (81: sockets, pins, insulators, 56 gold edge-connector fingers, 12 BT contact blades), Hardware (feet, folded legs, 8 screws), Decals (red lettering, badge stripes).

Files: `zx-spectrum-128.plasticity` (final), `zx-spectrum-128_blocking.plasticity` (blocking
stage), `zx-spectrum-128.step`, `view-*.png` (six axis views in X-ray plus four isometrics),
`detail-*.png`, `drawings/` (hidden-line SVG drawings `spectrum-{front,back,left,right,top,bottom,isometric,sheet}.svg` from `export_drawing`, 1 unit = 1 mm, and `spectrum-presentation.png`, all eight rasterised in one column), `reference/` (five photos, see `reference/SOURCES.md`).

## Dimensions and where they come from

| Item | Value | Source |
|------|-------|--------|
| Case without heatsink | 319 x 151 x 39 mm, feet +2 | Wikipedia (Spectrum+ 319 x 149 x 38), Sinclair Collection (344 x 151 x 41 with heatsink) |
| Heatsink projection | 25 mm | 344 - 319 |
| Heatsink fins | 24 fins, 6 mm pitch, 1.5 mm thick, 140 mm long, 36 mm high, notch 16.5 x 15.5 at the bottom inner corner | counted on photos; notch from the Designer's sketch; estimate |
| Keys | 58 in 5 rows, pitch 20 x 18 mm, cap 18 x 16, plate 1.5 mm above the surface, finger pad on the front half: D-shaped, 13 mm wide, 1.2 mm high, R0.5; pill-shaped on the wide keys | Sinclair Wiki (58 keys); pitch and pad shape read off the photos, heights estimated |
| Keyboard well | 269 x 98 mm, 3 mm deep, 6 mm from the left, 31 from the rear, 22 from the front | top photo; estimate |
| Rear, left to right from behind | vent slots (36, open through the top edge), 9 V DC, edge connector slot 76 x 5 with gold fingers, RGB 8-pin DIN, TV phono | photo, user manual |
| Left end, front to back | KEYPAD and RS232/MIDI (BT631), RESET, MIC, EAR | service manual / user manual; order estimated |
| Underside | 8 screws, 4 rubber feet, 2 retractable legs (modelled folded) | service manual parts list 5.3; positions estimated |
| Parting line | 13 mm above the bottom, 0.3 mm gap with 0.4 chamfers on both sides | estimate |
| Edges | case R2, well rim R0.5, key plates R0.8, pads R0.5, holes 0.5 chamfer, vent slots 0.3 chamfer, fins 0.3 chamfer | design choice |

## Left out

Key legends (the printed letters and keywords), the surface texture, the internals except the
PCB edge in the expansion slot, cables, the external keypad. The "sinclair" and "ZX Spectrum"
lettering and "128K" use Plasticity's built-in font, not the Sinclair typeface.
