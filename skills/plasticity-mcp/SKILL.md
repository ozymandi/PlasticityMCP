---
name: plasticity-mcp
description: Model real CAD geometry in a running Plasticity window through the Plasticity MCP server (tools mcp__plasticity__*: native_connect, create_*, extrude_profile, boolean, fillet, chamfer, cut, get_body_topology, …). Use whenever the user asks to build, edit, measure or export a part or a model in Plasticity, to model something from a drawing or a description, or mentions Plasticity MCP.
metadata:
  version: "1.4.0"
  author: ozymandi
---

# Plasticity MCP

Own MCP server for Plasticity 26.1.3 (repository `ozymandi/PlasticityMCP` on GitHub). It builds native
B-Rep geometry through Plasticity's own commands, so every step lands in Plasticity's undo
history. What each Plasticity command maps to, and what is not available:
`docs/coverage.md` in the repository.

The server serves a condensed copy of these rules to clients without the skill (tool
`modelling_guide`, `mcp-server/src/tools/guide.ts`): when a rule changes here, change it there.

## Modelling rules (from the user)

### Order of work

The user's words: first blocking, then refining; the merge pass is the last step of the
forms; the smallest details — knurling, decals, inscriptions, screws, threads — are the last
step of detailing.

1. **Blocking.** The main volumes in the right proportions and places, as simple bodies.
   Check them against the drawing (front, top, side screenshots) before going further.
   Choose the way to build each form by its kind, not by what is quickest to call: straight
   walls — a closed outline and `extrude_profile`; round — a half section and
   `revolve_profile`; sections that change along the length — closed sections at several
   stations and `loft_profiles`; one section along a path — `sweep_profile`; a symmetric
   form — one half, `mirror_bodies`, union; a free form that branches or must flow
   tangentially into another — curves and patches (see "Free-form surfacing"). Boxes and
   cylinders are only for boxy and round parts.
   **Seating pass — one more iteration right after blocking (the user's rule).** A part that
   goes into another is not simply poked into it. Copy the inserted part, scale the copy up a
   little (`copy_bodies`, `scale_bodies` with the pivot on its axis, about 3–10 % so that the
   gap is 0.2–0.5 mm on a hand-sized part), `boolean` difference it from the receiving part,
   then seat the original in the socket. The gap gives extra visible edges and a thin shadow
   line, which reads like a real assembly. It applies to parts that stay separate (shanks,
   shafts, pins, bushings, screw-in parts); parts to be united in the merge pass still run
   into each other. A shank fully hidden under a screw head needs no socket. Every socket
   gets a small chamfer on its rim right after it is cut (about 0.2-0.4 mm on a hand-sized
   part; the user's rule): pick the rim with a thin `box` on `get_body_topology`.
2. **Refining.** The details, and the edges: see "No bare edges" below.
3. **Merge pass — the last step.** Go through the finished model, find the parts that should
   be one piece, `boolean` union them, and put a chamfer / bevel on the edges where they meet.
   - One piece: fixed parts that touch and belong to the same real part or casting (a
     housing and its bosses, ribs, lugs and sockets).
   - Stay separate: moving parts (whatever turns, slides or is pressed), removable parts
     (covers, lids, fasteners), parts that are a different piece on the real object. When in
     doubt, ask in the brief.
   - The junction edges exist only after the union, on a body that is already detailed.
     Pick them with the filter of `get_body_topology` — `include: "edges"` plus a thin `box`
     around the plane or the line of the junction, and `kinds` when it helps — never with a
     full listing.
   - Build the parts so that the junction
     comes out clean: let a part run a little into the one it joins, and do not round a rim
     that will end up buried in the junction (a rounded rim lying on a flat face gives a
     cusp that cannot be chamfered).

4. **Fine detail — the very last.** Only when the forms, the edges and the merge pass are
   done:
   - **Knurling / ribs on knobs, handwheels and rings.** Real knobs have small ribs; a smooth
     cylinder is not a finished knob. Two ways, both named by the user: with booleans (one
     small cutter on the rim, `array_radial` around the axis, `boolean` difference — or,
     cheaper, one cutter for the whole band: a closed zig-zag polyline around the knob
     (points alternating a little outside and a little inside its radius) plus a circle
     around it, the ring between them from `list_regions` extruded to the band height, one
     `boolean` difference; the same cutter is reused with `copy_bodies` on knobs of the
     same radius), or
     through unwrap (flatten the face with `unwrap_faces`, make the pattern flat, wrap it
     back with `deform`) — the second for patterns that do not simply run along the axis.
   - **Pyramid grip on a round handle (the user's method).** `unwrap_faces` of the grip
     wall gives a flat Sheet at the origin. On it build a thin plate that straddles the Sheet
     with one row of small pyramids (`loft_profiles` from a square to a very small square,
     `array_rectangular`), union the row, array the rows, union them into the plate. `deform`
     that one body from the Sheet's face onto the wall: it becomes a grip sleeve. Hundreds of
     separate pyramids would flood the output and every later call. Delete the Sheet.
   - **Engraved text gets a chamfer on its rim** (about 0.05-0.1 mm; the user's rule). Letters
     from `create_text` can hold a tiny segment that makes the whole call fail: find it in
     the edge list and leave it out of the chain.
   - **Inscriptions and decals** (markings, scales, numbers, labels). On a
     flat face: text, letter regions extruded, `boolean` difference. On a cylinder:
     `unwrap_faces` of the wall (do it while the body is still simple) gives a flat Sheet
     at the origin; make the letters there as solids that straddle the Sheet (text drawn
     0.3 below it, extruded 0.6); `deform` them from the Sheet's face onto the wall; read
     from the returned bounds where and which way up they landed — the Sheet's axes may
     map reversed — and shift them along the axis with `move_bodies`; then subtract.
   - **A recess after an outline on a curved face** (text, signs, panels): `project` the
     curves onto the body (along a direction), `imprint` them, `offset` the faces inside the
     outline by minus the depth. To chamfer the rim, read the faces in a tight `box` around
     one outline at a time: each wall face has four edges — one on the floor, two seams with
     the neighbouring walls and the rim; the rim is the one left. With hundreds of edges hand
     this to a subagent so the topology reads stay out of the main context.
   - **An inlay in a groove** (a light strip, a trim line): `imprint` the outline, make the
     groove with `extrude_faces` minus the depth, `thicken` the groove floor into the inlay
     and scale it down a little for a shadow gap.
   - **Screws** and other small hardware.
   - **Threads** (sockets, bushings, screw-in rings): a helix from `create_spiral`, a small
     thread profile swept along it with `sweep_profile`, then `boolean` into the part. Give
     the helix a whole number of turns (a fractional count comes out longer than asked), let
     the profile sit a little inside the wall, and trim the swept body with a box
     (`boolean` intersection) where it sticks out of the hole — the profile tilts with the
     helix and ends up lower than drawn.
   After these a body has hundreds of edges, so nothing that needs edge picking may be left
   for later.

(My reading, not the user's words: during blocking plain edges are fine; a model shown as
refined or finished has none. That the fine detail comes after the merge pass is also my
ordering of two things the user each called "the last step".)

### No bare edges

**Never leave plain sharp edges on a model. Every visible edge gets a fillet or a chamfer**,
unless the user says otherwise for that part. A model of boxes and cylinders with raw edges is
not an acceptable result.

How to keep to it:

- Treat the edges of a body in the refining stage, body by body — not as something left for
  "later" that never comes.
- Do it **before fine detail** (engraved text, small pockets): afterwards the body has
  hundreds of edges and picking the right ones from `get_body_topology` is expensive.
- Choose by the look of the real object: `fillet` for cast, moulded and pressed shapes,
  `chamfer` for machined rims, rings and holes. Size by the part — roughly 1–3 % of the
  body size for outer edges, smaller (0.3–0.5 mm on a hand-sized object) for rims and holes.
- Go through a body **face by face, all of its outer edges** — not only the rim of the face
  that looks at the camera. The edges that run back from that face (the top and side edges
  of a block standing on another body) are just as visible. Before reporting, look at the
  body from at least two opposite isometric directions.
- Edges that meet in one vertex go into **one call with one radius** (the side edges, the top
  loop and the corners of a block together). A loop whose corners are left sharp, or corners first
  and the loop after, is refused by the kernel (`PK_BODY_fix_blends`).
- When a network of edges that meet in vertices refuses one call, fillet the main network
  first and then, separately, a chain that touches it only at its ends.
- A thin edge limits the radius of the rims around it: next to a trailing edge about 2 mm
  thick only R2 passes. A shaft or axle wider than the thin part it enters leaves ledges
  whose edges refuse fillets — keep the shaft inside the profile.
- A **closed** junction loop takes a chamfer. An **open** junction chain often refuses the
  chamfer at its ends but takes a `fillet` of the same size — try that before giving up.
- A junction can only be blended where the joined part ends **on** the body it joins. A
  part that runs past it (a block taller than the body it is united with) leaves
  a junction edge with nothing to cap it, and neither chamfer nor fillet works. Decide the
  split into bodies with that in mind, or say so in the brief.
- Round parts (shafts, knobs, buttons, rings, bosses): draw the half section as one closed
  polyline with the chamfers already in it and `revolve_profile` it about its axis — three
  small calls and no topology read. A profile edge may lie on the axis.
- A full `get_body_topology` is expensive (about 20 thousand tokens for a body of 70 edges).
  On anything but a simple body read it through the filter: `box` ({min, max}, a thin box
  around the plane or the line where the wanted edges are) and `kinds` (line / circle /
  curve). That is how junction edges are picked after a union.
- Profiles: round the corners of the curve first (`fillet` / `chamfer` with `vertexIds`, or
  every corner without ids), then extrude — cheaper than filleting the solid's edges.
- A seam between two flush bodies is not a bare edge; an outer rim is.
- **An oversized fillet does not fail** — Plasticity silently gives another shape. Check the
  returned bounds and face count, and look at a screenshot.
- If an edge really cannot be treated (the kernel refuses, or it would destroy a neighbouring
  feature), say which one and why instead of leaving it silently.

### Research first, then a brief, then build

- **When information is missing, look it up on the internet** instead of guessing: real
  dimensions, how the object is actually shaped, views the given drawing does not show
  (side, back), details too small to read. Photos and spec sheets of the real object count.
- **Before building, give the user a brief** and wait for the go-ahead. The brief says: what
  will be built and in which order; which dimensions come from the user's material, which
  from research (with the source) and which are still estimates; the bodies and groups; the
  edge treatment planned (see "No bare edges"); what will be left out.
- Anything still estimated after the research is listed in the brief, not discovered by the
  user afterwards.

### Before saying it is done

- Every stage is finished for the whole model — or the report says which one is not.
- All outer edges are treated; every body passes `check_bodies`.
- Helper curves and sheets are deleted.
- Screenshots from the same sides as the reference were compared with it; the differences
  are corrected or named.
- What is estimated or left out is in the report, not left for the user to find.

## Pitfalls (field-tested)

- **`extrude_profile` does not consume the source polygon** — the wire stays in the scene
  (type `Wire` in `list_bodies`). Delete every helper wire at the end.
- **Polygon extrusion direction**: a default `create_polygon` (normal +Z) extrudes toward
  −Z. For an upward extrude pass `normal: [0,0,-1]`. Always check the returned bounds.
- **A `boolean` union of a floating (non-intersecting) tool is a silent no-op**
  ("Operation has no effect"), not an error. After any multi-step union verify the
  resulting `boundsMm` — a missing part shows up as a bounds that never grew.
- **Chamfering all edges of one box in a single call can fail with
  `PK_ERROR_unsuitable_topology` (1033)** even when geometrically fine. Fallback:
  chamfer in groups — long parallel edges first, then the rim loops — or edge-by-edge.
- **A batch chamfer on a long polygon rim (8–12 edges) with a large distance can
  silently produce an INVALID body** (no error; `check_bodies` reveals it). Then chamfer
  that rim one edge at a time, long edges first, smaller distance on short fragments.
  Run `check_bodies` after every chamfer batch on complex rims.
- **Param names**: `copy_bodies` / `move_bodies` take `delta` (not `offset`);
  `delete_bodies` takes `ids` (not `bodyIds`); `create_cylinder` takes `base` (not
  `position`); `move_bodies` returns `changed` (list of moved bodies), not `bodies`.
- **Never filter bodies by name for deletion** — a name like "rook_master" matches the
  master and every copy. Keep explicit id lists in a JSON file and delete by id.
- **Never trust the order of a persisted id list either.** Before a batch move or
  delete over ids from a saved JSON file, re-derive what each id is from
  `list_bodies` (name + `boundsMm` center) and give each body its own delta to its
  own target. A list written in a different order than assumed moves the wrong
  bodies silently — sometimes straight off the model. After the move, verify by
  recomputing every center from the new bounds against the expected slot; the
  success flag says nothing about which bodies landed where.
- **A sweep rail steers the whole section, not only the point it touches.** An edge of the
  section that is free between the rails can be lifted or dropped (a windscreen's bottom
  edge came out at 830 mm instead of 765). After a rail sweep check the edges that matter
  and correct them (`scale_bodies` about the edge that is right, or one more rail).
- **The full inner loop of a deep pocket refuses a fillet** (a wheel well: 16063). Fillet
  the visible rim alone and say that the hidden inner edges are left sharp.
- **An opening of several edges is one `loft_edges` end.** List all its edges (a radiator
  mouth of four): connected edges chain into one end by themselves, in any order. A curved
  guide (`guideIds`) works only between curve ends — with Sheet edges the kernel fails
  (22000): make the ends curves with `curves_from_edges` first and loft those.
- **A fillet wider than half of a narrow end face makes the body invalid without an error**
  (13808). Run `check_bodies` after every fillet near a narrow end.
- **Closed control-polygon splines are often "ambiguous" when passed by id** to
  `loft_profiles`, `extrude_profile` or `revolve_profile`: pass `regionIds` from
  `list_regions` instead. An old helper curve lying in the same plane also makes a call by id
  refuse — delete helper curves right after use.
- **`imprint` and `project` along a direction mark only the first surface hit.** To mark
  both sides of a body, do it from each side.
- **`undo` steps back through deletes too.** Count the steps before undoing.
- **Standard chess layout** (placing a set from a description): the back rank sits in
  the outer row, closest to the board edge; the pawns stand one row inward, between
  the back rank and the board center. The player side is the board-edge side.

## Free-form surfacing

Plasticity Indie only: the xNURBS surfaces (n-sided, square, refit) are Studio commands and the
server does not offer them. Everything below was tried live on 26.1.3 (`docs/surfacing-spike.md`).

**When.** A loft through closed sections is still right for one body that does not branch
(fuselage, bottle, handle) when the sections are close enough. Switch to curves and patches
when a form branches (a wing out of a fuselage, a spout out of a body), when a surface must
flow tangentially out of another, for caps and domes, and when sparse sections bulge (the MTB
saddle grew from 130 to 164 mm between two sections).

**Curves carry the tangents.**
- Draw the characteristic lines (silhouettes, centre line, creases) with `create_spline` and
  `controlPoints: true`. The curve leaves its first point along the first leg of the control
  polygon (that is the tangent), the leg's length is the tension, and the third point sets the
  curvature. To leave a symmetry plane at a right angle, put the second point on the plane's
  normal. Two curves meet tangentially (G1) when the last-but-one point of one, the shared
  point and the second point of the other lie on one line.
- An interpolating spline (without `controlPoints`) overshoots between far points and past
  its own ends (40 mm on the saddle; past the boundary of a patch guide). Use it only through
  dense, measured points.
- `bridge` joins two curve ends with G1 / G2 / G3.

**Surfaces.**
- Opening in a Sheet: `patch` with `id` + `edgeIds` and `continuity` G1 (a tangent dome) or G2.
  One value for the whole loop (the kernel ignores per-edge values). A circle with G1 gives an
  exact sphere. A cornered opening is filled with triangles meeting in the middle
  (`topology` multiple); `single` and `smoothness: "smooth"` work only on a boundary without
  corners. `guideIds` steer the surface but must end exactly at vertices of the boundary:
  plan a vertex wherever a guide will land.
- Between two existing surfaces: `loft_edges` from boundary edge to boundary edge with
  `tangency: "clamped"` and `join: true` continues both neighbours (G1 or better). On a tight
  bend lower `startMagnitude` / `endMagnitude` (0.6 for a 90° elbow of 10 mm tubes); too long
  a tangent fails. `natural` pinches. An end can be several connected edges (a square rim to a
  circle edge works); `guideIds` steer a loft between curve ends.
- A section that changes along a path: `sweep_profile` with 1–3 rails (`guideIds`) — one rail
  pulls its side out, two opposite rails scale the section, a third controls the other
  direction. `alignment: "parallel"` keeps the end face parallel to the start;
  `corners: "round"` rounds the corners of a polyline path.
- Shells: `revolve_profile` or `extrude_profile` with `thickness`; `thicken` a Sheet.
- A blend between two Sheets: `bridge_surface` — the width must be larger than the gap;
  `shape: "conic"` for a round (cylindrical) blend; `trimWalls: false` keeps both Sheets and
  returns the blend as a Sheet of its own.
- A surface over measured points: `constrained_surface` with `normals`.
- Close the volume: `join` the Sheets (a Solid when they close it). Symmetric forms: build
  one half, `mirror_bodies`, `join` on the symmetry plane.

**Edges and checks of free forms.**
- `fillet` with `shape: "g2"` for moulded, class-A looking edges (the seams measure G2). It
  fails on large sets of edges where a round fillet works: blend fewer edges per call.
- Fillet only edges that are really sharp: `measure_continuity`, then the edges G0 with an
  angle above about 5°. An edge that is already tangent cannot be filleted.
- Check every seam with `measure_continuity`: G1 means within 0.1°, G2 also matches curvature.
- A body with `boundsApproximate: true` has spline faces whose bounds come from the control
  polygon. Check its size with a boolean (a difference with a box that gives "no effect"
  means the body is inside the box) or with `set_section_view`, not with the bounds.

**Recipes (each built and checked on a test object).**
- Tangent nose or dome on a tube (rocket): a control-polygon spline whose second point is
  straight above the first → `revolve_profile` → `join` with the tube whose top face was
  removed (`delete_faces`, `heal: false`). The seam is G1 to 0.0000°.
- Fins, wings, handles (rocket, aircraft): the body and the part, `boolean` union first, then a
  G2 root blend (`fillet` with `shape: "g2"` on the junction edges — the edges between a
  face of the body and a face of the part), then round the outer edges. Rounding the outer
  edges before the union leaves fragments at the root and the blend fails. Leave out of the
  root selection other edges that happen to lie on the same radius (the bottom rim of a tube).
- Rounded ends of a lofted body (aircraft): `delete_faces` the flat end faces with
  `heal: false` and `patch` each opening with G1 (near-tangent, within 0.5°).
- Quick car or product body: three-view intersection — the side outline, the plan outline and
  a cross-section with tumblehome, outlines rounded first (`fillet` on the curves), each
  extruded through the others, one `boolean` intersection; round the sharp edges; wheel
  arches no deeper than the sill (a deeper cut splits the body into pieces). It gives a
  boxy body; for a real free form use curves and patches.
- Pipe elbow or branch: open tube ends, `loft_edges` clamped, joined.
- A body of two skins meeting at an angle: at each station two open sections sharing an end
  point; loft each skin on its own with one shared guide through those points (an
  interpolating spline through them), `join`, `mirror_bodies` + `join`, close the open ends
  with planar patches. The edge between the skins stays sharp for a fillet later; the seam on
  the symmetry plane measures G2.
- A tapered end of a loft: finish with a small but not zero planar section and close it with
  a G0 patch. A G1 patch on a narrow cornered opening gives triangle faces whose crease
  edges refuse every fillet (16065 / 16067).
- A loft that grows out of another body: put its end sections fully inside the receiving
  body, so no planar end face shows. The junction is then nearly tangent at its tips: a
  `g2` fillet there fails (16065), a round one works.
- A foil profile (legs, fins, struts, blades): one closed control-polygon spline — two
  points on the leading edge, the widest point at about a quarter of the chord, a very thin
  trailing edge; loft through a few such sections. A part repeated around an axis: one part
  from an outline with a thickness, turn it to its angle, `array_radial`, `union`, fillet the
  roots. A mirrored copy of such a group turns the other way (left- and right-hand).
- Enlarging a part already united with the body: build the new shape so that it envelops
  the old one — one union replaces it without touching the details around. A boss that has to
  go comes off with `delete_faces` (`heal`), its faces together with its junction fillet and
  socket.

## Choosing the tool

Every command of Plasticity's modelling menu, by what it is for:

| Intent | Tool |
|---|---|
| Straight walls from an outline | `extrude_profile` (`distanceBack`, `thickness` for a wall) |
| Round part from a half section | `revolve_profile` (`thickness` for a shell) |
| Sections that change along the length | `loft_profiles` (`guideIds`) |
| Surface from edge to edge, tangent to the neighbours | `loft_edges` |
| One section along a path | `sweep_profile` (rails, `alignment`, `corners`) |
| Round bar or tube along a curve | `pipe` (`sides` for a polygon bar, `twist`) |
| Close an opening, a dome, a cap | `patch` (`continuity`, `topology`, `guideIds`) |
| Blend two Sheets | `bridge_surface` |
| Copies along a curve (chain, rivets, ribs) | `array_curve` |
| Mirror a half | `mirror_bodies` |
| Split a body with a curve or a face | `cut` |
| Sheets into one, or into a Solid; curves end to end | `join` / `unjoin` |
| Shell a Solid | `hollow` |
| Give a Sheet or faces a thickness | `thicken` |
| Parallel copy of curves or faces | `offset` |
| More control points on a curve or face | `raise_degree` |
| Clean up or lighten a curve or face | `rebuild` |
| Project curves onto a body | `project` |
| Put curves or another body into faces as edges | `imprint`, then `complete_edges` |
| Round or bevel edges | `fillet` (`shape`), `chamfer` (`distance2`) |
| Draft angle for moulding | `draft_faces` |
| Make faces flush with a reference face | `match_faces` |
| Continue a Sheet past its edge | `extend` |
| Wrap a flat detail onto a curved face | `unwrap_faces`, then `deform` |

## Working facts

- Start: `native_status`; when not connected, `native_connect` (Plasticity must have been
  started through `native_launch`; never close a running Plasticity — ask the user).
- Units are millimetres and degrees. Z is up; the front view looks along +Y.
- Face, edge, vertex and region ids change after every change of the body: re-read
  `get_body_topology` / `list_regions` before each operation that takes them.
- After risky steps (booleans, fillets, deleted faces): `check_bodies`, and a `screenshot`
  from `set_view` to see the result. To look closely at one part of a scene pass its
  bodies as `ids` to `set_view` — without them it frames everything. Whether a view is
  X-ray or shaded follows the X-ray toggle of the window (`native_status` reports it as
  `xray`): `set_xray` `on: false` before presentation screenshots, `on: true` to see
  inner parts through the body. `new_document` starts in X-ray, and `open_document` brings
  back the state the file was saved with. To look from any other side pass `direction`
  (model → camera, e.g. [1, 1, 1] from behind) instead of `view`.
- Undo only your own steps: the history may hold the user's work from before.
- Edge and face ids keep their number across versions of a body; only the prefix before
  `e` / `f` changes. A fillet that trims an edge gives it a new number, so read the topology
  again after fillets.
- `set_view` reports "camera did not reach the asked direction" while the user moves the
  viewport: retry later, and do not trust a screenshot taken right after such an error.
