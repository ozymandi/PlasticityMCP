# plasticity-mcp

MCP server for [Plasticity](https://www.plasticity.xyz/) 26.1.3: 143 tools over two independent channels.

- **Native channel (CDP)** — real B-Rep modelling through Plasticity's own factories and history. Almost all tools; described first.
- **Bridge channel (WebSocket)** — the built-in protocol of the official Blender bridge: scene listing, change events, retessellation. Read side only on 26.1.x.

What is covered compared with Plasticity itself, what is missing and why: [../docs/coverage.md](../docs/coverage.md).

## Native CAD tools (CDP, Plasticity 26.1.3 only)

Real B-Rep operations through Plasticity's own factories and history. Unofficial, against internal APIs, pinned to **26.1.3** — any other version is refused. Units are millimetres.

### Session

| Tool | Description |
|------|-------------|
| `native_launch` | Start Plasticity 26.1.3 with a loopback-only debugging endpoint (`127.0.0.1:9223`). Never closes a running instance — if Plasticity runs without native access, close it yourself first. |
| `native_connect` | Attach to a window (`targetId` needed only with several windows). |
| `native_status` | Connected window, busy flag, undo/redo depth, body count. |

### Primitives

| Tool | Description |
|------|-------------|
| `create_box` | `origin` (min corner) + `size`. |
| `create_sphere` | `center` + `radius`. |
| `create_cylinder` | `base` (bottom cap centre) + `radius` + `height`, optional `axis`. |

### History

| Tool | Description |
|------|-------------|
| `undo` / `redo` | Native history. |

### Scene

| Tool | Description |
|------|-------------|
| `list_bodies` | All bodies: stable id, type (Solid / Sheet / Wire), name, bounds, face/edge counts, visible / locked / selected, `materialId`. |
| `get_selection` | What is selected in the window: whole bodies, faces and edges (with their body), regions, groups. |
| `select_bodies` | Replace the selection; empty list clears it. Not an undo step. |
| `delete_bodies` | Native Delete by id. Undoable. Clears the selection. |
| `rename_body` | Rename a body. Undoable. |
| `select_topology` | Select faces and edges of one body in the window. Not an undo step. |

### Groups

| Tool | Description |
|------|-------------|
| `list_groups` | The group tree: id, name, parent and direct members of each group; group 0 is the scene. |
| `group_bodies` | Put bodies into a new group, optional `name`. |
| `ungroup` | Dissolve groups; members move up to the parent. |
| `move_to_group` | Move bodies into a group; 0 is the scene. |

### Visibility and locking

| Tool | Description |
|------|-------------|
| `set_visibility` | Hide or show bodies. |
| `unhide_all` | Show everything hidden. |
| `isolate` / `unisolate` | Show only the given bodies; return to the full scene. |
| `set_locked` / `unlock_all` | Lock bodies against picking in the window; unlock everything. |

### Materials

| Tool | Description |
|------|-------------|
| `list_materials` | Materials of the document: id, name, colour, roughness, metalness, opacity. |
| `create_material` | New material: `name`, `color` (#rrggbb), optional `roughness`, `metalness`, `opacity`. |
| `set_material` / `remove_material` | Give a material to bodies; take it off. |

### Checking and measuring

| Tool | Description |
|------|-------------|
| `check_bodies` | Kernel check of bodies: `valid` and fault codes. |
| `find_boundary_edges` | Open edges of a Solid / Sheet (the rims of its openings); `select` optional. |
| `add_measurement` | A measurement kept in the document: straight distance between two attachable points (`from`, `to`), or the radius of a circular edge (`id` + `edgeId`). |
| `list_measurements` / `delete_measurements` | Measurements of the document with their values; delete by id. |
| `measure_continuity` | Gap, angle and curvature change between the faces along edges, and the continuity (G0 / G1 / G2). |
| `set_section_view` / `clear_section_view` | Cut the view (not the model) with a plane, for screenshots of the inside. |

### Transforms

| Tool | Description |
|------|-------------|
| `move_bodies` | Translate by `delta`. |
| `rotate_bodies` | Rotate `angle` degrees around `axis` through `pivot`. |
| `scale_bodies` | Scale by `factor` (number or `[x, y, z]`) relative to `pivot`. |

### Copies

| Tool | Description |
|------|-------------|
| `copy_bodies` | Independent copies of bodies or curves, optional `delta` shift. |
| `mirror_bodies` | Mirrored copies across a plane (`planeOrigin`, `planeNormal`); `keepOriginal: false` deletes the originals (two undo steps). |
| `array_rectangular` | Row or grid of copies: `direction1` / `count1` / `spacing1`, optional second direction. Counts include the original. `instances` optional. |
| `array_radial` | `count` items around an axis (`center`, `axis`) over `angle` degrees. `instances` optional. |
| `array_curve` | `count` items along curve `curveId`; `alignment` normal / parallel / transport, `twist`, `scale`, `extent`. `instances` optional. |

### Instances

| Tool | Description |
|------|-------------|
| `list_instances` | Instances: id, name, source body, bounds. |
| `create_instances` | Linked copies of bodies or curves, optional `delta` shift. |
| `realize_instances` | Turn instances into independent bodies. |
| `delete_instances` | Delete instances by id. |

### Modelling

| Tool | Description |
|------|-------------|
| `get_body_topology` | What a body is made of, with ids: faces and edges of a Solid / Sheet (`include`: faces / edges / all) plus the control points of its spline faces, or segments, vertices and control points of a curve. On a detailed body ask for a part: `box` ({min, max}) keeps what lies inside it, `kinds` (line / circle / curve) keeps edges of those kinds. |
| `boolean` | `union` / `difference` / `intersection` of `toolIds` against `targetIds`; `keepTools` optional. |
| `fillet` | Round with `radius`: edges of a body (`edgeIds`), corner vertices of a curve (`vertexIds`), or every corner of a curve. |
| `chamfer` | Bevel by `distance`: edges of a body, or corners of a curve, the same way. |
| `extrude_faces` | Push / pull faces of a Solid by `distance`: positive adds outward, negative cuts in. On a Sheet the extrusion becomes a new Solid. |

### Solids

| Tool | Description |
|------|-------------|
| `cut` | Cut Solids / Sheets into pieces with curves (`curveIds`, optional `extend` and sweep `direction`) or with faces of another body (`cutterId` + `faceIds`). Curves as targets are cut where the cutter curves cross them. |
| `hollow` | Shell a Solid with walls of `thickness`; `faceIds` become the opening, without them the cavity is closed. Inward by default, `outward` optional. |
| `thicken` | `front` / `back` thickness: a Sheet becomes a Solid; with `faceIds` those faces become a new Solid. |
| `draft_faces` | Tilt faces by `angle` degrees about the plane of `referenceFaceId`. |
| `delete_faces` | Remove faces and heal the gap (removes a fillet, hole or boss); `heal: false` leaves an open Sheet. |
| `remove_fillets` | Remove the fillets of bodies; optional `maxRadius` and `convexity` (any / convex / concave). |
| `patch` | Close with a surface: closed curves (`curveIds`), regions (`regionIds`), all holes of a Sheet (`id`) or one opening by its edges (`id` + `edgeIds`). |
| `pipe` | Round tubes along curves: `diameter`, optional `wallThickness` (added outside the bore). |
| `join` | Curves that touch end to end → one curve; Sheets that share edges → one Sheet, or a Solid when closed (`ids`, keeps the first id). Faces of one body on the same surface → one face (`id` + `faceIds`). |
| `unjoin` | A curve → its segments, a body → one Sheet per face (`ids`); or detach chosen faces (`id` + `faceIds`). |

### Faces and edges

| Tool | Description |
|------|-------------|
| `move_faces` | Move faces by `delta`; neighbours follow. |
| `rotate_faces` | Rotate faces by `angle` around `axis` through `pivot` (default: the centre of the faces). |
| `scale_faces` | Scale faces by `factor` about `pivot`; on a cylindrical face this changes the radius in place. |
| `move_edges` | Move edges by `delta`; the faces around them tilt. |
| `offset` | Offset by `distance`: faces along their normals (`faceIds`), the outline of faces on the surface (`faceIds` + `loops`), edges across a face (`edgeIds`), new vertices beside a curve vertex (`vertexIds`), a parallel copy of curves (`curveIds`) or a curve around regions (`regionIds`). `bothSides` and `gapFill` where they apply. |
| `match_faces` | Put faces onto the surface of another face (`targetId`, `targetFaceId`). |
| `refillet` | Change the radius of existing fillet faces: `radius` or `delta`. |
| `duplicate_faces` | Copy faces into a new Sheet, or with `solid` into a Solid. |
| `imprint` | Add edges to a body without changing its shape: from curves (`curveIds`, optional `direction`) or from crossing bodies (`toolIds`, optional `imprintTools`). `complete`: none / edge / boundary. |
| `complete_edges` | Extend edges that end inside a face to its boundary. |
| `dissolve_edges` | Remove edges and merge the faces they separate; without `edgeIds`, every redundant edge of the body, or the redundant vertices of a curve. |
| `isoparam` | Add `count` edges on a face along its `u` or `v` direction at `param`. |
| `untrim` | Detach faces and restore their whole underlying surface; `keepEdges` optional. |
| `unwrap_faces` | Flatten faces into a planar Sheet at the origin. |
| `extend` | Extend by `distance`: a Sheet past boundary edges (`edgeIds`) or a curve past its end vertices (`vertexIds`); `shape`: linear / soft / reflective / natural. |
| `reverse` | Flip the direction of curves or the normals of Sheets. |

### Curves

| Tool | Description |
|------|-------------|
| `create_polyline` | Curve of straight segments through `points`; `closed` makes a profile. |
| `create_spline` | Smooth curve through `points`, or shaped by them as control points (`controlPoints`). |
| `create_circle` | Circle from `center`, `radius`, optional plane `normal`; or through two / three `points`. |
| `create_arc` | Arc through three points (`start`, `through`, `end`). |
| `create_arc_center` | Arc around `center` from `start` through `angle` degrees about `normal`. |
| `create_ellipse` | Ellipse from `center`, `majorRadius`, `minorRadius`, optional `normal` and `majorDirection`. |
| `create_rectangle` | Closed rectangle: `origin` (corner, or centre with `centered`), `width`, `height`, optional `normal` / `xDirection`; or three `points`. |
| `create_polygon` | Regular polygon: `center`, `radius`, `sides`; `radiusTo` vertex / side. |
| `create_spiral` | Helix: `base`, `axis`, `height`, `radius`, `turns`, `handedness`. |
| `create_text` | Text as outline curves: `text`, `size`, optional `origin`, `normal`, `xDirection`. |
| `create_slot` | Slot outline of `width` around planar curves (not a single straight line). |
| `create_tangent_arc` | Arc leaving the `start` / `end` of a curve segment tangentially to point `end`. |
| `create_tangent_circle` | Circle of `radius` touching two curve segments, the one nearest to `near`. |

### Curve editing

| Tool | Description |
|------|-------------|
| `trim_curves` | Remove the piece of a curve nearest to `near` (pieces end at corners and crossings). |
| `bridge` | Smooth connecting curve between two curve vertices or two body edges; `continuity` G0–G3. |
| `rebuild` | Refit as splines: curves by `tolerance`, `pointCount`, or `degree` + `spans`; one face (`id` + `faceId`) by `tolerance`. |
| `raise_degree` | Raise the degree of curves (`ids`) or of the surfaces of faces (`id` + `faceIds`, `u` / `v`). |
| `subdivide_curves` | Add a control point in the middle of every segment. |
| `convert_vertices` | Turn corner vertices of a curve into smooth ones. |
| `align_vertices` | Bring a curve end onto a vertex of another curve with G0 / G1 / G2 continuity. |
| `move_control_points` / `rotate_control_points` / `scale_control_points` | Transform vertices and control points of one curve, or the surface control points of one body. |
| `slide` | Slide control points of a spline curve or surface along (`forward` / `backward`, `forward_v` / `backward_v`) or across (`normal`) the control polygon. |
| `delete_control_points` | Delete control points of a spline. |
| `curves_from_edges` | Copy edges of a body as curves. |
| `deform` | Wrap curves (`curveIds`) or whole bodies (`ids`) from a `source` face onto a `target` face. |

### Surfaces

| Tool | Description |
|------|-------------|
| `bridge_surface` | Blend two Sheets into one with a transition `width` wide between a face of each; `shape` g2 / chamfer. |
| `constrained_surface` | A Sheet through at least four `points`, optional `normals`, `tolerance`, `optimize`. |
| `remove_nominal_surface` | Reveal the hidden spans of control points of spline faces. |

### Projection

| Tool | Description |
|------|-------------|
| `project` | New curves by projection: curves onto a body (`curveIds` + `targetId`, optional `direction`), crossing lines of bodies (`bodyIds`), or two planar curves into one curve in space (two `curveIds`). |
| `create_outline` | Outline of bodies seen along the normal of a plane (`planeNormal`, `planeOrigin`), by default the window's active construction plane; `flat` projects it onto the plane. |
| `duplicate_and_project` | Copy curves or body edges and flatten the copies onto a plane (`planeOrigin`, `planeNormal`). |

### Profiles

| Tool | Description |
|------|-------------|
| `list_regions` | Regions Plasticity built from closed loops of curves: id, bounds, normal, boundary length, holes. |
| `extrude_profile` | Closed planar curve → Solid, open curve → Sheet, by `distance` along the plane normal. Takes a curve `id` or `regionIds`. |
| `revolve_profile` | Revolve a curve around an axis (`axisOrigin`, `axis`, `angle`): closed → Solid, open → Sheet. |
| `sweep_profile` | Sweep a profile curve along a path curve; optional `twist` and end `scale`. |
| `loft_profiles` | Loft through ordered profiles; optional `guideIds`, `closed`. Closed profiles → Solid, open → Sheet. |

### Export

| Tool | Description |
|------|-------------|
| `export_step` | Exact B-Rep export to `.step` / `.stp`; all Solids and Sheets unless `ids` given. |
| `export_parasolid` | Exact B-Rep export to `.x_t` (text) or `.x_b` (binary). |
| `export_mesh` | Triangle mesh to `.stl`, `.obj` (millimetres) or `.3mf` (metres, unit declared), Z up; `tolerance` and `angle` control the density. |
| `export_drawing` | Technical drawing as SVG in millimetres: hidden-line projections of the chosen `views`, laid out left to right. |
| `save_document` | Save a **copy** as `.plasticity`; the open document stays as it is. |

### Import

| Tool | Description |
|------|-------------|
| `import_step` | Add a STEP file's geometry to the document. Undoable. |
| `import_parasolid` | Add the bodies of a `.x_t` / `.x_b` file. Undoable. |
| `import_svg` | SVG shapes as editable curves in the XY plane (`unit`, default millimetre; SVG y is flipped). Undoable. |
| `import_mesh` | `.stl` / `.obj` / `.3mf` as a **reference mesh** — visible, but not a body (`unit` for STL and OBJ). Undoable. |
| `list_reference_meshes` | Reference meshes: id, name, source file, bounds, triangles. |
| `delete_reference_meshes` | Delete reference meshes by id. Undoable. |

### Environment

| Tool | Description |
|------|-------------|
| `get_environment` | Document (title, path, unsaved changes), display units, grid, active construction plane. |
| `set_construction_plane` | Active construction plane: `preset` xy / yz / xz, `normal` (+ `origin`, `xDirection`), or a planar face. Not an undo step. |
| `new_document` | A new Untitled document in this window (the startup document). Needs `discardChanges` when there is unsaved work. |
| `open_document` | Open a `.plasticity` file in this window. Needs `discardChanges` when there is unsaved work. |

### View

| Tool | Description |
|------|-------------|
| `set_view` | Camera to a `view` (front / back / left / right / top / bottom / isometric) or, instead, to look from any `direction` (model → camera, e.g. [1, 1, 1] from behind) shaded like the isometric view; `fit` frames all bodies, or with `ids` only those — a close look at one part. |
| `screenshot` | PNG of the 3D viewport (longest side ≤ 1568 px), returned as an image; optional `path`. |

### Notes

`native_launch` adds Chromium switches that keep the window drawing while it is covered by other windows, so everything works at full speed with Plasticity in the background. A **minimized** window does not draw: `set_view` and `screenshot` then fail with a clear message (`native_status` reports `windowVisible`) and modelling tools slow down to about two seconds per operation.

Plasticity is started as a process of its own, not as a child of the server (on Windows through the system's process service), so a client that stops or restarts the server — LM Studio does that often — does not take the Plasticity window down with it.

Reference meshes and instances are separate families of objects with ids of their own: `list_bodies`, the transform tools and the modelling tools do not see them. An instance becomes a body through `realize_instances`.

IGES and SAT are not available: they need the Studio edition of Plasticity (this server is developed against an Indie licence).

File tools take absolute paths, check the extension and never replace an existing file without `overwrite: true`.

The profile tools (`extrude_profile`, `revolve_profile`, `sweep_profile`, `loft_profiles`) take either a curve id or `regionIds` from `list_regions`. A curve id is refused when other curves in its plane cross it or lie inside it; regions are how to pick the plate-with-holes area, or a profile drawn as several lines and arcs.

Face and edge ids — and the segment, vertex and control point ids of a curve — are valid only until the body changes — re-read `get_body_topology` after every operation on it. Region ids likewise change whenever curves in their plane change. Stale ids are rejected.

A full `get_body_topology` of a detailed body is very long — 337 edges come to about 130 thousand characters. Read such a body through the filter: a thin `box` around a plane or a line returns only the edges there (the same body, one plane: 11 edges, 4 thousand characters).

`pivot` is optional for rotate and scale; it defaults to the centre of the bodies' combined bounding box.

Results are plain JSON printed compactly: whatever fits on one line stays on one line (one body, edge or region per line), and a body is printed without the fields at their usual value — no `name` means unnamed, no `visible` shown, no `locked` / `selected` not locked / not selected, no `materialId` no material; a curve has no `faceCount` / `edgeCount`; a group lists only the kinds of members it has. The group tools return what they touched, not the whole tree (`list_groups` gives the tree). `list_regions` takes a `box` like `get_body_topology`.

Mutating tools return `created` and `changed` bodies (stable id, type, name, bounds, …) and `removedIds`. Transforms keep body ids, so their result is in `changed`. A body is reported as changed whenever its geometry was rewritten, also when bounds and counts stay the same (a reversed Sheet, a new fillet radius).

Live check — mutates the document, so it only runs in a fresh "Untitled" one and undoes everything:

```bash
npm run smoke:native
```

Plasticity must be started through `native_launch` (or `smoke:native`); a normally started instance has no debugging endpoint. See `../task.md` for how the access works.

## Bridge channel tools (WebSocket)

| Tool | Description |
|------|-------------|
| `connect` | Connect to `ws://localhost:8980` and handshake. |
| `status` | Report connection state, current filename/version, supported opcodes. |
| `list_scene` | List all (or only visible) objects. Optional `includeMesh` returns vertex/face counts and bbox. |
| `get_object` | Fetch a single object by id. |
| `subscribe_changes` / `unsubscribe_changes` | Live transaction event stream. |
| `drain_events` | Pull buffered scene events since last drain. |
| `refacet` | Request retessellation with quality params. Returns counts + bbox. |
| `push_mesh` | Upload a mesh into Plasticity (`PUT_SOME_1`). Supports n-gons via `sizes`. |

> Raw vertex/index/normal arrays are **never** returned to the LLM (they would blow up context). Only counts and bounding boxes.

## Setup

```bash
cd mcp-server
npm install
npm run build
```

## Quick verification (live Plasticity)

With Plasticity 26.1.x running and a document open:

```bash
npm run smoke
```

Connects, handshakes, lists scene, prints summary. Does not need an MCP client.

> Note: `push_mesh` requires the server to advertise `PUT_SOME_1` (opcode 31). Plasticity 26.1.2 stable does **not** advertise it; the tool will throw a clear error in that case. All other tools work.

## Run as MCP server

In Plasticity, make sure the WebSocket server is running (the Blender bridge add-on enables this implicitly; in 26.x it appears to be on by default — verify in Preferences if not).

```bash
node dist/index.js
# or for dev:
npm run dev
```

Override server with `PLASTICITY_SERVER=host:port` env var (default `localhost:8980`).

### Compact catalog (models with a small context)

The full tool list is about 25 thousand tokens. Started with `--catalog=compact`, the server lists 25 tools — about 5 thousand tokens — and nothing is lost:

```bash
node dist/index.js --catalog=compact
```

- 23 core tools are listed as usual: `native_launch`, `native_connect`, `native_status`, `undo`, `list_bodies`, `get_body_topology`, `list_regions`, `check_bodies`, `create_box`, `create_cylinder`, `create_polyline`, `create_circle`, `extrude_profile`, `revolve_profile`, `boolean`, `fillet`, `chamfer`, `move_bodies`, `delete_bodies`, `set_view`, `screenshot`, `save_document`, `export_step`.
- `find_tools` returns the full definition (description and input schema) of other tools: by `names`, by the words of a `query` (best matches first), by `family`. Its own description names every tool of the server by family.
- `call_tool` runs any tool by `name` with its `arguments` — same checks, same result as a direct call.

Without the argument (or with `--catalog=full`) the server lists all 143 tools, as before.

## Wiring into Claude Code

Add to your `claude_desktop_config.json` or project settings:

```json
{
  "mcpServers": {
    "plasticity": {
      "command": "node",
      "args": ["E:\\Projects\\PlasticityMCP\\mcp-server\\dist\\index.js"],
      "env": { "PLASTICITY_SERVER": "localhost:8980" }
    }
  }
}
```
