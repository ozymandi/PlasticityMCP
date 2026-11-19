# Surfacing spike — Plasticity 26.1.3 Indie (2026-11-19)

All tests ran live in an Untitled document. They used the server's own NativeSession and throwaway scripts (`lab.mjs` and scenarios; not kept in the repository). OK means the operation built the result and `check_bodies` passed. Seams are measured with `measure_continuity` unless noted.

## Enum codes (read from the running app)

| Enum | Values |
|---|---|
| ContinuityType (patch, per edge) | G0 23156, G1 23153, G2 23154 (G3 23155, C1–C3, Free exist) |
| FillHolePreferenceType | Smooth 22370, PreferPlane 22371, PlaneOnly 22372, NonSmooth 22373 |
| FillHoleTopologyType | Multiple 22740 (default), Minimal 22741, Single 22742 |
| FillHoleInternalSmoothnessType | Sharp 24910 (default), Smooth 24911 |
| LoftCurvatureType | Natural 21530, Unconstrained 21531 (default), Clamped 21532 |
| BlendShape (fillet, bridge) | Conic 22201 (default), G2 22202, Chamfer 22203, Chordal 22204, Full 22205 |
| ExtensionShape | Linear 22750, Soft 22751, Reflective 22752, Natural 22753, Arc 22754 |
| ExtensionLimit / BodyExtensionType | Minimal/Outside/Inside 23800-2; Distance/Target/Bbox 22760-2 |
| SweepAlignmentType | Normal 21560, Parallel 21561, Transport 21564 |
| SweepGuideMethod | Point 23250, Chord 23251, Curve 23252 |
| SweepCornerType | Mitre 25700, Round 25701 |
| BlendTrim (bridge) | None 17401, Short 17420, Long 17421, Both 17402 |
| TaperMethod (draft) | Isocline 21847, Curve 21845, Surface 21846, Offset 21848, Normal 21849 |
| FaceGrowType | Auto 24121, Moving 24122, Fixed 24123, None 24124 |
| Imprint/Projection completion | None / Edge / FaceSet |

## Patch (PatchHoleInSheet: hole in a Sheet)

| Case | Result |
|---|---|
| Circle hole, G1 | OK, Plasticity recognises it and builds an exact **Sphere** face (hemisphere); seam G1 |
| Circle hole, G2 | OK, BSurf, 14 mm taller than the G1 cap |
| Circle hole, Single / Smooth (G1, G2) | OK |
| Square hole, G0 | OK, flat |
| Square hole, G1 / G2 (Multiple or Minimal) | OK, but split into **4 triangular BSurf meeting at the centre**; seams G1 / G2 |
| Square hole, G1 + Single or + Smooth | FAIL 22093: corners of the walls meet at 90°, so a single tangent patch is impossible |
| Triangle hole G1, pentagon hole G1 | OK, the patch is split into 3 / 5 faces; seams G1; the triangle cap comes out pointed |
| Mixed per-edge (G2 + G0, G1 + 3×G0) | **Not honoured**: every edge comes out at the highest value given (all G2 / all G1) |
| Code 22372 as continuity | FAIL "Unreachable" (it is PlaneOnly, a fill preference) |
| Guide curve, ends at mid-edge | FAIL `PK_ERROR_grid_not_on_boundary` |
| Guide curve, ends at boundary **vertices** (corner to corner) | OK, the surface follows it and creases along it |
| `factory.curves` (internal curve) | FAIL 22085 |
| Loft end caps deleted and re-patched G1 (aircraft fuselage) | OK, nose and tail close with a bulge. The "90°" seen in the spike was the `measure_continuity` bug. Re-measured after its fix (task 2.2): **near-tangent, 0.04–0.45°**; half of the edges exceed Plasticity's 0.1° G1 tolerance and report G0 |

## Loft

| Case | Result |
|---|---|
| Edge loft (CurveLoftFactory + LoftEdgeCommand), parallel offset tubes, Unconstrained | OK; G1 seams after join (0.008°) |
| Edge loft, 90° elbow, Unconstrained or Clamped with magnitude ≥ 0.75 | FAIL 21555: the tangent is too long and the surface self-intersects |
| Edge loft, 90° elbow, Clamped with magnitude 0.3 / 0.45 / 0.6 | OK; after join seams G1 / G2 (≤ 0.015°); the elbow is visually smooth |
| Edge loft, Natural | OK; no tangency, the tube pinches and twists |
| Edge loft `join: true` | FAIL (Sew_async) — use a separate `join` |
| Region loft `startCurvature` / `endCurvature` / magnitude / simplify | **No effect**: identical result and seam angle (1.775°) in all variants |
| Fuselage through 6 ellipses (closed) | OK, Solid |
| Wing through 2 closed airfoil splines (dihedral + taper) | OK, Solid |

## Revolve / curves

