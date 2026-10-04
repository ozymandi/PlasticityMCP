---
name: plasticity-mcp
description: Model real CAD geometry in a running Plasticity window through the Plasticity MCP server (tools mcp__plasticity__*: native_connect, create_*, extrude_profile, boolean, fillet, chamfer, cut, get_body_topology, …). Use whenever the user asks to build, edit, measure or export a part or a model in Plasticity, to model something from a drawing or a description, or mentions Plasticity MCP.
metadata:
  version: "1.0.0"
  author: ozymandi
---

# Plasticity MCP

Own MCP server for Plasticity 26.1.3 (this repository). It builds native
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
   - **Inscriptions and decals** (markings, scales, numbers, labels). On a
     flat face: text, letter regions extruded, `boolean` difference. On a cylinder:
     `unwrap_faces` of the wall (do it while the body is still simple) gives a flat Sheet
     at the origin; make the letters there as solids that straddle the Sheet (text drawn
     0.3 below it, extruded 0.6); `deform` them from the Sheet's face onto the wall; read
     from the returned bounds where and which way up they landed — the Sheet's axes may
     map reversed — and shift them along the axis with `move_bodies`; then subtract.
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

## Working facts

- Start: `native_status`; when not connected, `native_connect` (Plasticity must have been
  started through `native_launch`; never close a running Plasticity — ask the user).
- Units are millimetres and degrees. Z is up; the front view looks along +Y.
- Face, edge, vertex and region ids change after every change of the body: re-read
  `get_body_topology` / `list_regions` before each operation that takes them.
- After risky steps (booleans, fillets, deleted faces): `check_bodies`, and a `screenshot`
  from `set_view` to see the result. To look closely at one part of a scene pass its
  bodies as `ids` to `set_view` — without them it frames everything. The named axis views
  are X-ray; for a shaded look from any other side pass `direction` (model → camera, e.g.
  [1, 1, 1] from behind) instead of `view`.
- Undo only your own steps: the history may hold the user's work from before.
