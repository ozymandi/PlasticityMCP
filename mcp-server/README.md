# plasticity-mcp

MCP server for [Plasticity](https://www.plasticity.xyz/) 26.1.x. Talks the existing built-in WebSocket protocol (the one used by the official Blender bridge), no fork required.

## Tools (Phase 1 MVP)

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

> Raw vertex/index/normal arrays are **never** returned to the LLM (they would blow up context). Only counts and bounding boxes. A future phase will add a binary export tool that writes geometry to disk.

## Native CAD tools (CDP, Plasticity 26.1.3 only)

A second channel, independent of the WebSocket bridge: real B-Rep operations through Plasticity's own factories and history. Unofficial, against internal APIs, pinned to **26.1.3** — any other version is refused. Units are millimetres.

| Tool | Description |
|------|-------------|
| `native_launch` | Start Plasticity 26.1.3 with a loopback-only debugging endpoint (`127.0.0.1:9223`). Never closes a running instance — if Plasticity runs without native access, close it yourself first. |
| `native_connect` | Attach to a window (`targetId` needed only with several windows). |
| `native_status` | Connected window, busy flag, undo/redo depth, body count. |
| `create_box` | `origin` (min corner) + `size`. |
| `create_sphere` | `center` + `radius`. |
| `create_cylinder` | `base` (bottom cap centre) + `radius` + `height`, optional `axis`. |
| `undo` / `redo` | Native history. |
| `list_bodies` | All bodies: stable id, type (Solid / Sheet / Wire), name, bounds, face/edge counts, visible / locked / selected. |
| `get_selection` | Bodies selected in the window (whole bodies, not faces or edges). |
| `select_bodies` | Replace the selection; empty list clears it. Not an undo step. |
| `delete_bodies` | Native Delete by id. Undoable. Clears the selection. |
| `rename_body` | Rename a body. Undoable. |
| `move_bodies` | Translate by `delta`. |
| `rotate_bodies` | Rotate `angle` degrees around `axis` through `pivot`. |
| `scale_bodies` | Scale by `factor` (number or `[x, y, z]`) relative to `pivot`. |

| `copy_bodies` | Independent copies of bodies or curves, optional `delta` shift. |
| `mirror_bodies` | Mirrored copies across a plane (`planeOrigin`, `planeNormal`); `keepOriginal: false` deletes the originals (two undo steps). |
| `array_rectangular` | Row or grid of copies: `direction1` / `count1` / `spacing1`, optional second direction. Counts include the original. |
| `array_radial` | `count` items around an axis (`center`, `axis`) over `angle` degrees. |
| `get_body_topology` | Faces and edges of a body with ids and geometry (`include`: faces / edges / all). |
| `boolean` | `union` / `difference` / `intersection` of `toolIds` against `targetIds`; `keepTools` optional. |
| `fillet_edges` | Round edges with `radius`. |
| `chamfer_edges` | Bevel edges by `distance`. |
| `extrude_faces` | Push / pull faces of a Solid by `distance`: positive adds outward, negative cuts in. On a Sheet the extrusion becomes a new Solid. |

| `create_polyline` | Curve of straight segments through `points`; `closed` makes a profile. |
| `create_spline` | Smooth curve through `points`. |
| `create_circle` | Circle from `center`, `radius`, optional plane `normal`. |
| `create_arc` | Arc through three points (`start`, `through`, `end`). |
| `create_arc_center` | Arc around `center` from `start` through `angle` degrees about `normal`. |
| `create_ellipse` | Ellipse from `center`, `majorRadius`, `minorRadius`, optional `normal` and `majorDirection`. |
| `join_curves` | Merge curves that touch end to end into one (keeps the first id). |
| `list_regions` | Regions Plasticity built from closed loops of curves: id, bounds, normal, boundary length, holes. |
| `extrude_profile` | Closed planar curve → Solid, open curve → Sheet, by `distance` along the plane normal. Takes a curve `id` or `regionIds`. |

| `revolve_profile` | Revolve a curve around an axis (`axisOrigin`, `axis`, `angle`): closed → Solid, open → Sheet. |
| `sweep_profile` | Sweep a profile curve along a path curve; optional `twist` and end `scale`. |
| `loft_profiles` | Loft through ordered profiles; optional `guideIds`, `closed`. Closed profiles → Solid, open → Sheet. |
| `export_step` | Exact B-Rep export to `.step` / `.stp`; all Solids and Sheets unless `ids` given. |
| `export_parasolid` | Exact B-Rep export to `.x_t` (text) or `.x_b` (binary). |
| `export_mesh` | Triangle mesh to `.stl`, `.obj` or `.3mf` (millimetres, Z up); `tolerance` and `angle` control the density. |
| `export_drawing` | Technical drawing as SVG in millimetres: hidden-line projections of the chosen `views`, laid out left to right. |
| `import_step` | Add a STEP file's geometry to the document. Undoable. |
| `save_document` | Save a **copy** as `.plasticity`; the open document stays as it is. |
| `set_view` | Camera to front / back / left / right / top / bottom / isometric; `fit` frames all bodies. |
| `screenshot` | PNG of the 3D viewport (longest side ≤ 1568 px), returned as an image; optional `path`. |

`native_launch` adds Chromium switches that keep the window drawing while it is covered by other windows, so everything works at full speed with Plasticity in the background. A **minimized** window does not draw: `set_view` and `screenshot` then fail with a clear message (`native_status` reports `windowVisible`) and modelling tools slow down to about two seconds per operation.

File tools take absolute paths, check the extension and never replace an existing file without `overwrite: true`.

The profile tools (`extrude_profile`, `revolve_profile`, `sweep_profile`, `loft_profiles`) take either a curve id or `regionIds` from `list_regions`. A curve id is refused when other curves in its plane cross it or lie inside it; regions are how to pick the plate-with-holes area, or a profile drawn as several lines and arcs.

Face and edge ids are valid only until the body changes — re-read `get_body_topology` after every operation on it. Region ids likewise change whenever curves in their plane change. Stale ids are rejected.

`pivot` is optional for rotate and scale; it defaults to the centre of the bodies' combined bounding box.

Mutating tools return `created` and `changed` bodies (stable id, type, name, bounds, …) and `removedIds`. Transforms keep body ids, so their result is in `changed`.

Live check — mutates the document, so it only runs in a fresh "Untitled" one and undoes everything:

```bash
npm run smoke:native
```

Plasticity must be started through `native_launch` (or `smoke:native`); a normally started instance has no debugging endpoint. See `../task.md` for how the access works.

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