| Case | Result |
|---|---|
| Control-polygon spline, P1 straight above P0, revolved, joined to an open cylinder | **G1 0.0000°** — the most reliable way to a tangent nose / dome |
| Interpolated spline end overshoot | Overshoots beyond the end points (139.89 for an end at 140) — the reason guides miss the boundary |

## Sweep

| Case | Result |
|---|---|
| One rail | OK: the section stretches toward the rail, the opposite side stays |
| Two rails on opposite sides | OK: uniform scaling of the section (±19 in x and y) |
| Three rails | OK: independent control in two directions |
| guideMethod Point / Chord / Curve | All OK; no difference on a simple rail |
| alignment Parallel | OK; Transport FAIL 5014 |
| A rail overrides scale / twist | yes |
| thickness | OK (tube with a wall; bounds asymmetric — not checked) |

## Bridge surface

| Case | Result |
|---|---|
| Gap 10, width 15 / 25 | OK; width 8 (< gap) FAIL |
| Gap 20 with the wall starting 10 up | FAIL 17453 for every option — even the server's own tool fails |
| shape Conic | OK, exact **Cylinder** blend |
| shape Chamfer | OK, plane |
| shape G2 | OK, BSurf |
| shape Chordal / Full | FAIL 5014 |
| trimWalls false | OK, the blend is a **separate Sheet**, walls untouched |
| trimBlend None | OK, blend left longer than the walls |
| trimBlend Short / Long, propagate false, softness 0.3 / 2 | OK; no visible difference in this case |

## Fillet

| Case | Result |
|---|---|
| shape G2 on one edge | OK, seams **G2** |
| shape G2 on a whole box top loop | OK, seams G2 |
| Conic rho 0.3 / 0.8 | OK, BSurf, G1 |
| Chordal, two distances (distance1/2), prolong | Ran but no visible change (two distances probably need filletMode / lockDistances) |
| G2 on 56 edges of the car body at once | FAIL (900 / 16063); round r5 on the same set OK |
| Selecting only sharp edges with measure_continuity (G0 > 5°) | Works as a selector; edges already tangent cannot be filleted |

## Combined objects

| Object | Build | Result |
|---|---|---|
| Rocket | revolve ogive (control polygon) + join to an open cylinder; fins extruded, radial array, union; **G2 root blend r3**; round tips r1; bottom rim r1.5 | Valid, nose G1, root G2. Lesson: union first, then the root blend, then the outer edges; exclude edges of the same radius elsewhere (the bottom rim) from the root selection |
| Aircraft | loft fuselage (6 ellipses) + loft wing (2 airfoils) + mirror + union; **G2 wing-root blend r5** (root edges found as edges between a fuselage face and a wing face, by face-id tails); wing tips round r1 (G2 failed); flat end caps replaced by G1 patches | Valid; root seams G2 |
| Car body | three-view intersection (side × plan × section with tumblehome, outlines filleted first) + round r5 on sharp edges + wheel arches (boolean difference) + wheels | Valid; boxy, as a two-view method gives. Lesson: arches deeper than the body sill cut the body into pieces (body 116 kept only the nose) |
| Pipe elbow | edge loft Clamped, magnitude 0.6, between open tubes + join | Valid; seams G1 / G2 |

## Server / tool findings

1. `measure_continuity` bug: on circles split into three edges it compares points from different ends of the edge — "none", gap 17.32 = chord of 120° (seen 3×), on valid bodies.
2. `boundsMm` of BSurf faces is the control-hull box, not the surface (a G2 loop fillet showed 2 mm beyond the box; difference with the box: "no effect"). Check sizes with a boolean or a section, not with bounds.
3. `bridge_surface` fails on geometry where a 10 mm gap works and a 20 mm gap does not; the hint does not explain it.
4. Region loft end conditions exist but do nothing; do not expose them without a case that works.
5. Per-edge patch continuity exists in the API but the kernel applies the highest value to the whole loop; expose one `continuity` for the patch.

## Parameter audit (server vs Plasticity)

Full list in `parameter-audit.md` (approximate: it looks for `factory.X =`). Unused and worth exposing first, by value for surfacing:
- patch (all four factories): continuity, topology, internalSmoothness, fillPreference, guides (vertex-ended)
- edge loft: curvature (Clamped), startMagnitude / endMagnitude — a new tool or a mode of loft_profiles taking edges
- sweep: guides (rails), alignment, guideMethod, cornerType, thickness
- revolve: guides, thickness
- fillet: shape (G2 / Conic + rho)
- bridge_surface: trimWalls, trimBlend, Conic / Chamfer
- extrude: draft angle (degrees1/2), two-sided distances; pipe: vertexCount, twist; draft: method; hollow: local
- rebuild (curves / faces): degree, spans, point count; deform: scale / offset / flip / mirror
