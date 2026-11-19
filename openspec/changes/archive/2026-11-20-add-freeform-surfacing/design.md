# Design

## Context

Every native tool builds a factory inside a native command (`commandFunction` in `src/native/snippets.ts`), sets fields on it and commits. The factories are found by binding name in the app module closure of Plasticity 26.1.3. The spike read every factory's settable fields and the enums behind their numeric codes from the running app. It then tried them live: `docs/surfacing-spike.md` lists what each value does, and `docs/parameter-audit.md` lists what the server sets today. See proposal.md for the motivation.

Facts from the spike that shape the design:
- All four patch factories take the same fields (`continuity`, `topology`, `internalSmoothness`, `fillPreference`, `tolerance`); only the Sheet-hole factory takes `guides`, and a guide must end at vertices of the boundary.
- Per-edge patch continuity exists in the API, but the kernel applies the highest value to the whole loop.
- Edge loft is `CurveLoftFactory` run under `LoftEdgeCommand` with `profiles` = edges; `curvature` is a `LoftCurvatureType` (Natural / Unconstrained / Clamped) and `startMagnitude` / `endMagnitude` scale the clamped tangent. Its `join: true` fails in the sewing step.
- Revolve is a sweep internally: the same fields as `SweepFactory` (guides, alignment, guideMethod, cornerType, thickness).
- `measure_continuity` compares wrong points on circles split into several edges; `boundsMm` of BSurf faces is the control-hull box.

## Goals / Non-Goals

**Goals:**
- Every parameter the spike proved useful is reachable through a tool argument with a readable name, never a numeric code.
- Existing calls keep their results: every new argument defaults to the native default the server relies on today.
- The modelling rules teach when to use each technique and how to combine them, from evidence.

**Non-Goals:**
- No Studio-only factories (xNURBS), not even as refused tools.
- No per-edge patch continuity.
- No new "surface network" macro tool (a curve grid → N patches in one call); the skill composes it from `patch` and `loft_edges` for now.

## Decisions

1. **Names, not codes.** Enum codes live in one module (`src/native/enums.ts`), next to the existing `BLEND_SHAPE_CODES`, keyed by the names the tools expose: `continuity: "G0" | "G1" | "G2"`, `tangency: "natural" | "free" | "clamped"`, and so on. *Alternative:* pass codes through — rejected, because the codes are build-specific and meaningless to a model.
2. **One `continuity` per patch.** The tool takes one value and sets it on every edge. *Alternative:* a per-edge map — rejected: the kernel ignores the differences (spike, boxes 8 and 14), and a per-edge argument would promise behaviour that does not happen.
3. **A new `loft_edges` tool instead of extending `loft_profiles`.** Edge loft runs a different factory and command and takes edges, not curves; mixing them would make `loft_profiles` argument rules hard to state. `loft_edges` takes `{ id, edgeId }` ends (and also curve ids). It joins the result to the source Sheets with a separate join step when `join: true`, since the factory's own join fails. *Alternative:* one loft tool with a mode switch — rejected for clarity of the schema.
4. **Region-loft end conditions are not exposed.** They are accepted and ignored by the kernel in every tried case. Exposing them would mislead.
5. **Hints from the spike.** When a call fails with a known kernel code, the error carries what the spike learned:
   - edge loft 21555 → "lower `magnitude`";
   - patch 22093 → "Single / Smooth with G1 need a smooth boundary without corners";
   - patch `grid_not_on_boundary` → "guides must end at boundary vertices";
   - bridge 17453 → "the gap is too large for the width or the walls do not meet when extended".

   This follows the existing `withHint` pattern.
6. **`measure_continuity` fix.** For each edge, sample both faces at the same 3-D points, taken from the edge's own curve and projected to each face, instead of pairing parameters. Report `"G0"` with the real angle when the edge is a true crease. *Alternative:* drop the edge from results — rejected: it hides real problems.
7. **Bounds honesty.** Mutation results keep `boundsMm` but add `boundsApproximate: true` when the body has spline faces. The skill says to check sizes of free-form bodies with a boolean or a section. *Alternative:* compute exact bounds from a fine mesh — possible later (`refacet`), but slow on large bodies.
8. **Guide topics.** `modelling_guide` gets topics `surfacing` (techniques, recipes, combinations, failure hints) and `tools` (the intent → tool map). The base text grows by one line pointing to them. The catalog test checks that every tool name in the topics exists.

## Risks / Trade-offs

- [Enum codes are tied to 26.1.3] → they sit in one module and `native_status` already refuses other versions.
- [Untested parameter values (Chordal fillet, guideMethod Chord / Curve, two-distance fillet) may do nothing] → expose only values with a visible effect in the spike or in a smoke check added by this change; the rest stay hidden and are listed in `docs/coverage.md`.
- [Larger schemas cost tokens in the full catalog] → keep descriptions short; the compact catalog lists the new tools through `find_tools` only.
- [The skill and `guide.ts` can drift] → the existing note in both, plus the catalog test on tool names.
- [The patched aircraft nose was not confirmed G1] → a smoke check measures a patch seam on a lofted end before the skill recommends that recipe.

## Migration Plan

Additive. Defaults equal today's behaviour, so no caller changes. After merge: rebuild, restart the MCP clients (Claude Code, LM Studio, OpenCode), run `npm run smoke:native` on 26.1.3. Rollback: revert the commit; no data or document format changes.

## Open Questions

- Whether `guideMethod` Chord / Curve differ from Point on a rail that crosses the profile plane at an angle (the spike only tried a planar rail); this decides only a line in the tool description.
