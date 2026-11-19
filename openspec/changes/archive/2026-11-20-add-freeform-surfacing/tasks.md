# Tasks

All work runs against Plasticity 26.1.3 started through `native_launch`, in an Untitled document. Live checks use `npm run smoke:native` (extended by each group) and `npm test`.

## 1. Enum names

- [x] 1.1 Add `src/native/enums.ts` with name → code maps for the enums in `docs/surfacing-spike.md` (continuity, fill topology / smoothness / preference, loft tangency, blend shape, blend trim, sweep alignment / guide method / corners, taper method), move `BLEND_SHAPE_CODES` there, and verify `npm run build` and `npm test` pass

## 2. Patch (`surface-patching`)

- [x] 2.1 Extend `patch` (native + tool schema) with `continuity`, `topology`, `smoothness`, `fill` and `guideIds` for all four sources. Add the spike's failure hints (22093, `grid_not_on_boundary`). Verify the smoke checks pass: G1 cylinder cap, G2 box cap, flat default, single on a circle, single on a box refused with the hint, corner-to-corner guide, mid-edge guide refused
- [x] 2.2 Check on a lofted fuselage end whether a G1 patch seam measures G1 (the unconfirmed aircraft nose). Record the result in `docs/surfacing-spike.md`, and verify the smoke check states the outcome
- [x] 2.3 Update `docs/coverage.md` (Patch row) and the README tool lines; verify that the documented argument names match the schema

## 3. Edge loft (`edge-loft`)

- [x] 3.1 Add the `loft_edges` tool (`CurveLoftFactory` under `LoftEdgeCommand`): ends as `{ id, edgeId }` or curve ids, `tangency` and `magnitude` per end, hint for 21555. Verify smoke: offset tubes, clamped elbow with magnitude 0.6, magnitude 1.5 refused with the hint
- [x] 3.2 Implement `join: true` as a separate join of the loft to its source Sheets. Verify smoke: the clamped elbow comes back as one body and its seams measure G1 or better (after group 7)
- [x] 3.3 Add `loft_edges` to `docs/coverage.md`, the READMEs and the catalogs (full; compact through `find_tools`); verify the `npm test` catalog checks

## 4. Rails and sweep options (`rail-sweeping`)

- [x] 4.1 Extend `sweep_profile` with `guideIds`, `alignment`, `guideMethod`, `corners` and `thickness`. Verify smoke: one rail widens one side, two rails scale uniformly, round corners on a polyline path, thickness gives a wall
- [x] 4.2 Extend `revolve_profile` with `thickness` (revolve + thicken: the native rail and thickness fields of revolve do nothing — spec updated); verify smoke with a revolved shell 1.5 mm thick, wall inside
- [x] 4.3 Check `guideMethod` chord / curve on a rail that leaves the profile plane at an angle (design open question). Keep or drop the values in the schema by the result, and verify the description says what each does
- [x] 4.4 Update `docs/coverage.md` and the READMEs; verify argument names match

## 5. Blend shapes (`blend-shapes`)

- [x] 5.1 Extend `fillet` with `shape` (`round` / `conic` + `rho` / `g2`) and `chamfer` with `distance2`. Verify smoke: g2 edge measures G2, conic gives a spline face, asymmetric chamfer widths
- [x] 5.2 Extend `bridge_surface` with `shape: "conic"`, `trimWalls`, `trimBlend`. Improve the 17453 hint (gap vs width, walls must meet when extended). Verify smoke: separate blend sheet with `trimWalls: false`, cylindrical face with conic
- [x] 5.3 Update `docs/coverage.md` and the READMEs; verify argument names match

## 6. Feature parameters (`feature-parameters`)

- [x] 6.1 Probe live, one by one: extrude draft / two sides, pipe sides / twist, draft method, hollow local, rebuild controls, deform options. Keep only the values with a visible effect, and verify each kept value with a smoke check
- [x] 6.2 Add the kept parameters to the native layer and the tool schemas with today's defaults; verify `npm test` and the smoke checks from 6.1
- [x] 6.3 Update `docs/coverage.md` and the READMEs, listing the values left out and why; verify argument names match

## 7. Measurement (`continuity-measurement`)

- [x] 7.1 Fix `measure_continuity` to compare both faces at the same 3-D points along the edge. Verify smoke: the joined clamped elbow and the S-bend tube report no "none" seam with a large gap, and a box corner still reports G0 90°
- [x] 7.2 Add `boundsApproximate` to mutation results and listings for bodies with spline faces. Verify smoke: a G2 loop fillet on a box is flagged, a plain box is not
- [x] 7.3 Document both in `docs/coverage.md` and the READMEs; verify the wording matches the output fields

## 8. Modelling guidance (`modelling-guidance`)

- [x] 8.1 Write the intent → tool map over the whole modelling menu and the free-form surfacing section into `skills/plasticity-mcp/SKILL.md` and the user-level copy. The section covers the curve network, control-polygon tangents, patches, edge loft, rails, joining to Solids, when loft through sections still fits, combined recipes and the seam / size checks. Verify every tool name in it exists
- [x] 8.2 Add `modelling_guide` topics `surfacing` and `tools` with the condensed text, and a line in the base text naming them. Verify the catalog test (names exist, topics served) and a stdio call of each topic
- [x] 8.3 Record the Indie-only boundary in both texts; verify no Studio-only command is named

## 9. Integration

- [x] 9.1 Rebuild the MTB saddle (`examples/mountain-bike`) with the new tools and rules as the before / after test: patches and edge loft instead of six D-section lofts. Verify it is valid, has no bulge past 130 mm width (checked by a section, not bounds) and that the screenshots are compared with the old one
- [x] 9.2 Run the full `npm run smoke:native` and `npm test`, restart the MCP client and call one new tool through it; verify all pass
- [x] 9.3 Update `task.md` with the result and the next step; verify it names what is not verified

## Workflow follow-up

- Designer's review of the result, then archive the change with `/opsx:archive`.
