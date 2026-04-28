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

## Active path (post-recon)

**Step 1 (5 min, user action):** Update Plasticity to 26.1.3 → run `npm run smoke` → see if `PUT_SOME_1` appears in supported opcodes.
- **Yes** → `push_mesh` works → ship as MVP for triangulated-mesh generation. Re-scope.
- **No** → proceed to Step 2.

**Step 2 — Path D recon spike (~2 h):** Does Plasticity launch with `--remote-debugging-port`? Is there a global `editor` reachable from the renderer? If yes, we can call `editor.executor.enqueue(new SphereCommand(editor))` (or call `SphereFactory.commit()` directly) from injected JS.

**Step 3 — in parallel:** File a feature request at plasticity.canny.io for a documented `EXEC_COMMAND_1` opcode. This is the long-term clean solution regardless of Path D.

**Phases 4–7 (CAD tools, scene awareness, high-level gen, verification loop)** are unchanged in spirit but now sit on top of Path D (or Path A's mesh push, if that's all we have). Estimates only firm up after Step 2's outcome.

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
