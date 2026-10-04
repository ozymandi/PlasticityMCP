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

## Modelling rules (from the user)

### Order of work

The user's words: first blocking, then refining; the merge pass is the last step.

1. **Blocking.** The main volumes in the right proportions and places, as simple bodies.
   Check them against the drawing (front, top, side screenshots) before going further.
2. **Refining.** The details, and the edges: see "No bare edges" below.
3. **Merge pass — the last step.** Go through the finished model, find the parts that should
   be one piece, `boolean` union them, and put a chamfer / bevel on the edges where they meet.
   - One piece: fixed parts that touch and belong to the same real part or casting (a body
     and its front block, bosses, lugs, sockets, strips, a lever and its hub).
   - Stay separate: moving parts (dials, buttons, knobs, levers against the body), removable
     parts, parts that are a different piece on the real object. When in doubt, ask in the
     brief.
   - The junction edges exist only after the union, on a body that is already detailed.
     Pick them with the filter of `get_body_topology` — `include: "edges"` plus a thin `box`
     around the plane or the line of the junction, and `kinds` when it helps — never with a
     full listing.
   - Build the parts so that the junction
     comes out clean: let a part run a little into the one it joins, and do not round a rim
     that will end up buried in the junction (a rounded rim lying on a flat face gives a
     cusp that cannot be chamfered).

(My reading, not the user's words: during blocking plain edges are fine; a model shown as
refined or finished has none.)

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
  `chamfer` for machined rims, rings, dials and holes. Size by the part — roughly 1–3 % of the
  body size for outer edges, smaller (0.3–0.5 mm on a hand-sized object) for rims and holes.
- Go through a body **face by face, all of its outer edges** — not only the rim of the face
  that looks at the camera. The edges that run back from that face (the top and side edges
  of a block standing on another body) are just as visible. Before reporting, look at the
  body from at least two opposite isometric directions.
- Order on one body: first the long loops (where walls meet a roof or a floor), then the
  corner edges that cross them. The other way round the kernel refuses the loop
  (`PK_BODY_fix_blends`).
- Round parts (dials, knobs, buttons, rings, bosses): draw the half section as one closed
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
  from `set_view` to see the result.
- Undo only your own steps: the history may hold the user's work from before.
