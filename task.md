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

**Phase 0 kickoff:** read `plasticity-blender-addon` source (`client.py`, `handler.py`) and document the WS protocol in `docs/ws-protocol.md` — port, framing, opcode payloads, scene-graph schema. No code yet.
