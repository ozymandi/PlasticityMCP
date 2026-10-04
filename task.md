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
| 11 | Solids: Cut, Hollow, Thicken, Thicken Face, Offset Face, Draft Face, Delete Face, Patch, Pipe, Join / Unjoin, Remove Fillets | 13 | 5 | next |
| 12 | Faces and edges: Move / Rotate / Scale Face, Offset Edge, Offset Face Loop, Match Face, Extend Sheet, Untrim, Reverse, Unwrap, Isoparam, Complete Edge, Imprint | 14 | 5.5 | |
| 13 | Curves: Offset, Fillet Curve / Vertex, Trim, Cut, Split, Extend, Bridge, Rebuild, Raise Degree, Slot, Text, Spiral, Polygon, rectangles, tangent arcs and circles, control points | ~30 | 10 | |
| 14 | Projection: Project (three kinds), Project Outline, Create Outline, Duplicate and Project | 7 | 3 | |
| 15 | Surfaces: Bridge Surface, Constrained Surface, Raise Surface Degree, Slide CV, Deform, Loft Guide | 6 | 3 | |
| 16 | Copies and placement: Curve Array, Place, Copy / Paste with Placement, instances | 6 | 2.5 | |
| 17 | Scene: groups, hide / show / isolate, lock, materials, extended selection | 12 | 4 | |
| 18 | Measuring: distance, radius, continuity, Dimension, Section Analysis, Check | 7 | 3 | |
| 19 | Environment: construction planes, new / open / save document, units and grid | 5 | 2.5 | |

Each block: its own proposal, live verification, `smoke:native` checks, commit on Designer's word. Work is on branch `native-full-spectrum`.

### Block 0 — ✅ Done (2026-10-04, ~1.5 h)

- `mcp-server/src/native.ts` (2231 lines) is now a thin facade; the code lives in `mcp-server/src/native/`: `types.ts`, `math.ts`, `snippets.ts`, `core.ts` (connection, command execution, history) and one class per family — `scene.ts`, `primitives.ts`, `curves.ts`, `profiles.ts`, `solids.ts`, `transforms.ts`, `exchange.ts`, `view.ts` — chained by inheritance so `NativeSession` still has every method. The split was done by script as a pure move (checked line by line: nothing lost or added except class wrappers); core members went from `private` to `protected`. `index.ts` and the smoke test are untouched by the split.
- `get_body_topology` now also describes **curves**: `closed`, segments (id, kind, length, start / mid / end), vertices (id, position) and control points (id, position). Earlier it refused curves. Segment ids look like `1278s106702`, vertex ids like `106699`, control point ids like `1`.
- Finding: a Wire view has `segments`, `vertices`, `cvs` collections (`versionIds` on segments, `ids` on the other two); vertex and control point positions come from the view in single precision, so they are rounded to a micron. Selection has matching `addSegment`, `addVertex`, `addCurveCV`, and `addShellCV` for surface control points (`view.high.cvs`, left for block 15).

Verified: `smoke:native` passes before and after (173 checks, 20 s), build and protocol tests pass, and the block 7 end-to-end script over stdio passes against the rebuilt server (document restored to empty).

**Open question for the Designer:** `index.ts` (tool descriptions, argument schemas, dispatch — 1920 lines for 59 tools) will roughly double. Splitting it the same way, with each family's tool definitions next to its code, was not part of the approved block 0.

Committed, merged into `main` and published.

Other ideas (not agreed yet): transforming and hiding reference meshes; opening `.plasticity` files is in block 19.

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
2. Full command coverage: block 0 is in `main` and published. Approved 2026-10-04: split `index.ts` per family, then block 11 (solids) as proposed, including the rename `join_curves` → `join`. Work continues on branch `native-full-spectrum`.
