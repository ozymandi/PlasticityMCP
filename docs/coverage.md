# Coverage and limits

What the server can do compared with Plasticity itself: which Plasticity command is behind which tool, what is missing, and where a tool behaves differently from the command in the window.

State on 2026-10-04: **143 tools**, Plasticity **26.1.3**, Indie licence, Windows. Parameters of each tool are in [mcp-server/README.md](../mcp-server/README.md); how each was built and tested is in [task.md](../task.md).

## How to read this

- Tools are named and grouped the way Plasticity groups its commands. A "unified" command of Plasticity (Fillet, Offset, Project, Join, Unjoin, Extend, Rebuild, …) is one tool that picks the variant from what it is given.
- A tool exposes the main parameters of a command. Options that are not listed for a tool are left at Plasticity's defaults — the "Limits" column names the ones that matter.
- Nothing here uses the pointer. Whatever Plasticity can only take from a click, a gizmo or a dialog is not available (see [Not available](#not-available)).

## General limits

- **Plasticity 26.1.3 on Windows only.** Any other version is refused. The server uses internal APIs, so an update of Plasticity can break it.
- **Indie licence.** Commands and formats of the Studio edition are not available.
- **Plasticity must be started through `native_launch`.** An instance started normally has no debugging port; the server never closes it — the user does.
- **One window, one viewport.** Tools act on the connected window; `set_view` and `screenshot` use its first viewport.
- **The window must not be minimized.** A covered window works at full speed; a minimized one does not draw: `set_view` and `screenshot` refuse, the rest slows down to about two seconds per operation.
- **Millimetres and degrees**, whatever units the window displays.
- **Ids of faces, edges, curve segments, vertices, control points and regions are valid only until the body changes.** Re-read `get_body_topology` / `list_regions` after every operation; stale ids are refused.
- **Face and edge tools take one body per call.**
- **Instances and reference meshes are not bodies.** They have ids of their own; `list_bodies`, the transform tools and the modelling tools do not see them.
- **A refused or failed operation shows a red toast** in the Plasticity window.
- **Long automated sessions:** the renderer's memory grows with every operation and is not given back. After several thousand operations in one session the renderer process was lost once; restart Plasticity before a long run.
- **Tested on geometry made by the tools themselves** (boxes, cylinders, lofts, simple sheets) in a fresh document. Not tested on heavy imported models from other CAD systems.

## Plasticity command → tool

### Primitives

| Plasticity | Tool | Limits |
|------------|------|--------|
| Box (corner, centre, three-point) | `create_box` | Axis-aligned: minimum corner and sizes. A turned box is `create_box` + `rotate_bodies`. |
| Sphere | `create_sphere` | — |
| Cylinder | `create_cylinder` | Base centre, radius, height, axis. |

A primitive is always a new body. Drawing a primitive on a body so that it cuts or joins it, as the window does, is `boolean` afterwards.

### Curves — creation

| Plasticity | Tool | Limits |
|------------|------|--------|
| Line, polyline | `create_polyline` | — |
| Curve (spline) | `create_spline` | Through the points, or with the points as control points. |
| Circle: centre, two-point, three-point | `create_circle` | — |
| Arc: three-point | `create_arc` | — |
| Arc: centre | `create_arc_center` | — |
| Tangent Arc | `create_tangent_arc` | From an end of an existing segment. |
| Tangent Circle | `create_tangent_circle` | Radius and two segments; `near` picks one of the solutions. |
| Ellipse | `create_ellipse` | — |
| Rectangle: corner, centre, three-point | `create_rectangle` | — |
| Polygon | `create_polygon` | — |
| Spiral | `create_spiral` | No taper angle; the pitch follows from `height` and `turns`. |
| Text | `create_text` | Built-in font only; no spacing or alignment options. |
| Slot | `create_slot` | Planar curves only, and **not a single straight line** (a line has no plane of its own). |

### Curves — editing

| Plasticity | Tool | Limits |
|------------|------|--------|
| Trim | `trim_curves` | Removes the piece nearest to the point `near`. |
| Cut (curves) | `cut` | Curves are cut where the cutter curves cross them. |
| Join | `join` | Curves must touch end to end. |
| Unjoin | `unjoin` | — |
| Offset Curve, Offset Region, Offset Vertex | `offset` | Planar curves. Region offset with one distance. |
| Fillet / Chamfer of curve corners | `fillet`, `chamfer` | Chosen vertices, or every corner of the curve. |
| Extend (curve) | `extend` | End vertices only. |
| Bridge | `bridge` | Between two curve vertices or two body edges; not at a point inside a curve. No tension, no trimming of the bridged curves. |
| Rebuild | `rebuild` | By tolerance, point count, or degree + spans. |
| Raise Degree | `raise_degree` | — |
| Subdivide | `subdivide_curves` | A control point in the middle of every segment. |
| Convert Vertex | `convert_vertices` | Corner → smooth. |
| Align Vertex | `align_vertices` | G0 / G1 / G2. |
| Move / Rotate / Scale of vertices and control points | `move_control_points`, `rotate_control_points`, `scale_control_points` | No proportional editing, no mirror mode. |
| Slide | `slide` | — |
| Delete vertex / control point | `delete_control_points` | — |
| Reverse | `reverse` | — |
| Curve from edges | `curves_from_edges` | — |
| Deform (curves) | `deform` | Source face → target face; no Scale / Offset / Flip options. |
| Delete redundant vertices | `dissolve_edges` | With a curve id. |
| Split Segment, Insert Knot | — | Not available, see below. |

### Profiles into bodies

| Plasticity | Tool | Limits |
|------------|------|--------|
| Extrude (curve, region) | `extrude_profile` | One distance along the plane normal; the other options of the command are not exposed. The profile curve is kept. |
| Revolve | `revolve_profile` | Axis and angle. |
| Sweep | `sweep_profile` | `twist` and end `scale`; alignment and corner style at their defaults. |
| Loft, Loft Guide | `loft_profiles` | Guides through `guideIds`. Kernel limits: a closed loop of closed profiles fails, and so do profiles turning through more than about half a circle — use sweep or revolve for ring shapes. |

A closed curve → Solid, an open one → Sheet. A curve id is refused when other curves in its plane cross it or lie inside it; then the profile is picked as regions (`list_regions` → `regionIds`).

### Solids

| Plasticity | Tool | Limits |
|------------|------|--------|
| Boolean: union, difference, intersection | `boolean` | Union of a Sheet target with a Solid tool fails in the kernel. |
| Fillet, Chamfer (edges) | `fillet`, `chamfer` | Constant radius / distance. **An oversized fillet does not fail** — it silently gives another shape; check the returned bounds. |
| Extrude (faces, push / pull) | `extrude_faces` | On a Sheet the extrusion becomes a new Solid. |
| Cut | `cut` | Cutters are curves or faces of another body. **No plane cutter** — Plasticity's Cut has none either; a plane cut is a straight line with `direction` and `extend`. |
| Hollow | `hollow` | One Solid per call. |
| Thicken, Thicken Face | `thicken` | Method (Offset / Punch) at its default. |
| Draft Face | `draft_faces` | The reference is a planar face of the same body. |
| Delete Face, Dissolve | `delete_faces` | See [differences](#where-a-tool-differs-from-the-command). |
| Remove Fillets | `remove_fillets` | — |
| Patch | `patch` | Continuity, fill preference and guide curves at their defaults. |
| Pipe | `pipe` | Diameter and wall thickness; round section only. |
| Join, Unjoin | `join`, `unjoin` | Curves or Sheets in one call, not a mix. |

### Faces and edges

| Plasticity | Tool | Limits |
|------------|------|--------|
| Move / Rotate / Scale Face | `move_faces`, `rotate_faces`, `scale_faces` | No freestyle variants; Grow mode at its default. |
| Move Edge | `move_edges` | — |
| Offset Face, Offset Face Loop, Offset Edge | `offset` | — |
| Match Face | `match_faces` | Grow and Side at their defaults. |
| Refillet | `refillet` | New radius, or a change of it. |
| Duplicate faces | `duplicate_faces` | Into a Sheet or a Solid. |
| Imprint | `imprint` | From curves or from crossing bodies. |
| Complete Edge | `complete_edges` | — |
| Dissolve edges, Delete Redundant Topology | `dissolve_edges` | — |
| Join Faces | `join` | Faces of one body on the same surface. |
| Isoparam | `isoparam` | — |
| Untrim | `untrim` | — |
| Unwrap | `unwrap_faces` | The result lies at the world origin. |
| Extend Sheet | `extend` | By a distance; not up to a target body. |
| Reverse (Sheet) | `reverse` | — |

### Projection

| Plasticity | Tool | Limits |
|------------|------|--------|
| Project: curve onto body, body with body, curve with curve | `project` | Onto one body per call. Curve-with-curve needs two planar curves. |
| Create Outline, Project Outline | `create_outline` | Along the active construction plane, or along an explicit plane. |
| Duplicate and Project (curves, edges) | `duplicate_and_project` | — |

### Surfaces

| Plasticity | Tool | Limits |
|------------|------|--------|
| Bridge Surface | `bridge_surface` | Works only when the two surfaces would meet at an angle if extended; parallel and coplanar Sheets are refused. |
| Constrained Surface | `constrained_surface` | At least four points. The Sheet is an untrimmed patch that reaches beyond the points. |
| Raise Surface Degree | `raise_degree` | — |
| Rebuild Face | `rebuild` | Refit by tolerance, one face per call. Explicit control is Studio-only. |
| Remove Nominal Surface | `remove_nominal_surface` | — |
| Surface control points: move, rotate, scale, Slide | `move_control_points`, `rotate_control_points`, `scale_control_points`, `slide` | Control points exist only on spline faces; `raise_degree` on a face creates them. |
| Deform (bodies) | `deform` | No Scale / Offset / Flip options. |

### Transforms and copies

| Plasticity | Tool | Limits |
|------------|------|--------|
| Move, Rotate, Scale | `move_bodies`, `rotate_bodies`, `scale_bodies` | No freestyle variants. |
| Duplicate | `copy_bodies` | — |
| Mirror | `mirror_bodies` | A plain mirrored copy. Cutting the body at the mirror plane and uniting the halves (symmetry modelling) is not exposed. Without the original it is two undo steps. |
| Rectangular Array, Radial Array | `array_rectangular`, `array_radial` | Copies or instances. |
| Curve Array | `array_curve` | The extent is a share of the curve, not a distance. |
| Instances: create, realize | `create_instances`, `realize_instances`, `list_instances`, `delete_instances` | An instance is placed when it is made; existing instances cannot be moved or hidden. |
| Place, Copy / Paste, Copy / Paste with Placement | — | Not available, see below. |

### Scene

| Plasticity | Tool | Limits |
|------------|------|--------|
| Selection | `select_bodies`, `select_topology`, `get_selection` | Bodies, faces and edges can be selected. Curve vertices, control points and regions cannot (regions and groups are reported). |
| Delete | `delete_bodies` | — |
| Rename | `rename_body` | — |
| Group, Ungroup, Move to group | `group_bodies`, `ungroup`, `move_to_group`, `list_groups` | Bodies only. No renaming or deleting of a group, no groups of groups. |
| Hide, Unhide All, Isolate | `set_visibility`, `unhide_all`, `isolate`, `unisolate` | Bodies only — not groups, instances or reference meshes. |
| Lock, Unlock All | `set_locked`, `unlock_all` | Bodies only. |
| Materials: create, assign, remove | `create_material`, `set_material`, `remove_material`, `list_materials` | Per body, not per face. An existing material cannot be edited or deleted. |

### Checking and measuring

| Plasticity | Tool | Limits |
|------------|------|--------|
| Check | `check_bodies` | — |
| Find Boundary Edges | `find_boundary_edges` | — |
| Measure distance | `add_measurement` | **Straight distance only**, between snap points of bodies (vertex, edge end / quarter / middle, circle centre, face centre). The axis-aligned distance of the window is chosen by the pointer. |
| Measure radius | `add_measurement` | A circular edge. |
| Measurements of the document | `list_measurements`, `delete_measurements` | No renaming, no moving of the label. |
| Measure Continuity | `measure_continuity` | Plasticity's own tolerances. |
| Section Analysis | `set_section_view`, `clear_section_view` | One plane. |
| Dimension | — | Not available, see below. |

### Files

| Plasticity | Tool | Limits |
|------------|------|--------|
| Export STEP | `export_step` | — |
| Export Parasolid | `export_parasolid` | `.x_t`, `.x_b` |
| Export STL, OBJ, 3MF | `export_mesh` | STL and OBJ in millimetres; 3MF in metres with the unit declared. |
| Export SVG (hidden-line drawing) | `export_drawing` | Solids and Sheets. |
| Export PNG | `screenshot` | The viewport as it is drawn, longest side ≤ 1568 px. |
| Import STEP, Parasolid | `import_step`, `import_parasolid` | Imported bounds can be a little inflated by the import tolerance. |
| Import SVG | `import_svg` | `rect`, `circle`, `path`, `polyline`; into the XY plane, y flipped. |
| Import STL, OBJ, 3MF | `import_mesh`, `list_reference_meshes`, `delete_reference_meshes` | A reference mesh, as in Plasticity — visible, but not a body. No moving or hiding. |
| Save | `save_document` | **A copy only.** |
| New, Open | `new_document`, `open_document` | In place of the open document. |
| Export / import IGES, SAT | — | Studio edition. |

File tools take absolute paths, check the extension and do not replace an existing file without `overwrite: true`.

### Environment, view, history

| Plasticity | Tool | Limits |
|------------|------|--------|
| Construction plane | `set_construction_plane` | The active plane only; saved planes of the document are not handled. |
| Units, grid | `get_environment` | **Read only.** |
| View orientation | `set_view` | Six axis views and isometric, optional fit. |
| Undo, Redo | `undo`, `redo` | — |

### Not commands of Plasticity

- **Session:** `native_launch`, `native_connect`, `native_status` — starting Plasticity with native access and attaching to a window.
- **Bridge channel:** `connect`, `status`, `list_scene`, `get_object`, `subscribe_changes`, `unsubscribe_changes`, `drain_events`, `refacet`, `push_mesh` — the WebSocket protocol of the official Blender bridge. Read side only: scene listing, change events, retessellation. `push_mesh` needs an opcode that 26.1.x does not advertise, so it is refused there.

## Not available

| Plasticity command | Why | What to use instead |
|--------------------|-----|---------------------|
| Split Segment, Insert Knot | The position comes only from the pointer. | `cut` on curves; `subdivide_curves`, `raise_degree`. |
| Place | The placement comes only from clicks on snap points. | `copy_bodies` or `create_instances`, then the transform tools. |
| Copy / Paste, with or without placement | Placement needs clicks; a plain paste waits in a gizmo and uses the system clipboard. | `copy_bodies`. Nothing moves objects between two documents. |
| Dimension | Its data is built inside the interactive command. | `refillet`, `scale_faces`, `offset`, `move_faces`. |
| Set units, set grid | There is no command; the window writes its settings directly. | — (`get_environment` reports them) |
| Save under the document's own name | The native save opens the system file dialog. | `save_document` (a copy), then `open_document` of that file — history and ids start anew. |
| Align, PolySplines, xNURBS, Square, Rebuild Face with explicit control | Studio edition. | — |
| IGES, SAT | Studio edition. | STEP, Parasolid. |
| Publish to Plasticity Share | Uploads the document to the web; left out on purpose. | — |
| Freestyle move / rotate / scale, gizmos | Interactive by nature. | The transform tools with numbers. |
| Display toggles (curvature, control points, …) | Display only; left out of the plan. | — |
| Volume, area, mass | Not a Plasticity command, and the kernel binding does not expose them. | Export and measure elsewhere. |

## Where a tool differs from the command

- **`delete_faces` heals by default.** Plasticity's Delete Face leaves an open Sheet; closing the gap is its separate Dissolve. The tool does Dissolve unless `heal: false`.
- **`cut` with a plane** is a straight line, `direction` and `extend: true`.
- **`patch` of a region fills every loop separately:** a plate region with a hole gives a full plate and a disc, not a plate with a hole.
- **`extrude_faces` on a Sheet** leaves the Sheet and creates a new Solid.
- **`untrim`** detaches the face: it keeps the body's id as a Sheet, the rest of the body becomes separate Sheets.
- **`mirror_bodies`** always makes a plain copy (Plasticity's Mirror cuts at the plane by default).
- **`create_outline`** can take an explicit plane, which does not touch the window; without it, it follows the active construction plane as the command does.
- **`save_document`** leaves the open document, its title and its unsaved state as they are.
- **`open_document` and `new_document`** refuse while there are unsaved changes, unless `discardChanges: true`; there is no dialog.
- **`add_measurement`** makes straight distances; the window's default is a distance along one axis.
- **Not undo steps:** the selection, the camera, the section view, the construction plane, exports, and opening or starting a document. Everything that changes geometry, names, visibility, locking, materials, groups and measurements is one undo step — except `mirror_bodies` without the original (two).
- **Results list what changed:** `created`, `changed`, `removedIds`. Transforms keep body ids; `join` keeps the id of the first item; a cut keeps the target id on one piece.

## Not verified

Each block in [task.md](../task.md) ends with its own "Not verified / not exposed" list. The common points:

- geometry imported from other CAD systems, tolerant edges, heavy models;
- most tools on spline surfaces and on Sheets beyond the basic cases;
- tilted planes and directions for arrays, mirrors, arcs and ellipses;
- several viewports, a minimized window for measurements and `open_document`;
- files written by other programs for the import tools, and how other programs read the exported files.
