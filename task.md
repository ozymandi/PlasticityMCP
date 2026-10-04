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

**Not verified:** the cold-start path of `launcher.ts` (Plasticity closed → `native_launch`). The same logic passed in the spike script, but the TypeScript version has only run against an already-launched instance.

Changes are **not committed**.

### Next blocks (each proposed separately before implementation)

1. Scene: list bodies with stable ids, select, delete, rename.
2. Transforms: move, rotate, scale.
3. Boolean, fillet, extrude.
4. Curves: polyline, circle, spline.
5. STEP import/export, save document, screenshot.

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
2. Propose block 1 (scene: list / select / delete / rename).
