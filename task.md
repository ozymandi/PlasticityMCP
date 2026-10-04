# PlasticityMCP — Task

## Goal

Build an MCP server that lets an LLM **generate and modify 3D geometry** inside Plasticity (v2026.1 / 26.1.x) on the local machine.

## Context

- Plasticity is open-source (https://github.com/nkallen/plasticity), TypeScript + Electron, C3D geometric kernel.
- **Plasticity already runs a built-in WebSocket server** used by the official Blender bridge (https://github.com/nkallen/plasticity-blender-addon). This is a major shortcut — we do NOT need to fork to read the scene or push meshes.
- Architecture inside Plasticity: `CommandExecutor` runs `Command` objects against a `GeometryDatabase`. 50+ built-in commands.
- Internal use only for now (no public release, license review deferred).
- Target version: **2026.1.x** (currently installed: 26.1.2 → 26.1.3 available).

## Existing Plasticity WebSocket protocol (from Blender addon)

**Client → Plasticity:**
- `HANDSHAKE_1`
- `LIST_ALL_1`, `LIST_VISIBLE_1`
- `SUBSCRIBE_ALL_1`, `UNSUBSCRIBE_ALL_1`, `SUBSCRIBE_SOME_1`
- `REFACET_SOME_1` (request retessellation at given quality)
- `PUT_SOME_1` ← **uploads mesh data into Plasticity**

**Plasticity → Client (events / responses):**
- `TRANSACTION_1`, `ADD_1`, `UPDATE_1`, `DELETE_1`, `MOVE_1`, `ATTRIBUTE_1`
- `NEW_VERSION_1`, `NEW_FILE_1`
- `LIST_ALL_1`, `LIST_SOME_1`, `LIST_VISIBLE_1`, `REFACET_SOME_1`, `PUT_SOME_1`, `HANDSHAKE_1`

**What this gives us out of the box:**
- ✅ Read full scene graph
- ✅ Subscribe to live changes
- ✅ Push mesh objects into Plasticity (facet data)

**What it does NOT give us:**
- ❌ Invoke CAD commands (Extrude, Fillet, Boolean Union, etc.) — these go through `CommandExecutor`, not exposed to WS

## Architecture (revised)

```
LLM (Claude) ──stdio──> MCP server (Node/TS) ──WS──> Plasticity
                                                ├─ Phase A: existing protocol (no fork)
                                                └─ Phase B: forked + extended opcodes (CAD ops)
```

## Phases (revised after Phase 2 recon — see docs/architecture.md)

| # | Phase | Status | Deliverable / Notes |
|---|-------|--------|---------------------|
| 0 | **Recon WS protocol** | ✅ Done (~2 h) | Full opcode spec from blender-addon source → `docs/ws-protocol.md` |
| 1 | **MCP MVP — read/subscribe/refacet/(push-mesh)** | ✅ Done (~3 h) | Verified live against Plasticity 26.1.2. `push_mesh` wired but server-rejected: 26.1.2 does not advertise `PUT_SOME_1`. |
| 2 | **Recon CommandExecutor** | ✅ Done (~1 h) | **Critical finding:** OSS repo frozen at v1.4-era (2023); current 26.x binary is closed-source. Tags v26.x point at 2023 commit. **Phase 3 fork is dead** — see `docs/architecture.md`. Captured Command/Factory pattern as reference for future paths. |
| 3 | ~~**Bridge patch (fork)**~~ | ❌ **Dead** | OSS source too stale to fork against. |
| **Replan** | See architecture.md | — | Six paths analysed (A-F); recommend Path A check first, then Path D spike. |

## Active path (post-recon, post-Path-D verification)

### Verification matrix (all done 2026-04-28)

| Probe | Result |
|-------|--------|
| Update to 26.1.3 + smoke test for `PUT_SOME_1` | ❌ Same 13 opcodes; 26.1.3 source-zip is byte-identical to 2023 OSS snapshot |
| `--remote-debugging-port=9222` flag | ❌ Process accepts the flag but Electron strips CDP; port 9222 not listening |
| `resources/app/` packed as `.asar`? | ❌ Unpacked — but only loader stub. Real code in `index.compiled/index.jsc` (12 MB **bytenode V8 bytecode**) |
| `window.editor` / `window.cmd` / `window.THREE` | ❌ All `undefined` — debug exports stripped from commercial build |
| `globalThis` non-enumerable properties | ❌ Only `IDBDatabase`, `openDatabase`, `__THREE__` (THREE.js dev hook = version string) |
| F12 → DevTools | ✅ Opens, but with no handles to app internals |

**Conclusion:** Plasticity 26.x is **deliberately, multi-layer locked**. Every modification path we tried was closed by design. The dev has invested significantly in this — it's policy, not oversight.

### Surviving paths

| Path | Verdict |
|------|---------|
| **B. Feature request → official `EXEC_COMMAND_1` opcode** | Submit at plasticity.canny.io. Draft in `docs/feature-request.md`. Long timescale, but the only **clean** path to real CAD generation. |
| **F. UI automation via Windows-MCP** | Works today, very fragile. Separate project — not really "MCP for Plasticity" but "automate any Windows app". Pursue only if Path B stalls and writes are critical. |
| **Phase 1 read-only MVP** | Already shipped and useful: live scene read, subscribe, refacet. Real value for "AI as observer/commenter". |

### Recommended posture

**Ship Phase 1 as the MVP today.** File the feature request. Re-evaluate when (a) Plasticity dev responds, (b) PUT_SOME_1 appears in a future build, or (c) we decide we want UI-automation badly enough.

**Phases 4–7 are parked** until a write path opens.

## Re-check 2026-10-04 — write path is OPEN (unofficially)

**Status:** recon + spike passed; native stage 1 implemented and verified live (see "Native stage 1" below).

### Official side — nothing changed

| Probe | Result |
|-------|--------|
| Newest release | **26.1.4** (2026-08-14), empty release notes. Installed here: 26.1.3. |
| Official scripting / API / MCP / `EXEC_COMMAND` opcode | ❌ None. Docs "What's new" still ends at 2026.1. |
| OSS repo `nkallen/plasticity` | ❌ Still the frozen 2023 snapshot, tags only. |
| Blender addon | No commits since 2026-04-10. |

### Third-party side — Path D (CDP) was solved by others in September 2026

| Repo | Target | Notes |
|------|--------|-------|
| `te9no/plasticity-mcp` (2026-09-09) | Windows, Plasticity **25.3.0** | **Fork of this repo** (carries our task.md / docs). 37 native CAD tools. On 25.3.0 the plain `--remote-debugging-port` flag still works. |
| `Mesteriis/plasticity-mcp` v0.2.1 (2026-09-28, MIT) | macOS arm64, Plasticity **26.1.3** | 116 tools (box/sphere/cylinder, boolean, fillet, extrude, move/rotate/scale, STEP import/export, screenshots, undo/redo). |
| `Sparrow51/PlasiticityMCP_Mac2Win_Port` (2026-09-28) | **Windows, 26.1.3** | Port of Mesteriis. 0 stars, 2 commits — unverified by us. |

### The two things our April recon missed

1. **CDP port:** 26.x strips `--remote-debugging-port`, but does NOT block the Node main-process inspector. Launch with `--inspect-brk=127.0.0.1:9229`, attach, and before app code runs evaluate: neutralise `app.commandLine.removeSwitch` for `remote-debugging-port` + `appendSwitch('remote-debugging-port', '9223')`, then resume. Renderer CDP comes up on loopback. No files patched, nothing re-signed.
2. **Editor handle:** `window.editor` is indeed stripped, but the editor and Factory classes are reachable through **closure scopes**: evaluate the `command-log.handleCommandStarted` callback, walk `[[Scopes]]` via `Runtime.getProperties`, then `Runtime.callFunctionOn`. Commands run via `editor.exec` + `factory.commit()` → native B-Rep, native Undo/Redo.

Version notes: on 26.1.3 geometry lives in `editor.geo.geometryModel` (not `editor.db.items` as on 25.3); `FaceExtrudeFactory` is gone, use `ExtrudeFactory`. Internal units are metres.

### Caveats

- Unofficial, against internal APIs — pinned per version; any update can break it or close the inspector hole. **Do not update to 26.1.4 until verified.**
- Plasticity must be started through the launcher (a running instance has to be closed and relaunched).
- Dev clearly strips debug access on purpose → ToS / goodwill risk if published; fine for internal use.

### Spike result — ✅ PASSED on this machine (2026-10-04, Windows, 26.1.3, Electron 26.6.9)

Read-only probe, no scene mutation, no files patched.

| Step | Result |
|------|--------|
| Launch `app-26.1.3\Plasticity.exe --inspect-brk=127.0.0.1:9229` | ✅ Main inspector up, paused at `electron/js2c/browser_init` |
| Startup hook (neutralise `removeSwitch`, append `remote-debugging-port=9223`) | ✅ Accepted |
| Renderer CDP on `127.0.0.1:9223` | ✅ Target `…/renderer/app_window/index.html` |
| `document.querySelector('command-log').handleCommandStarted` → `[[Scopes]]` | ✅ Scope 0 holds `editor` (class `Editor`) |
| `editor` surface | ✅ `exec`, `undo`, `geo.geometryModel`, `db`, `history`, `selection`, `executor`; **176 commands** in `editor.commands` |
| App-module closure (scope 1) | ✅ 5123 bindings, **182 `*Factory` classes** by name (Boolean, Extrude, Fillet*, Curve, ExportCad, ExchangeImport, …) |

Gotchas found:
- Function source is hidden (bytecode) — `description` is zero-width chars, so classes must be found by **binding name**, not by source text.
- Scope 1 `Runtime.getProperties` response is large: Node's built-in `WebSocket` drops the connection (1006); the `ws` package handles it.
- Never enumerate the `Global` scope.

### Decision (Designer, 2026-10-04)

**Path (b):** port the technique into our own `mcp-server` and grow the tool set block by block. Server is **pinned to 26.1.3** — any other version is refused.

## Native stage 1 — ✅ Done (2026-10-04, ~3 h)

New in `mcp-server/src/`: `cdp.ts` (CDP client on `ws`), `launcher.ts` (`--inspect-brk` launch, never closes a running instance), `native.ts` (editor/Factory discovery, serialized command execution), `native-smoke.ts` (`npm run smoke:native`).

New MCP tools (the 9 WS tools are untouched): `native_launch`, `native_connect`, `native_status`, `create_box`, `create_sphere`, `create_cylinder`, `undo`, `redo`. Input units are mm; mutating tools return created bodies (stable id, type, name, bounds) and removed ids.

Verified live on 26.1.3 in an Untitled document:
- `smoke:native` passes: box / sphere / cylinder (+Z and +X axis) bounds exact, Undo/Redo, document returned to baseline.
- Built stdio server exercised end to end (tool list, not-connected error, zod validation errors, create → undo → redo → undo).

Findings:
- A new document is **not empty** — it holds a default 1000 mm cube (stable id 1).
- Command pattern: `new editor.commands.XCommand(editor)`, override `execute`, `new Factory(editor).resource(command)`, `factory.commit()`, run via `editor.exec`. Errors inside `execute` are swallowed by the executor and must be captured manually.
- Factories used: `ThreePointBoxFactory` (p1–p4), `PossiblyBooleanSphereFactory` (center, radius), `PossiblyBooleanCylinderFactory` (`center` = **base** cap centre, orientation quaternion, radius, height).
- Bodies: `editor.geo.geometryModel` → `db.lookupStableId(versionId)`, bounds via `item.model.FindBox()` (metres).

**Not verified:** the cold-start path of `launcher.ts` (Plasticity closed → `native_launch`). The same logic passed in the spike script, but the TypeScript version has only run against an already-launched instance. *(closed 2026-10-04 — see "Verification debt closed")*

Committed as `f9642f0` on branch `native-stage-1`.

## Native block 1 — scene — ✅ Done (2026-10-04, ~1.5 h)

New tools: `list_bodies`, `get_selection`, `select_bodies`, `delete_bodies`, `rename_body` (22 tools total). Body records now also carry `faceCount`, `edgeCount`, `visible`, `locked`, `selected`.

Verified live on 26.1.3 (Untitled): `smoke:native` extended and passing (topology counts, rename + Undo, select / get_selection, unknown id rejected without touching the selection, clear selection, delete + Undo); built stdio server exercised end to end incl. validation errors.

Findings:
- `editor.selection.selected.add(view)` works for Solid and Wire alike; `selected.has(view)` and `selected.items` read it back. Selection changes are not undo steps.
- Delete = select + native `DeleteCommand`. Rename = `db.nodes.setName` wrapped in a carrier command (`GroupSelectedCommand` with replaced `execute`) so it lands in history.
- Sketch curves produce extra Wire fragments without a stable id — they are filtered out of all listings.
- Renderer errors carry a stack trace; only the first line is returned to the client.

**Not verified:** delete / rename on a Wire or Sheet (only selection of a Wire was probed); cold start of `launcher.ts` (still pending from stage 1). *(closed 2026-10-04 — see "Verification debt closed")*

`smoke:native` guard relaxed: runs in an "Untitled" document that is either pristine or has no bodies.

Committed as `7d66476` on branch `native-stage-1`.

## Native block 2 — transforms — ✅ Done (2026-10-04, ~1 h)

New tools: `move_bodies`, `rotate_bodies`, `scale_bodies` (25 tools total). Mutation results gained a `changed` list (bodies that kept their id but differ), since transforms preserve stable ids.

Designer's decision: default `pivot` for rotate / scale = **centre of the bodies' combined bounding box** (computed from the state read just before the command).

Verified live on 26.1.3 (Untitled): `smoke:native` extended and passing — move, rotate 90° about Z with default and explicit pivot, uniform ×2 and non-uniform [2, 1, 0.5] scale, Undo after each, two bodies at once, unknown id rejected. Built stdio server exercised end to end incl. validation errors (zero axis, negative factor, empty ids).

Findings:
- Factories / commands: `MoveItemAndEmptyFactory` + `MoveItemCommand` (`items`, `move`), `RotateItemAndEmptyFactory` + `RotateItemCommand` (`items`, `pivot`, `rotation` quaternion — set it directly, not via `axis`), `ProjectingScaleItemAndEmptyFactory` + `ScaleItemCommand` (`items`, `pivot`, `scale`).
- Stable ids survive all three transforms and their Undo.

**Not verified:** transforms on Wire / Sheet bodies; cold start of `launcher.ts` (still pending from stage 1). *(closed 2026-10-04 — see "Verification debt closed")*

Committed as `34e1f15` on branch `native-stage-1`.

## Native block 3 — topology, boolean, fillet, chamfer, extrude — ✅ Done (2026-10-04, ~2.5 h)

New tools: `get_body_topology`, `boolean`, `fillet_edges`, `chamfer_edges` (added on Designer's request), `extrude_faces` (30 tools total).

Verified live on 26.1.3 (Untitled): `smoke:native` extended and passing — box / cylinder topology, difference / union / intersection (incl. `keepTools`), fillet (4 cylinder faces r = 2), chamfer (4 planar faces), extrude +5 / −4, stale ids rejected, Undo after each. Built stdio server exercised end to end as a chain (drill hole → fillet → extrude top) incl. validation errors.

Findings:
- Face / edge ids look like `39f1775` / `39e1771` (prefix = body version). **Every change to a body renames all of them**; Undo brings the old ids back. Stale ids are rejected with an explicit message.
- Topology: `item.model.GetFaces()` / `GetEdges()` joined to `view.high.faces|edges` by `entityId`.
- Boolean codes confirmed live: 15901 intersection, 15902 difference, 15903 union (`BooleanFactory`: `targets`, `tools`, `operationType`, `keepTools`). Target keeps its id.
- Fillet and chamfer share `FilletShellFactory` (`shell`, `edges`, `distance`): positive = fillet, negative = chamfer.
- `ExtrudeFactory` with only `faces` creates a **separate new Solid**. Setting `factory.targets = [view]` makes it a true push / pull: positive distance unions outward, negative cuts in; the body keeps its id.
- **An oversized fillet does not fail** — radius 30 on a 40 × 30 plate silently produced a different, smaller shape. The tool cannot detect this; the caller has to check the returned bounds.

Scope decisions: extrude covers faces of a body only; extruding a profile from a curve moves to block 4.

**Not verified:** these operations on Sheet bodies; multi-target booleans; cold start of `launcher.ts` (still pending from stage 1). *(closed 2026-10-04 — see "Verification debt closed")*

## Verification debt closed (2026-10-04, ~1.5 h)

All "Not verified" items from stage 1 and blocks 1–3 were checked live on 26.1.3.

| Item | Result |
|------|--------|
| Cold start (`launcher.ts`, Plasticity closed → launch → full `smoke:native`) | ✅ Passes — after one fix (below) |
| Wire: select, rename, move, rotate, scale, delete (+ Undo) | ✅ All work; `get_body_topology` rejects a Wire with a clear message |
| Sheet: topology, rename, move, rotate, scale, fillet, chamfer, delete | ✅ All work |
| Sheet: `extrude_faces` | ❌ → ✅ Failed with `PK_ERROR_boolean_failure`; fixed (below) |
| Boolean with Sheets | Solid target / Sheet tool `difference` **splits** the solid (one body changed + one created). Sheet target / Solid tool: `difference` and `intersection` work, `union` fails with a native error (propagated as is) |
| Boolean with two targets and two tools | ✅ Works; now in `smoke:native` |

Fixes made:
- **Connect during load.** After a cold start the CDP target appears before the app has loaded (title still `index.html`). `native_connect` now waits (up to 40 s) for the command log, `editor.windowLoaded`, and a real document title.
- **`extrude_faces` on a Sheet.** A Sheet cannot be the boolean target of an extrusion. For a Sheet the tool now extrudes without a target: the result is a **new Solid** (in `created`), the Sheet stays.
- **Stale crash-recovery backup.** Plasticity rewrites `%TEMP%\plasticityackup.production.plasticity` after each history change but **skips the write while the previous one is still running**. Rapid back-to-back operations (as an MCP client issues them) left a stale backup, and Plasticity restores that backup into "Untitled" on the next start — the cold-start run came up with three bodies from an earlier smoke run. Every mutation now waits for `editor.backup.isBusy` to clear first. Verified: backup file matches the final state after `smoke:native` and after the stdio chain.
- **`smoke:native` guard.** An Untitled document can hold restored unsaved work, so "untitled with no history" was not a safe test for disposability. The smoke now runs only if the document is empty or holds just the default 1 m cube.

Wire / Sheet checks were one-off probes (the public tools cannot create curves or sheets yet); permanent `smoke:native` coverage for them comes with block 4.

**Still not verified:** the refusal path of `native_launch` when Plasticity is running *without* native access (needs a normally started instance).

Block 3 and the debt-closure fixes are committed on branch `native-stage-1`. The MCP client must be restarted to see the new tools.

## Native block 4 — curves and profile extrusion — ✅ Done (2026-10-04, ~2 h)

New tools: `create_polyline`, `create_spline`, `create_circle`, `extrude_profile` (34 tools total).

Verified live on 26.1.3 (Untitled): `smoke:native` extended and passing — open / closed polyline, spline, circle (default and +X normal), rectangle profile → 6-face Solid, circle → cylinder, open polyline → 2-face Sheet, nested profile refused, non-planar closed curve refused, Solid refused as a profile, Undo throughout. Built stdio server exercised end to end (triangle → prism, circle → rod → fillet) incl. validation errors.

The one-off Wire / Sheet probes from the debt closure are now permanent `smoke:native` checks: move and delete a curve, topology rejects a curve, fillet on a Sheet, `extrude_faces` on a Sheet, delete a Sheet.

Findings:
- Curves: `CurveFactory` + `CurveCommand` (`points`, `type` = `CurveType.Polyline | NURBS`, `closed`); circle: `CenterCircleFactory` + `CenterCircleCommand` (`center`, `orientation` quaternion, `point` on the circle). A spline interpolates its points.
- Plasticity builds `SketchIsland` items with `Region`s automatically from the closed curves of a plane; nested / overlapping curves share one island. A Region does not say which curve it came from, and its bounding box comes from the display mesh (≈0.01 mm off for a circle).
- `extrude_profile` matches by bounding box: exactly one Region of the curve's plane may lie inside the curve's box and it must fill it (tolerance 1 % of the box diagonal). So a curve with another closed curve nested in it is refused, while the inner curve still extrudes.
- Closed planar curve → `factory.regions`; open curve → `factory.curves` (gives a Sheet). A closed non-planar curve fails `editor.curves.lookup` and is refused.
- Direction: positive distance follows the plane normal — +Z for XY-plane curves regardless of winding, +X for a circle created with normal +X. Not checked for curves in arbitrary planes built from points only; the tool description tells the caller to check the returned bounds.
- The profile curve is kept after extrusion.

**Not verified:** closed spline as a profile; direction for curves in arbitrary point-defined planes; the refusal path of `native_launch` when Plasticity runs without native access.

Block 4 is committed on branch `native-stage-1`. The MCP client must be restarted to see the new tools.

## Native block 5 — STEP, save, camera, screenshot — ✅ Done (2026-10-04, ~2.5 h)

New tools: `export_step`, `import_step`, `save_document`, `set_view` (added on Designer's request), `screenshot` (39 tools total). New module `files.ts` holds the file-safety rules.

Designer's decisions: `save_document` saves a **copy** (the open document keeps its file association); `set_view` included.

Verified live on 26.1.3 (Untitled): `smoke:native` extended and passing — STEP export (valid header, overwrite refused / allowed, relative path and wrong extension refused), STEP import round trip (same face count and bounds), save copy (valid file, document and title untouched), all seven views by camera direction, screenshot (PNG within the size cap, file matches). Built stdio server exercised end to end; screenshot arrives as MCP image content. Screenshots were inspected visually.

Findings:
- File tools: absolute paths only, extension check, no overwrite without `overwrite: true`; Plasticity writes to a staging folder in `%TEMP%`, the result is validated and only then copied to the target.
- Export: `ExportCadFactory` (`items`, `filePath`), no history entry. Import: `ExchangeImportFactory` inside `ImportCommand` (a closure binding, not in `editor.commands`), one undo step, 5 min timeout. **Imported bounds are slightly inflated** by import tolerance (box +0.00005 mm, cylinder ≈ +0.19 mm).
- Save: `editor.saver.save(path)` writes the file and leaves `document.filename` / window title alone.
- Views: `viewport.navigateToOrientation(n)` with right 0, back 1, top 2, left 3, front 4, bottom 5 (Z up, front looks along +Y). **Navigation is animated and its promise resolves early** — the tool waits until the camera pose stops changing. The six axis views put the viewport in an "aligned" state (view label, X-ray, construction plane); isometric via `orbitControls.setQuaternion` does not end it, so the tool calls `viewport.transitionFromAlignedView()`.
- Screenshot: `Page.captureScreenshot` clipped to the `plasticity-viewport` element (includes the viewport's overlay panels), scaled so the longest side is ≤ 1568 px (below the 2000 px limit that breaks many-image sessions). No focus stealing; a hidden / minimized window is reported as an error.
- **Errors thrown inside a native command show up as a red toast in the Plasticity window** (e.g. "Extrude — Body 74 is a Solid, not a curve"). Harmless, but the user sees every refused operation.
- `set_view` / `screenshot` act on the **first viewport** only; the camera is left where the last `set_view` put it (not part of the undo history).

**Not verified:** split (multi-viewport) layouts; importing STEP files from other CAD systems (only Plasticity's own export was round-tripped); the refusal path of `native_launch` when Plasticity runs without native access.

Block 5 is committed; branch `native-stage-1` is merged into `main` (fast-forward) and the root `README.md` is rewritten for the current state. The MCP client must be restarted to see the new tools.

### Agreed roadmap (blocks 1–5) is complete

## Native block 6 — revolve, sweep, loft — ✅ Done (2026-10-04, ~3.5 h)

Work is on branch `native-block-6` (`main` is published). Designer chose the **extended** parameter set.

New tools: `revolve_profile` (`axisOrigin`, `axis`, `angle`), `sweep_profile` (`twist`, `scale`), `loft_profiles` (`guideIds`, `closed`) — 42 tools total. `extrude_profile`'s region lookup moved into a shared `profileOf` snippet used by all four profile tools; `commandFunction` can now take the command class as a binding.

Verified live on 26.1.3 (Untitled), `smoke:native` extended and passing:
- Revolve: rectangle in the XZ plane 360° → 4-face ring, 90° → right-hand-rule sector, open line → Sheet, axis through the profile refused with a hint. This also closes the block 4 gap "profiles in point-defined vertical planes".
- Sweep: circle along a line → cylinder, around a mitred corner, `scale` 2 doubles the far end, `twist` 45° on a square, closed circular path → torus, path = profile and Solid-as-path refused.
- Loft: square → circle Solid, guide curve bulges the result, open lines → Sheet, closed loft of three open lines wraps around, mixed closed/open and single profile refused.

Findings:
- `RevolveFactory` and `SweepFactory` share the extrude-style profile inputs (`regions` for closed curves → Solid, `curves` for open → Sheet). Revolve: `origin`, `axis`, `degrees`. Sweep: `spine`, `twistDegrees`, `scale` (alignment Normal and Mitre corners left at their defaults).
- Solid loft: `RegionLoftFactory` + `LoftCommand` (`regions`, `guides`, `closed`). Sheet loft: `CurveLoftFactory` + `LoftEdgeCommand` (closure binding; `profiles`, `guides`, `closed`, `join = false`; reads the selection, so it is cleared first).
- A sweep profile drawn away from the path keeps its offset. A path lying in the profile's own plane and crossing it splits the profile's Region, so the profile is reported as ambiguous (message reworded: "other curves in the same plane cross it or lie inside it").
- **Kernel limits of Solid lofts:** a closed loop of closed profiles always failed (`PK_BODY_make_lofted_body` 22001), and profiles turning through more than about half a circle failed too (21555) while a 90° arc of four circles worked. Probably profile orientation: Plasticity normalises the plane normal of each Region. The tool appends a hint pointing to `sweep_profile` / `revolve_profile` for ring shapes (the torus sweep is verified).
- Bounds of lofted bodies come out a few microns large (0.003 mm on a 40 mm part).

### Covered window: slow operations, no camera, no screenshot (found during block 6)

When the Plasticity window is **completely covered by another window** (not only when minimized), Chromium marks the page hidden (`document.hidden`): it stops drawing frames and throttles timers.

Measured on this machine:
- Every mutating tool takes **≈ 2 s instead of ≈ 50 ms** (the full `smoke:native`: several minutes instead of ≈ 11 s). Results are still correct.
- `set_view` returned a wrong, half-way camera pose (the animation never advances) and `screenshot` hung until its timeout.

Done now: `set_view` and `screenshot` fail fast with "The Plasticity window is covered or minimized…"; `native_status` reports `windowVisible`; `smoke:native` skips the camera / screenshot section in that state and **always undoes its changes**, even when a check throws (an aborted run had left 24 bodies behind — cleaned up).

**Fix (Designer approved, 2026-10-04) — keep-alive switches in the launcher.** The startup hook of `native_launch` now also appends `disable-features=CalculateNativeWinOcclusion` (merged into whatever `disable-features` holds, including later appends by the app), `disable-backgrounding-occluded-windows`, `disable-renderer-backgrounding` and `disable-background-timer-throttling`, and protects them from `removeSwitch`.

Verified after a cold start, with the Plasticity window fully covered by another maximised window on the same monitor (checked at OS level: not minimized, covering window above it in z-order):
- child processes carry the switches; `document.hidden` is false, 61 animation frames per second;
- mutating tools take 64–81 ms (was ≈ 2 s); the full `smoke:native` takes **13 s (was 303 s)** and runs all seven views and the screenshot;
- a screenshot of the covered window shows the real viewport content.

Limits: a **minimized** window still does not draw (camera and screenshot keep failing fast with the "covered or minimized" message); the switches only apply to an instance started through `native_launch`. A covered Plasticity now keeps rendering, so it uses some GPU while hidden.

**Not verified:** `twist` / `scale` on curved paths; guides on Sheet lofts; lofts of profiles in non-parallel planes beyond the 90° arc; a minimized window after the switches (expected: still refused).

Block 6 and the keep-alive switches are committed and merged into `main` (fast-forward) and pushed. The MCP client must be restarted to see the new tools.

## Native block 7 — arcs, ellipse, join, regions — ✅ Done (2026-10-04, ~3 h)

Work is on branch `native-block-7`. Designer asked for `join_curves` to be included.

New tools: `create_arc` (three points), `create_arc_center` (centre, start, signed angle, normal), `create_ellipse`, `join_curves`, `list_regions` — 47 tools total. `extrude_profile`, `revolve_profile`, `sweep_profile` and `loft_profiles` accept `regionIds` as an alternative to curve ids (exactly one of the two).

Verified live on 26.1.3 (Untitled), `smoke:native` extended and passing (126 checks, 17 s):
- Arcs: +90°, −90°, 270°, about the X axis, three-point arc through its middle point; collinear points and an off-plane start refused. Ellipse with the major axis along X and along Y.
- Regions: a slot drawn as two lines and two arcs is one region (4 edges, exact boundary length); extruding it gives a 6-face Solid. Rectangle + nested circle give a ring (`holes: 1`) and a disc; the ring extrudes to a plate with a hole (7 faces), ring + disc to a full plate, a region revolves and lofts; stale region ids refused.
- Join: four slot curves → one closed curve that extrudes by its own id; line + arc → one path that a circle sweeps along; non-touching curves refused with a hint.
- Built stdio server exercised end to end (bracket with two holes from one region, joined sweep path) incl. validation errors.

Findings:
- Arcs: `KnifeCenterPointArcFactory` + `CenterPointArcCommand` (`isKnife = false`, `center`, `orientation`, `p2` = start, `p3` = end, `lastSense = true`) draws counter-clockwise about the orientation normal; a clockwise arc is the same call with the normal flipped. The three-point arc is reduced to this in Node (circumcentre + normal).
- Ellipse: `KnifeEllipseFactory` + `EllipseCommand` (`center`, `orientation`, `point1` = end of the major axis, `point2` = end of the minor axis). A "minor" radius larger than the "major" one is accepted.
- Join: `JoinCurvesFactory` + `JoinCurvesCommand` (`curves`). **The joined curve keeps the id of the first curve** (it comes back in `changed`); the others are removed. Curves that do not touch give "Operation has no effect".
- Regions: each `SketchIsland` item is backed by a `RegionBody` model whose faces match the Region views by `entityId`. From the face: plane normal, boundary edges and their exact lengths, inner loops (holes). **No area is available**; bounds still come from the display mesh (≈ 0.01–0.03 mm off on curved boundaries).
- Region ids look like `426r36946` (island version prefix) and change whenever curves in that plane change — including a join.
- Several region ids in one call are extruded as one profile (ring + disc → a full plate).

**Not verified:** arcs and ellipses in tilted (non-axis) planes; `sweep_profile` with `regionIds` on curved paths; `loft_profiles` with `regionIds` plus guides; joining curves that meet at a T or form several chains.

Block 7 is committed, merged into `main` (fast-forward) and pushed. The MCP client must be restarted to see the new tools.

## Native block 8 — copy, mirror, arrays — ✅ Done (2026-10-04, ~3 h)

Work is on branch `native-block-8`. Designer asked for both arrays to be included.

New tools: `copy_bodies`, `mirror_bodies`, `array_rectangular`, `array_radial` — 51 tools total.

Verified live on 26.1.3 (Untitled), `smoke:native` extended and passing (141 checks, 20 s):
- Copy: a Solid and a curve together with a shift (one undo step), copy in place, the copy keeps the shape.
- Mirror: reflected copies of a Solid and a curve; a **true reflection** (checked on an L-shaped body through the position of its top face); mirror without the original; Undo / Redo across it.
- Arrays: row of three, 3 × 2 grid, array of one and parallel directions refused; radial array of six over 360° and of three over 90°.
- Built stdio server exercised end to end incl. validation errors.

Findings:
- Copy of Solids / Sheets goes through instances: `CreateInstanceFactory` (`items`) → optional `MoveItemAndEmptyFactory` (`empties`, `move`) → `RealizeInstanceFactory` (`empties`). Curves: `CurveDuplicateFactory` (`curves`), then `MoveItemAndEmptyFactory` (`items`). All inside one carrier command → one undo step. Copies are named `<name>.001`.
- `MirrorFactory` + `MirrorCommand`: `shells`, `curves`, `origin`, `normal`. **`shouldCut` is true by default** (the body is cut at the mirror plane — symmetry modelling), so a plain mirror sets `shouldCut = false`, `shouldUnion = false`. **`move` is an offset distance, not a "move instead of copy" flag** (setting it to `true` shifted the copy by 1 m), so the factory always produces copies.
- Arrays: `RectangularArrayFactory` (`items`, `dir1`, `dir2`, `mode = 'spacing'`, `num1`, `num2`, `distance1`, `distance2`) and `RadialArrayFactory` (`items`, `center`, `dir1`, `dir2` = axis, `mode = 'total'`, `num1 = 1`, `num2`, `angle`). Counts include the original. Radial over 360° spaces items 360 / count apart; over a smaller angle the last item sits at the end of the angle. Curves can be arrayed too.

### Incident: removing geometry behind Plasticity's history freezes the editor

First attempt at "mirror without the original" removed the originals with `editor.geo.removeItem(view)` inside the mirror command. The command and its Undo worked, but **Redo threw** ("object … missing from stable model") and left the editor broken: `editor.undoBusy` stayed `true`, and after clearing it `editor.exec` still silently ran nothing. Only restarting Plasticity fixed it (Designer restarted it; the document was an empty Untitled).

Consequences in the code:
- `mirror_bodies` with `keepOriginal: false` now mirrors and then deletes the originals with the native `DeleteCommand` — **two undo steps**, Undo / Redo verified. Rule: never change geometry outside a native factory or command.
- Every command wrapper now checks that its body actually ran; a silent no-op is reported as "Plasticity did not run the command: its editor is stuck. Restart Plasticity through native_launch." (verified on the stuck instance).

**Not verified:** copies, mirrors and arrays of Sheets; mirror across a tilted plane; arrays with tilted directions; radial arrays with negative angles; very large arrays.

Block 8 is committed, merged into `main` (fast-forward) and pushed. The MCP client must be restarted to see the new tools.

## Native block 9 — more export formats — ✅ Done (2026-10-04, ~3.5 h)

Work is on branch `native-block-9`. Designer asked for `export_drawing` to be included.

New tools: `export_mesh` (STL / OBJ / 3MF by extension), `export_parasolid` (`.x_t` / `.x_b`), `export_drawing` (SVG) — 54 tools total. New module `drawing.ts` builds the SVG.

**IGES and SAT are not available:** `ExportCadFactory` refuses `.igs` / `.iges` (empty error) and fails on `.sat` / `.sab` (`PK_ERROR_wrong_entity`) on this installation, although `ExportIgesCommand` / `ExportSatCommand` exist in the code. No tools were added for them.

Verified live on 26.1.3 (Untitled), `smoke:native` extended and passing (156 checks, 19 s):
- STL of a box: 12 triangles, exact binary size, coordinates in millimetres; a finer tolerance gives more triangles on a sphere; OBJ with 8 vertices in millimetres; 3MF archive; a curve, an existing file and an unknown extension are refused.
- Parasolid `.x_t` and `.x_b` with the Parasolid preamble.
- Drawing of the L-shaped body: front 40 × 25, top 40 × 20, right 20 × 25 mm; hidden lines can be left out; a curve is refused.
- Built stdio server exercised end to end incl. validation errors. The SVG was also rendered (headless Edge) and inspected visually: correct orientation of all views, arcs and ellipses drawn as curves, hidden edges dashed.

Findings:
- Mesh exporters `STLExportFactory` / `OBJExportFactory` / `ThreeMfExportFactory` share one interface (`shells`, `filePath`, `unit`, `upAxis`, `curveChordTolerance`, `surfacePlaneTolerance`, `curveChordAngleDegrees`, `surfacePlaneAngleDegrees`). **Their default unit is metres** — the tool sets `unit = 'millimeter'`. Plasticity keeps a minimum mesh density of its own: a 15 mm sphere never drops below ≈ 5600 triangles.
- `ExportCadFactory` picks the format from the file extension (STEP, `.x_t`, `.x_b`). The binary Parasolid file starts with the same text preamble as the text one.
- Drawing: the native `ExportHiddenLineFactory.commit()` needs the export dialog (throws without it), so only its `generator.generate(camera, resolution, bodyIds, factory, transforms)` is used, with our own `OrthographicCamera` per view (the viewport is untouched). **One factory per view** — reusing a factory gave wrong outlines for every view after the first.
- The generator returns three encodings (pixels, y down): `3006` polyline (`count` points), `3005` ellipse (cx, cy, rx, ry, rotation), `3004` elliptical arc (cx, cy, rx, ry, rotation, start, end, sweep flag, large-arc flag — the last two exactly as in an SVG `A` command). Categories containing "Hidden" are hidden lines.

**Not verified:** mesh and Parasolid export of Sheets; drawings of free-form (spline) edges beyond a loft seen in isometric; very large drawings (limit: 2 million coordinates per view); how other CAD systems and slicers read the files (only the file structure was checked).

Block 9 is committed, merged into `main` (fast-forward) and pushed. The MCP client must be restarted to see the new tools.

### IGES — closed: not available in this edition (2026-10-04)

Designer confirmed that the installed Plasticity has an **Indie** licence, which does not support IGES — only the Studio edition does. The Save dialog of the UI offers exactly: OBJ, STL, PNG, STEP, Parasolid (`.x_b`, `.x_t`), 3MF, SVG. So the tools cover every exchange format this edition has; no IGES or SAT tool will be added.

For the record, the programmatic attempts (export through `ExportCadFactory` and through `ExportIgesCommand` / `ExportSatCommand` with the file dialog bypassed, import of a sample `.igs` through `ExchangeImportFactory`) all failed with kernel attribute errors (`PK_ATTRIB_create_empty` → `PK_ERROR_wrong_entity`, `PK_ATTRIB_ask_doubles` → `PK_ERROR_not_an_entity`, or an empty error with condition `:'(`) — that is what the edition limit looks like from the inside. The sample `cilinder.igs` did not come from this installation's export.

Two things learned on the way:
- `ExportStepCommand` run with its `getPath` replaced did not return within 60 s (it waits for a dialog). Do not drive the UI's export commands; `export_step` uses the factory directly and works.
- `editor.importer` (`import`, `importNative`, `importSVG`, `import3mf`) is the UI's import entry point — relevant for block 10.

## Native block 10 — more import formats — ✅ Done (2026-10-04, ~2.5 h)

Work is on branch `native-block-10`. Designer chose the variant with meshes.

New tools: `import_parasolid`, `import_svg`, `import_mesh`, `list_reference_meshes`, `delete_reference_meshes` — 59 tools total. `importStep` and the new importers share one helper that runs an import factory inside `ImportCommand`.

Verified live on 26.1.3 (Untitled), `smoke:native` extended and passing (171 checks, 21 s):
- Parasolid: export → import brings the plate back with the same faces and exact bounds.
- SVG: a hand-written file (rect + circle) becomes two curves with the right sizes; a curve from it extrudes into a Solid; `unit: centimeter` scales by 10.
- Meshes: STL / OBJ / 3MF import as reference meshes with the right bounds and triangle count; a reference mesh is not a body; delete, Undo of the delete, Undo of the import; `unit: meter` scales by 1000; unknown reference id, missing file and wrong extension refused.
- Built stdio server exercised end to end (SVG logo → regions → plate with a hole) incl. validation errors.

Findings:
- `ParasolidImportFactory`, `VectorImportFactory` (`unit`, default centimetre) and `MeshImportFactory` (`unit`, default metre) all take `filePath` and run inside `ImportCommand`. 3MF goes through `editor.importer.import3mf(path)`.
- **SVG import:** shapes land in the XY plane at the SVG origin, **y flipped** (SVG y grows downward: a rect at y 10…40 arrives at y −40…−10). `rect`, `circle`, `path` and `polyline` are understood; group transforms are applied. Closed shapes immediately form regions.
- **Meshes are not bodies.** They become `Empties_ObjectEmpty` objects in `editor.db.empties` (tag `Object`), found with `db.lookupEmptyById(id)` (throws "Empty not found" for an unknown id). Ids start at 0 and live in a number space of their own. Selection uses `selected.addEmpty`, deletion the native `DeleteCommand`.
- **Bug found and fixed in `export_mesh` (shipped in block 9):** Plasticity's 3MF exporter always writes `unit="meter"`, whatever unit the coordinates are in. The tool had set millimetres for all three formats, so a 40 mm part was exported to 3MF as 40 m. 3MF is now written in metres (unit declared, correct size everywhere); STL and OBJ stay in millimetres. The 3MF round trip is in the smoke test.

**Not verified:** SVG features beyond the four basic elements (curved paths, text, nested transforms, units in `width`/`height`); meshes with several objects in one file; moving or hiding reference meshes (no tools for that); STEP / Parasolid / mesh files written by other programs.

Block 10 is committed, merged into `main` (fast-forward) and pushed. The MCP client must be restarted to see the new tools.

## Full command coverage — plan agreed 2026-10-04

Designer wants **the whole command set of Plasticity** available through the server, using the manual (https://doc.plasticity.xyz/) as the reference for what each command does. About 100 meaningful commands are still missing; estimate 38–42 h in total.

Decisions (Designer):
1. **Tool surface grouped the way Plasticity groups its commands.** The manual's "unified commands" (Fillet, Offset, Project, Join, Unjoin, Extend, Rebuild, …) become one tool each, which picks the variant from what it is given. Expected total: 110–120 tools.
2. `native.ts` is split into modules per family (block 0).
3. Order of blocks as proposed, by value for modelling.

Excluded: Studio-only commands (Align, PolySplines, xNURBS, Square, Rebuild Face with explicit control; IGES / SAT), **Publish to Plasticity Share** (uploads the document to the web), display-only toggles (curvature, points), and the interactive "freestyle" variants of move / rotate / scale.

| # | Block | Commands | Est. h | Status |
|---|-------|----------|--------|--------|
| 0 | Split `native.ts` into modules; curve topology (segments, vertices, control points) | — | 3.5 | ✅ done |
| 0b | Split `index.ts` into `src/tools/` per family | — | 1 | ✅ done |
| 11 | Solids: Cut, Hollow, Thicken, Thicken Face, Offset Face, Draft Face, Delete Face, Patch, Pipe, Join / Unjoin, Remove Fillets | 13 | 5 | ✅ done |
| 12 | Faces and edges: Move / Rotate / Scale Face, Offset Edge, Offset Face Loop, Match Face, Extend Sheet, Untrim, Reverse, Unwrap, Isoparam, Complete Edge, Imprint; added on the Designer's word: Dissolve edges / Delete Redundant Topology, Join Faces, Move Edge, Refillet, Duplicate Faces | 19 | 7 | ✅ done |
| 13 | Curves: Offset, Fillet Curve / Vertex, Trim, Cut, Split, Extend, Bridge, Rebuild, Raise Degree, Slot, Text, Spiral, Polygon, rectangles, tangent arcs and circles, control points | ~30 | 10 | ✅ done (Split Segment and Insert Knot deferred) |
| 14 | Projection: Project (three kinds), Project Outline, Create Outline, Duplicate and Project | 7 | 3 | ✅ done |
| 15 | Surfaces: Bridge Surface, Constrained Surface, Raise Surface Degree, Slide CV, Deform, Rebuild Face, Remove Nominal Surface (Loft Guide is part of Loft) | 7 | 3 | ✅ done |
| 16 | Copies and placement: Curve Array, Place, Copy / Paste with Placement, instances | 6 | 2.5 | ✅ done (Place and Copy / Paste with Placement deferred) |
| 17 | Scene: groups, hide / show / isolate, lock, materials, extended selection | 15 | 4.5 | ✅ done |
| 18 | Measuring: distance, radius, continuity, Dimension, Section Analysis, Check | 7 | 3 | ✅ done (Dimension deferred) |
| 19 | Environment: construction planes, new / open / save document, units and grid | 5 | 2.5 | ✅ done (setting units and grid, and saving under the document's own name, are not possible) |

Each block: its own proposal, live verification, `smoke:native` checks, commit on Designer's word. Work is on branch `native-full-spectrum`.

### Block 0 — ✅ Done (2026-10-04, ~1.5 h)

- `mcp-server/src/native.ts` (2231 lines) is now a thin facade; the code lives in `mcp-server/src/native/`: `types.ts`, `math.ts`, `snippets.ts`, `core.ts` (connection, command execution, history) and one class per family — `scene.ts`, `primitives.ts`, `curves.ts`, `profiles.ts`, `solids.ts`, `transforms.ts`, `exchange.ts`, `view.ts` — chained by inheritance so `NativeSession` still has every method. The split was done by script as a pure move (checked line by line: nothing lost or added except class wrappers); core members went from `private` to `protected`. `index.ts` and the smoke test are untouched by the split.
- `get_body_topology` now also describes **curves**: `closed`, segments (id, kind, length, start / mid / end), vertices (id, position) and control points (id, position). Earlier it refused curves. Segment ids look like `1278s106702`, vertex ids like `106699`, control point ids like `1`.
- Finding: a Wire view has `segments`, `vertices`, `cvs` collections (`versionIds` on segments, `ids` on the other two); vertex and control point positions come from the view in single precision, so they are rounded to a micron. Selection has matching `addSegment`, `addVertex`, `addCurveCV`, and `addShellCV` for surface control points (`view.high.cvs`, left for block 15).

Verified: `smoke:native` passes before and after (173 checks, 20 s), build and protocol tests pass, and the block 7 end-to-end script over stdio passes against the rebuilt server (document restored to empty).

Committed, merged into `main` and published (`27c85b5`).

### Block 0b — split of `index.ts` — ✅ Done (2026-10-04, ~1 h)

Approved by the Designer on 2026-10-04. `mcp-server/src/index.ts` (1924 lines) now only wires the server (66 lines); each tool family lives in `mcp-server/src/tools/<family>.ts` with its argument schemas, tool definitions and handlers: `bridge`, `session`, `primitives`, `scene`, `transforms`, `solids`, `curves`, `profiles`, `exchange`, `view`; `shared.ts` holds the native session, the result helpers and the schema pieces used by more than one family. A family exports `{ tools, handlers }`; `index.ts` concatenates them and dispatches by name.

Done by script as a pure move. Verified: the 59 tool definitions are byte-identical before and after (compared through `tools/list` of the built server), the reply to an unknown tool is identical, the scenario of block 7 gives the same output, and the end-to-end scripts of blocks 3, 7, 8, 10 and the scene script pass. The only visible difference is the **order** of tools in the list: `undo` / `redo` now follow the session tools and the copy tools follow the transforms.

### Block 11 — solids — ✅ Done (2026-10-04, ~3.5 h)

Eleven tools, 69 in total (`join_curves` is replaced by `join`):

| Tool | Native factory | Notes |
|------|----------------|-------|
| `cut` | `MultiCutFactory` | Cutters: curves (`curveIds`, with `extend` and sweep `direction`) or faces of another body (`cutterId` + `faceIds`). One piece keeps the target id. |
| `hollow` | `HollowFacesFactory` / `HollowSolidsFactory` | With `faceIds` an open shell, without them a closed cavity. Inward by default (native thickness is negative inward), `outward` optional. |
| `thicken` | `ThickenSheetFactory` / `ThickenFaceFactory` | A Sheet becomes a Solid and keeps its id; faces become a new Solid and the body stays. `front` is along the normal. |
| `offset_faces` | `OffsetFaceFactory` | |
| `draft_faces` | `DraftFaceFactory` | Reference is a planar face of the same body. |
| `delete_faces` | `DissolveFaceFactory` / `DeleteFaceFactory` | `heal: true` (default) is Plasticity's Dissolve: neighbours close the gap. `heal: false` is Delete Face: a Solid becomes an open Sheet. |
| `remove_fillets` | `RemoveFilletsFromShellFactory` | `maxRadius` (native 0 = no limit), `convexity` any / convex / concave (8600 / 8602 / 8603). |
| `patch` | `PatchHoleInWireFactory`, `PatchRegionFactory`, `CapHolesInSheetFactory`, `PatchHoleInSheetFactory`, `PatchHoleInSolidFactory` | Chosen by what is passed: closed curves, regions, a Sheet (all holes), or a body with the edges of one opening. |
| `pipe` | `PipeFactory` | With `wallThickness` the bore keeps `diameter` and the wall is added outside. |
| `join` | `JoinCurvesFactory` / `JoinSheetsFactory` | Curves or Sheets, not a mix. |
| `unjoin` | `UnjoinCurvesFactory` / `UnjoinShellsFactory` / `UnjoinFacesFactory` | |

Differences from the proposal, found while probing:
- **Cut has no plane cutter.** Plasticity's Cut takes curves and faces only (the manual says the same). A plane cut is a straight line plus `direction`, with `extend: true`; that is what the tool exposes instead of "plane (point + normal)".
- **Delete Face does not heal** in Plasticity — neither `DeleteFaceCommand` nor plain Delete with a face selected. Healing is a separate command, Dissolve. Both are in `delete_faces`, switched by `heal`.
- **Patch of a region fills every loop separately**: a plate region with a hole gives a full plate Sheet and a disc Sheet, not a plate with a hole. This is native behaviour; the tool description says so.
- A face used as a cutter cuts with its whole surface, however small the face is (no `extend` needed).

Code: the native methods are in `src/native/solids.ts`, the tools in `src/tools/solids.ts`. A new snippet `typed(id, ...types)` gives one error wording for a body of the wrong kind. Command classes that are not in `editor.commands` (`DissolveFaceCommand`, `DeleteFaceCommand`, `PatchRegionCommand`, `PatchHoleInCurveCommand`, `PatchHoleInSheetCommand`, `PatchHoleInSolidCommand`, `PatchHolesInSheetCommand`) are taken from the module closure.

Verified live in Untitled: `smoke:native` passes with **206 checks** (33 new: every tool, both variants where there are two, and the refusals); the end-to-end script over stdio passes (69 tools, argument validation, stale ids, document restored); build and protocol tests pass.

**Not verified / not exposed:** the options of Patch (continuity G0–G2, fill preference single / minimal / quality, guide curves, tolerance) — defaults are used; Thicken's method (Offset / Punch) and "lock distances"; Hollow of several Solids in one call; Pipe options other than diameter and wall (twist, vertex count for a polygonal section, extension shape); `draft_faces` with a reference on another body or a free direction; Cut with several cutters of different kinds at once; behaviour on imported geometry with tolerant edges. Left out of block 11 on purpose: Join Faces / Join Vertices (`JoinFacesFactory`, `JoinVerticesCommand` exist; the manual's Join lists curves and Sheets only).

Blocks 0b and 11 are committed (two commits: `14579b6`, `2851ffb`), merged into `main` and published.

### Block 12 — faces and edges — ✅ Done (2026-10-04, ~4 h)

Designer's decisions on the proposal (2026-10-04): **one unified `offset`**, as in Plasticity (so `offset_faces` from block 11 is renamed), and the five commands found while probing **go into this block**.

Sixteen new tools, **84 in total**:

| Tool | Native factory / command | Notes |
|------|--------------------------|-------|
| `move_faces` | `MultiMoveFaceFactory` | A flat face moved within its own plane changes nothing. |
| `rotate_faces` | `MultiRotateFaceFactory` | Rotation is set as a quaternion, like `rotate_bodies`. |
| `scale_faces` | `MultiPlanarizingBasicScaleFaceFactory` | Meaningful on round faces (radius); a flat face scaled in its plane is unchanged. |
| `move_edges` | `MoveEdgeFactory` | |
| `offset` | `OffsetFaceFactory`, `OffsetFaceLoopFactory`, `OffsetEdgeFactory` | `faceIds` (move), `faceIds` + `loops` (outline on the surface; positive inward), `edgeIds` (the sign picks which adjacent face gets the new edge). `bothSides` = native `lockDistances`; `gapFill` round / linear / natural (21220–21222). |
| `match_faces` | `MatchFaceFactory` | `replacement` is the target face. |
| `refillet` | `RefilletFaceFactory` | Native `mode` is `delta` by default; any other value makes `distance` the radius — `radius` uses that. |
| `duplicate_faces` | `CreateSheetFromFacesFactory` / `CreateSolidFromFacesFactory` | |
| `imprint` | `ImprintCurveBodyFactory` / `ImprintBodyBodyFactory` | Curves: without `direction` the Normal projection (26520), with it Vector (26521). `complete`: none / edge / boundary (curves 25340 / 25341 / 25343, bodies 22780 / 22781). |
| `complete_edges` | native `CompleteEdgeCommand` | No reachable factory: the edges are selected and the command runs as in the UI. |
| `dissolve_edges` | `DeleteEdgeFactory`; native `DeleteRedundantTopologyCommand` | With `edgeIds` those edges; without, the whole body, through the selection like above. |
| `isoparam` | `IsoparamFactory` | `u` ↔ native `uOrV = true`. |
| `untrim` | `UntrimFactory` | The face is detached: it keeps the body's id as a Sheet, the rest of the body becomes separate Sheets. |
| `unwrap_faces` | `UnwrapFactory` | Result at the world origin. |
| `extend_sheet` | `ExtendSheetFactory` | `shape`: linear / soft / reflective / natural (22750–22753). |
| `reverse` | `ReverseCurveFactory` / `ReverseSheetFactory` | |

`join` gained a variant for faces of one body (`id` + `faceIds`, `JoinFacesFactory`).

Also changed, because these tools needed it:
- **`changed` is now reported by geometry version**, not only by bounds and counts. Until now a body whose bounds, face and edge counts stayed the same was not reported at all — a reversed Sheet, a moved edge, a changed fillet radius. `READ_STATE` returns the internal version of every body (`NativeState.versions`) and `mutate` compares it too. The existing checks pass unchanged.
- Default pivot for `rotate_faces` / `scale_faces`: the centre of the box around the faces' edges — the middle of a flat face, a point on the axis for a cylindrical one (a model face has no bounding box of its own).
- The two commands run through the selection have a guard: if the command waits for more input for 20 s it is cancelled (`executor.cancelActiveCommand`), so the editor is not left busy. Not triggered in any test.
- `cut`: a cutter that does not divide the body fails with one of two kernel messages (`Failed to cut body into sections`, or — seen once in the smoke test — `PK_ATTRIB_create_empty … wrong_entity`); the hint is now attached to both.

Code: `src/native/faces.ts` (class `FaceTools`, between `SolidTools` and `TransformTools`), `src/tools/faces.ts`.

Verified live in Untitled: `smoke:native` passes with **239 checks** (33 new); the end-to-end script over stdio passes (84 tools, argument validation, stale ids, document restored); build and protocol tests pass.

**Not verified / not exposed:** Match Face options (Grow, Side); Extend Sheet towards a target body (`type` Target / Bbox, `limit`), `modify`; Isoparam `subdivide`; Offset Face Loop `isIndividual`; the Grow mode of the face factories (Moving / Fixed / None) — native default is used; `imprint` options `bidirectional` and `occlude` (native defaults: both on); face tools on several bodies in one call (one body per call); behaviour on spline surfaces and imported geometry. Freestyle variants of the face transforms are excluded by the plan.

Committed (`e876d6c`), merged into `main` and published.

### Block 13 — curves — ✅ Done (2026-10-04, ~6 h)

Approved by the Designer as proposed, including three renames to match Plasticity's unified commands. **105 tools in total** (21 new).

**13a — creation** (`src/native/curves.ts`, `src/tools/curves.ts`):

| Tool | Native factory | Notes |
|------|----------------|-------|
| `create_rectangle` | `ThreePointRectangleFactory` | Corner or centre with sizes in a plane, or three points; every variant is reduced to three points. |
| `create_polygon` | `KnifePolygonFactory` | `radiusTo` vertex ↔ native `inscribed`, side ↔ `circumscribed`. One vertex lies along `xDirection` in both modes. |
| `create_spiral` | `SpiralFactory` | `p1` / `p2` axis ends, `p3` the radius point, `handedness` true = right. |
| `create_text` | `TextFactory` + rotate + move | Text is written at the origin of XY and then turned and moved in the same command: one undo step. Font is the built-in `inter`. |
| `create_slot` | `SlotFactory` | **Not for a single straight line**: the factory takes the plane from the curve (`No basis found`), and a line has none. |
| `create_tangent_arc` | `TangentArcFactory` | From an end of a segment (ids from `get_body_topology`). |
| `create_tangent_circle` | `TangentCircleFactory` | `point` picks one of the several solutions. |
| `create_circle` (extended) | `KnifeThreePointCircleFactory`, `KnifeTwoPointCircleFactory` | `points`: three on the circle, or two on a diameter. |
| `create_spline` (extended) | `CurveFactory.splineThrough = false` | `controlPoints: true`. |

**13b — editing** (`src/native/curve-edit.ts`, `src/tools/curve-edit.ts`):

| Tool | Native factory | Notes |
|------|----------------|-------|
| `trim_curves` | `TrimFactory` | Takes fragments from `editor.fragments.read.modelId2info` (pieces between corners and crossings) and removes the one nearest to `near`. |
| `bridge` | `BridgeVertexFactory` / `BridgeEdgeFactory` | Curve vertices, or body edges (nearest ends, `pickClosestVertices`). Continuity `ContinuityType` G0–G3. |
| `rebuild` | `RebuildCurveFactory` | `method` 0 tolerance, 1 point count, 2 degree + spans. |
| `raise_degree`, `subdivide_curves` | `RaiseDegreeCurveFactory`, `SubdivideCurveFactory` | |
| `convert_vertices` | `ConvertVertexFactory` | |
| `align_vertices` | `AlignVertexFactory` | `moving`, `target`, `continuity`. |
| `move_control_points`, `rotate_control_points`, `scale_control_points` | `MultiMove` / `MultiRotate` / `MultiScaleControlPointFactory` | Take vertices and control points; default pivot is the centre of the points. |
| `slide` | `MultiSlideControlPointFactory` | forward / backward / normal ↔ `posU` / `negU` / `normal`. |
| `delete_control_points` | `DeleteControlPointFactory` | |
| `curves_from_edges` | `CreateCurveFromEdgesFactory` | |
| `deform` | `DeformCurveFactory` | Curves from a source face onto a target face. The Solid / Sheet variant belongs to block 15. |

Extended: `offset` (`curveIds` → `OffsetPlanarCurvesFactory`, `regionIds` → `OffsetRegionFactory`, `vertexIds` → `OffsetVertexFactory`), `cut` (curves as targets → `MultiCurveCutFactory`), `dissolve_edges` (a curve id → redundant vertices).

Renamed, as in Plasticity: `fillet_edges` → **`fillet`** and `chamfer_edges` → **`chamfer`** (edges of a body, or corner vertices of a curve — `FilletVertexFactory`; without ids every corner of a curve — `FilletCurveFactory`; on a curve a chamfer is the native fillet with a negative radius), `extend_sheet` → **`extend`** (Sheet edges, or the end vertices of a curve — `MultiExtendVertexFactory`).

**Deferred, on purpose (Designer agreed on 2026-10-04 to leave them out):** Split Segment and Insert Knot. Their factories take the position only from the mouse inside the UI command; the only way in is to swap a private field of the factory for a proxy. I promised not to work around such cases without asking. A curve is split at a point with `cut` (curves as targets), and control points are added with `subdivide_curves` / `raise_degree`. `split_curves` from the proposal became `subdivide_curves`.

Also changed: `pick` resolves segment, vertex and control point ids of a curve (collections that keep `ids` instead of `versionIds`); `withHint` accepts a pattern; the hint of `cut` is attached to every `PK_ATTRIB_…` kernel error — the failing cut gave three different ones over the runs of this session.

Verified live in Untitled: `smoke:native` passes with **285 checks** (46 new); the end-to-end script over stdio passes (105 tools, argument validation, stale ids, old names gone, document restored); build and protocol tests pass.

**Not verified / not exposed:** fonts other than the built-in one and text options (spacing, alignment); spiral taper (`angle`) and pitch; bridge tension, `trim` of the bridged curves and bridging at a point inside a curve (`BridgeCurveFactory` with a parameter); the Scale / Offset / Flip options of Deform; Rebuild `preserveParameterization`, `fairnessWeight`; proportional editing and mirror mode of the control point transforms; Offset Region with two distances and `isIndividual`; curves that are not planar for `offset` and `create_slot`; a vertex that is not an end is accepted by `extend` and left unchanged.

**Incident during the final check (2026-10-04, ~22:00):** on the last control run of the smoke test the renderer process of Plasticity disappeared (the CDP call timed out, no `--type=renderer` process left, no new crash dump). It happened after the last check had passed, on the undo that follows it. That Plasticity session had been running since 19:46 with some 25 smoke runs, the probes and the end-to-end scripts in it. Not reproduced: after the Designer closed the window and Plasticity was started again, the full smoke test passed twice in a row (285 checks, 40 s). Renderer memory grows by about 50 MB per smoke run (356 → 409 MB) and is not given back, so memory exhaustion of a long session is the likely cause — not proven. On restart Plasticity restored its crash backup into Untitled: 75 bodies of test debris (ids 2631–2801), which were deleted with `delete_bodies` (undoable) before the test would run. The Designer's document had been empty; nothing of theirs was in it.

What follows from it: restart Plasticity after a long automated session (a dozen smoke runs); after a renderer loss expect test debris in the restored Untitled document.

Committed (`6de07e2`), merged into `main` and published.

### Block 14 — projection — ✅ Done (2026-10-04, ~1.5 h)

Three tools for seven commands, **108 in total** (`src/native/projection.ts`, `src/tools/projection.ts`):

| Tool | Native factory | Notes |
|------|----------------|-------|
| `project` | `ProjectCurveBodyFactory`, `ProjectBodyBodyFactory`, `ProjectCurveCurveFactory` | Curves onto a body (Normal method 26520 without `direction`, Vector 26521 with it), crossing lines of bodies (first is the target, the rest are tools), or two planar curves into one curve in space. New curves; nothing else changes. |
| `create_outline` | `CreateOutlineFromShellsFactory` / `ProjectOutlineFromShellsFactory` | Outline in space on the bodies, or with `flat` projected onto the plane. |
| `duplicate_and_project` | `CurveDuplicateFactory` or `CreateCurveFromEdgesFactory`, then `PlanarizeCurveFactory` | Copy and flatten inside one command — one undo step. The plane is given explicitly (`planeOrigin`, `planeNormal`). |

*(Corrected in block 19: the factories do not read the plane themselves, the native command passes it — see there.)* **The risk named in the proposal is real:** the two outline factories have no direction or plane of their own; they read the **active construction plane of the viewport** (`editor.activeViewport.constructionPlane`, a `ConstructionPlaneSnap` with normal `n` and point `p`). I did not switch that plane behind the Designer's back: `create_outline` works along whatever plane is active in the window — the world XY plane by default, i.e. a top view — and has no direction parameter. Choosing another direction needs the construction plane to be set, which is block 19 (construction planes); once that tool exists the direction of `create_outline` follows it, the same way as in Plasticity.

Verified live in Untitled: `smoke:native` passes with **295 checks** (10 new); the end-to-end script over stdio passes (108 tools, argument validation, document restored); build and protocol tests pass.

**Not verified / not exposed:** `create_outline` with a construction plane other than world XY; the `complete`, `bidirectional` and `occlude` options of curve projection (native defaults: no completion, both directions, hidden surfaces skipped); projection onto several bodies at once; curve-curve projection of curves that are not planar (refused with a hint).

Designer's decision (2026-10-04): leave `create_outline` following the active construction plane; its direction will be controlled by the construction plane tool of block 19.

Committed (`ffaab89`), merged into `main` and published.

### Block 15 — surfaces — ✅ Done (2026-10-04, ~2 h)

Three new tools and five extended ones, **111 in total** (`src/native/surfaces.ts`, `src/tools/surfaces.ts`):

| Tool | Native factory | Notes |
|------|----------------|-------|
| `bridge_surface` | `BridgeSurfaceFactory` | `push(face, false, point)` once per Sheet. The two Sheets become one (three faces for a floor and a wall); the first keeps its id. **Works only when the surfaces meet at an angle when extended** — parallel and coplanar Sheets fail in the kernel (`PK_FACE_make_blend` 17453), refused with a hint. `shape` g2 22202 / chamfer 22203. |
| `constrained_surface` | `ConstrainedSurfaceFactory` | `points`, optional `normals` — works without them. The Sheet is an untrimmed patch that reaches beyond the points. `optimize` 24870 / 24871. |
| `remove_nominal_surface` | `RemoveNominalSurfaceFactory` | |
| `raise_degree` (extended) | `RaiseDegreeFaceFactory` | `id` + `faceIds`, `deltaUDegree` / `deltaVDegree`. |
| `rebuild` (extended) | `RebuildFaceFactory` | One face, method Refit (0) by tolerance. Explicit Control (1) is Studio-only. |
| `deform` (extended) | `DeformFaceFactory` | `ids`: all faces of the bodies are passed, with the source and the target face. |
| `slide`, `move_` / `rotate_` / `scale_control_points` (extended) | the control point factories of block 13 | Take the control points of a body's surfaces (`view.high.cvs`); `slide` gained `forward_v` / `backward_v` (`posV` / `negV`). |

`get_body_topology` lists `controlPoints` for a Solid / Sheet that has spline faces. Their ids are plain indices within the body (`"0"`, `"1"`, …), not tied to a face: the positions tell which face they belong to. A body of planes and cylinders has none; `raise_degree` on a face creates them (a flat rectangular face gets four, at its corners).

From the plan, **Loft Guide** needs nothing: it is not a command of its own — guides are part of Loft, and `loft_profiles` already takes `guideIds`.

Verified live in Untitled: `smoke:native` passes with **309 checks** (14 new); the end-to-end script over stdio passes (111 tools, argument validation, document restored); build and protocol tests pass.

**Not verified / not exposed:** the Bridge Surface options `trimWalls`, `trimBlend`, `propagate` and the senses (native defaults; the senses made no difference in the test); constrained surface `angularTolerance`; Deform options Scale / Offset / Flip / Reblend; `rotate_control_points` on a surface (same factory family as move and scale, which were run); surface control points of imported or lofted spline surfaces with many control points; `rebuild` of several faces in one call (one face per call). Found but not in the manual, left out: `SweepToolCommand`, `PushFaceCommand`.

Committed (`68e6b66`), merged into `main` and published.

### Block 16 — copies and placement — ✅ Done in part (2026-10-04, ~2 h)

Five new tools, **116 in total** (`src/native/instances.ts`, `src/tools/instances.ts`; `array_curve` in the transforms family):

| Tool | Native factory | Notes |
|------|----------------|-------|
| `array_curve` | `CurveArrayFactory` | `items`, `curve`, `num`, `alignment` (`SweepAlignmentType` normal 21560 / parallel 21561 / transport 21564), `twistDegrees`, `scale`, `distance` as a ratio 0..1. Each copy keeps the offset the original has from the start of the curve; twist and scale act about the curve, so an original far from the curve start lands far away. |
| `create_instances` | `CreateInstanceFactory` (+ `MoveItemAndEmptyFactory`) | Bodies and curves. Create and shift inside one command. |
| `realize_instances` | `RealizeInstanceFactory` | |
| `list_instances`, `delete_instances` | — / native Delete | |
| `array_rectangular`, `array_radial`, `array_curve` (option) | `shouldMakeInstances` | `instances: true` → the result carries `createdInstances` instead of bodies. |

How instances are stored: they are "empties" like reference meshes (`db.empties`, class `InstanceEmpty`, info tag `Instance`), with small integer ids (`0`, `1`, …) that are reused after undo. An instance has no geometry: `targetKey` points to the source body (`db.nodes.key2item`), and its place is its own `matrixWorld`. Bounds in `list_instances` are the source's box carried by that matrix.

**Deferred, as warned in the proposal — both need the pointer:**
- **Place.** `PlaceFactory` computes its placement only from `configureSteps(…)` with seven arguments that the UI builds from the clicked snap points; setting its matrices directly fails inside the factory. Without the source there is no telling what the seven arguments are. What Place does without a pointer is already covered: `copy_bodies` (or `create_instances`) followed by `move_bodies` / `rotate_bodies` / `scale_bodies`.
- **Copy with Placement / Paste with Placement.** Copy with Placement waits for a click on the reference point. Plain copy and paste do work without a click (`editor.clipboard.copy()` on the selection writes to the system clipboard; `PasteCommand` pastes at the same coordinates and then waits in a move gizmo until confirmed) — that would move objects between two Plasticity windows. Not built: it was not what was proposed, it overwrites the user's clipboard, and the paste has to be confirmed programmatically. Designer's decision (2026-10-04): leave it out until there is a real need to move objects between documents.

Verified live in Untitled: `smoke:native` passes with **322 checks** (13 new); the end-to-end script over stdio passes (116 tools, argument validation, document restored); build and protocol tests pass.

**Not verified / not exposed:** `array_curve` extent as a metric distance (only the ratio); moving, rotating or hiding existing instances (no tools — an instance is placed when it is made); instances of instances; what happens to instances when their source is deleted.

Committed (`b04906a`), merged into `main` and published.

### Block 17 — scene — ✅ Done (2026-10-04, ~2.5 h)

Fifteen new tools, **131 in total** (`src/native/organize.ts`, a class between `SceneTools` and `PrimitiveTools`; tools in `src/tools/scene.ts`):

| Tool | How it works | Notes |
|------|--------------|-------|
| `list_groups` | `db.groups.snapshot()` | Groups are a tree under group 0 ("Scene"). A group's children are node keys, resolved to groups, bodies, instances and reference meshes. |
| `group_bodies` | native `GroupSelectedCommand` on the selection | The native command leaves the new group selected; the name is set inside the same command. |
| `ungroup` | native `DissolveGroupCommand` | |
| `move_to_group` | native `MoveSelectionToGroupCommand(editor, group)` | `db.groups.lookupById` does not fail on a number that is not a group, so ids are checked against the snapshot first. |
| `set_visibility` | `nodes.setHidden` / `setVisible` inside a carrier command | Undoable, like `rename_body`. |
| `unhide_all`, `isolate`, `unisolate`, `unlock_all` | native commands | `unisolate` is refused when `nodes.isolationLevel` is 0. |
| `set_locked` | `nodes.setLocked` inside a carrier command | |
| `list_materials`, `create_material` | `db.materials.list()` / `default.clone()` + `add(name, material)` | Creating is undoable. |
| `set_material` | `nodes.setMaterial(key, id)` inside a carrier command | |
| `remove_material` | native `RemoveMaterialCommand` on the selection | `setMaterial(key, 0)` is refused by Plasticity ("invalid material id"). |
| `select_topology` | `selection.selected.addFace` / `addEdge` | Not an undo step. |

Changes to existing output:
- `list_bodies` (and every result that carries bodies) has a new field **`materialId`**.
- **`visible` now also reflects isolation**: a body left out while others are isolated reports `visible: false`.
- `get_selection` also returns `faces`, `edges` (each with the body id and the face / edge id of `get_body_topology`), `regionIds` and `groupIds`.

Verified live in Untitled (fresh Plasticity): `smoke:native` passes with **346 checks** (24 new); the end-to-end script over stdio passes (131 tools, argument validation, document restored); build and protocol tests pass.

**Not verified / not exposed:** materials on individual faces (the risk named in the proposal — not attempted; materials are per body); editing or renaming an existing material, Fork Material, deleting a material; groups of groups created through the tools (`group_bodies` takes bodies only), renaming or deleting a group, the active group; visibility and locking of groups, instances and reference meshes; selecting curves' vertices, control points or regions through a tool (they are reported by `get_selection` only as far as regions and groups).

Committed (`3a27d3b`), merged into `main` and published.

### Block 18 — checking and measuring — ✅ Done (2026-10-04, ~3 h)

Eight new tools, **139 in total** (`src/native/measure.ts`, `src/tools/measure.ts`):

| Tool | How it works | Notes |
|------|--------------|-------|
| `check_bodies` | kernel `body.Check()` | Empty list of fault codes = valid. Read-only. |
| `find_boundary_edges` | kernel edges with one face | With `select` they are selected in the window (what Find Boundary Edges does). |
| `add_measurement` | `PointToPointMeasurementFactory` / `RadialMeasurementFactory` + `measurements.update` inside the native command | A measurement is attached to a **snap point** of a body: vertex, edge end / quarter / middle, circle centre, face centre. The tool finds the snap in `snaps.cache` by body and position (within a micron). Undoable. |
| `list_measurements`, `delete_measurements` | `measurements.snapshot()`; native Delete | |
| `measure_continuity` | `MeasureContinuityFactory.calculate()` + `evalSurfaceContinuityMeasurements` | Per edge: `g0max` (gap), `g1max` (angle), `g2max` (relative curvature change), judged against the factory's own tolerances (0.01 mm, 0.1°, 0.05). Nothing is added to the document. |
| `set_section_view`, `clear_section_view` | `editor.shading.section`, with the `Section` object of `SectionAnalysisFactory` | A display state: not a command, not in the undo history. Checked with a screenshot: a hollow box cut open, the side the normal points to removed. |

How a measurement stores its points: `target { bodyId (kernel id), topologyId, landmark }`, with landmark 0 = vertex, 1 = edge end, 2 = quarter, 3 = middle, 4 = three quarters, 5 = circle centre, 6 = face centre, 7 = radius. `list_measurements` resolves them back to coordinates through the same snap cache; the value is computed from the two points (or along the stored axis for a measurement made by hand that way).

**Differences from the proposal:**
- **`set_dimension` is deferred** (Designer agreed on 2026-10-04 to leave it out). Dimension builds its "dimension collection" inside the UI command from the selection; the only known way to get it is to replace a property setter on the factory's prototype while a throw-away command runs. That is the kind of workaround I said I would not do without asking. What it would change is covered by `refillet`, `scale_faces`, `offset` and `move_faces`.
- **Distance measurements are straight only.** Plasticity's default is a distance along one world axis, but the axis is picked by the pointer; setting `direction` on the factory has no effect.
- **No volume or area** — as said in the proposal, the kernel binding gives only the centroid.

Verified live in Untitled: `smoke:native` passes with **361 checks** (15 new); the end-to-end script over stdio passes (139 tools, argument validation, document restored); the section view was checked by eye on a screenshot; build and protocol tests pass.

**Not verified / not exposed:** measurements attached to curves (their snaps are in the same cache and resolve the same way, but only bodies were run); measurements when the Plasticity window is minimized (the snap cache may not be filled); renaming or moving the label of a measurement; continuity tolerances as parameters; the section view's `distance`, flip and the "previous plane" options; what a section view does to `export_drawing` and `screenshot` of other views.

Committed (`7fecfb3`), merged into `main` and published.

### Block 19 — environment — ✅ Done (2026-10-04, ~2.5 h)

Four new tools, **143 in total** (`src/native/environment.ts`, `src/tools/environment.ts`):

| Tool | How it works | Notes |
|------|--------------|-------|
| `get_environment` | `editor.document`, `document.settings.Unit` / `Grid`, `viewport.constructionPlane` | Document title, path (`document._filename`), `hasUnsavedChanges`; display units; grid; plane. Read-only. |
| `set_construction_plane` | `new ConstructionPlaneSnap(normal, origin, x)` assigned to `viewport.constructionPlane`; `viewport.resetCplane()` for xy | A state of the window, outside the history. Preset, free plane, or the plane of a planar face. |
| `open_document` | `editor.open(path)` | No dialog when a path is given. Took about 12 s for a one-body file. The session keeps working on the opened document. |
| `new_document` | `editor.loadStartup()` | Returns the window to a fresh "Untitled" (the startup document, by default one 1 m cube) without a dialog. Not in the proposal — found while looking for a way back from an opened file. |

Both `open_document` and `new_document` refuse while `editor.hasUnsavedChanges` is true, unless `discardChanges: true`. A fresh Untitled document and a just-opened file report no unsaved changes; any edit, even an undone one, makes it true.

**`create_outline` corrected and extended.** The note of block 14 was wrong: the outline factories do not read the window's plane themselves — the native command hands it to them as `factory.constructionPlane`, and a factory created without it always looks along Z. So in block 14 the tool always gave a top view, whatever plane was active. Now it passes the active plane, as the native command does, and also takes an explicit `planeNormal` / `planeOrigin`, which does not touch the window.

**Not possible, as warned in the proposal:**
- **`set_units`, `set_grid`.** There is no command for either (the registry has only `viewport:grid:incr` / `decr`, and nothing for units); the values live in settings objects that the UI writes directly. Writing them from outside would bypass whatever Plasticity does to store and announce the change. They are reported by `get_environment`.
- **Saving under the document's own name.** `editor.save()` and `saveAs()` take no path and open the system file dialog. `save_document` stays a copy. The way to continue in a named file is `save_document` followed by `open_document` of that file — history and body ids start anew.

Verified live: `smoke:native` passes with **370 checks** (9 new); the end-to-end script over stdio passes (argument validation, document restored); new / open / new run in sequence on the live window, ending on a fresh Untitled document; build and protocol tests pass.

**Not verified / not exposed:** saved construction planes of the document (`db.planes`, `SaveConstructionPlaneCommand`) — only the active plane is set; several viewports (one was open); opening a file written by another version of Plasticity or a large one; `open_document` while the window is minimized.

Committed, merged into `main` and published. The MCP client must be restarted to see the new tools.

## Full command coverage — where it stands (2026-10-04)

All ten blocks of the plan are done: **143 tools** (59 before the plan). Left out, each for a stated reason:

| Command | Why |
|---------|-----|
| Split Segment, Insert Knot | Position comes only from the pointer; needs a proxy on a private field. Covered by `cut` on curves and `subdivide_curves`. |
| Place, Copy / Paste with Placement | Placement comes only from clicks on snap points. Covered by `copy_bodies` / `create_instances` + the transform tools. |
| Dimension | Its data is built inside the UI command. Covered by `refillet`, `scale_faces`, `offset`, `move_faces`. |
| Set units, set grid | No command; direct writes into settings. |
| Save under the document's own name | Native save opens the system dialog. |
| Align, PolySplines, xNURBS, Square, Rebuild Face (explicit); IGES, SAT | Studio edition only. |
| Publish to Plasticity Share | Uploads the document to the web. |
| Display toggles (curvature, points), freestyle transforms | Excluded by the plan. |
| Volume, area | Not a Plasticity command, and the kernel binding does not expose them. |

Other ideas (not agreed yet): transforming and hiding reference meshes; opening `.plasticity` files is in block 19.

**Documented for readers of the repository (2026-10-04, on the Designer's request):** `docs/coverage.md` — Plasticity command → tool with the limits of each, the commands that are not available and what to use instead, where a tool differs from the command, general limits. The root `README.md` has a short "Coverage and limits" section pointing to it; `mcp-server/README.md` got a current introduction and one table per tool family (the single long table was broken by blank lines in three places). No code changed.

## Risks

- **Binary protocol details**: WS payloads are likely binary (efficient mesh transfer). Recon must decode framing exactly. Mitigation: addon source is Python and readable.
- **Version drift**: each Plasticity release may change opcodes or add fields. → Keep MCP tolerant of unknown opcodes; pin tested versions.
- **CommandExecutor headlessness**: some commands rely on UI gizmos/picks. Recon must enumerate the headless-safe subset.
- **Patch maintainability**: keep fork patch minimal; tag-based rebase workflow.
- **License**: forking ok for personal use; publishing requires LICENSE review.

## Out of scope

- Fully headless Plasticity (window required)
- Multi-user / remote network access
- Public MCP distribution
- Custom C3D operations beyond `CommandExecutor`

## Open questions

1. WS port — fixed or configurable? Default in addon source. (Recon Phase 0)
2. Auth — token? Localhost-only? (Recon Phase 0)
3. Does `PUT_SOME_1` create true B-Rep solids or just imported meshes? Affects whether mesh-push covers any "generation" use cases without fork.
4. Does any existing opcode invoke `export_step`? (Worth checking before assuming fork is needed for export.)
5. Sync vs async tool responses for long-running booleans?

## Repo layout (planned)

```
PlasticityMCP/
├── team.md
├── task.md
├── README.md
├── docs/
│   ├── ws-protocol.md           # filled during Phase 0
│   └── architecture.md
├── plasticity-fork/             # gitignored; cloned locally during Phase 2+
├── bridge/                      # patch files for fork (Phase 3+)
├── mcp-server/                  # Node MCP server
│   ├── src/
│   ├── package.json
│   └── tsconfig.json
└── scripts/                     # dev helpers
```

## Next action

1. Designer: close Plasticity and call `native_launch` (or `npm run smoke:native`) once to verify the cold-start path; restart the MCP client so it picks up the new tools.
2. Full command coverage: blocks 0, 0b (split of `index.ts`) and 11 (solids) are in `main` and published — 69 tools. Blocks 0, 0b, 11 and 12 are in `main` and published — 84 tools. Blocks 0, 0b, 11, 12 and 13 are in `main` and published — 105 tools. Blocks 0, 0b and 11–14 are in `main` and published — 108 tools. Blocks 0, 0b and 11–15 are in `main` and published — 111 tools. Blocks 0, 0b and 11–16 are in `main` and published — 116 tools. Blocks 0, 0b and 11–17 are in `main` and published — 131 tools. Blocks 0, 0b and 11–18 are in `main` and published — 139 tools. Full command coverage is complete and in `main`: blocks 0, 0b and 11–19, 143 tools. Checked through the MCP client after its restart on 2026-10-04: `native_connect`, `get_environment`, `list_bodies`, `set_construction_plane` (yz, back to xy), `create_outline` (flat on the active YZ plane, and with `planeNormal` [0, 1, 0]) and `undo` all work; the document was left as it was (one default cube, plane XY). The coverage and the limits are documented in `docs/coverage.md` and both READMEs. Next: the tests on real parts the Designer asked for earlier (he names the part).
