# Proposal

## Why

The skill and the server build free-form objects badly: the rules know one way for a curved form (loft through sections). Loft cannot branch, cannot meet a neighbouring surface tangentially, and bulges between sparse sections (the MTB saddle, the aircraft fuselage of the LongCat run). A spike on Plasticity 26.1.3 Indie (`docs/surfacing-spike.md`) showed that the kernel already offers what is missing. Patches tangent (G1) or curvature-continuous (G2) to their neighbours, loft from edges clamped to the adjacent faces, sweep along rails, and G2 fillets all work there. The server leaves almost all of these parameters at their defaults (`docs/parameter-audit.md`), and the skill never mentions 112 of the 146 tools.

## What Changes

- `patch` gains `continuity` (G0 / G1 / G2), `topology` (multiple / minimal / single), `smoothness` (sharp / smooth), `fill` and `guideIds`, for curves, regions and the edges of one opening (capping every hole of a Sheet at once takes no options — its factory has none). The default stays G0, so existing calls build the same result.
- New tool for loft between body edges (`loft_edges`): two or more boundary edges or curves, with `tangency` per end (natural / free / clamped) and `magnitude` per end.
- `sweep_profile` gains `guideIds` (rails), `alignment`, `corners` and `thickness`; `revolve_profile` gains `thickness` (a shell, made by revolve + thicken, since revolve's own rail and thickness fields do nothing).
- `fillet` / `chamfer` gain `shape` (round / conic with `rho` / g2) and two-distance chamfers; `bridge_surface` gains `shape: conic`, `trimWalls`, `trimBlend`.
- Other unused feature parameters are exposed where the spike or a quick probe shows they work: extrude draft angle and two-sided distance, pipe polygon section and twist, draft method, hollow `local`, rebuild degree / spans / point count, deform scale / offset / flip.
- `measure_continuity` stops reporting "none" with a false gap on edges of circles split into pieces; results state when a body's bounds come from control hulls.
- The skill (`skills/plasticity-mcp/SKILL.md` and the user-level copy) gets a free-form surfacing section. It covers an intent → tool map over the whole command set, curve networks, control-polygon tangents, patches with continuity, combining techniques (patch then boolean, parts by different methods then join), seam checks, and the rules learned on the rocket, the aircraft and the car body.
- `modelling_guide` gets the same material as on-demand topics (`surfacing`, `tools`), so local models can read it without the base text growing.
- Out of scope: xNURBS (XSided, Square, RefitSurface — Studio-only; the licence is Indie); region-loft end conditions (they exist but change nothing); per-edge patch continuity (the kernel applies the highest value to the whole loop).

## Capabilities

### New Capabilities
- `surface-patching`: filling openings with patch surfaces and their continuity, topology, smoothness, fill preference and guide curves.
- `edge-loft`: lofting surfaces between body edges and curves with tangency clamped to adjacent faces.
- `rail-sweeping`: sweep and revolve steered by rails, with alignment, guide method, corners and wall thickness.
- `blend-shapes`: the shape of fillets, chamfers and bridge surfaces (round, conic, G2, chamfer) and bridge trimming.
- `feature-parameters`: the remaining parameters of extrude, pipe, draft, hollow, rebuild and deform.
- `continuity-measurement`: reliable seam measurement and honest bounds of free-form bodies.
- `modelling-guidance`: the modelling rules served by the skill and by `modelling_guide`, now covering every tool and free-form surfacing.

### Modified Capabilities
<!-- none: openspec/specs/ is empty -->

## Impact

- Code: `mcp-server/src/native/{solids,profiles,surfaces,curve-edit,faces,measure}.ts` and the matching `src/tools/*.ts` schemas; `src/tools/guide.ts`; new enum constants beside the existing `BLEND_SHAPE_CODES`.
- Tests: `npm run smoke:native` gains surfacing checks; `catalog.test.ts` (tool names in the guide).
- Docs: `docs/coverage.md`, both READMEs, both skill copies.
- Pinned to Plasticity 26.1.3 like every native tool; the enum codes were read from that build.
- Client restart (Claude Code, LM Studio, OpenCode) to pick up the new schemas.
