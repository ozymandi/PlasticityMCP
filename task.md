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

## Phases (revised)

| # | Phase | Deliverable | Estimate (h) |
|---|-------|-------------|--------------|
| 0 | **Recon** | Reverse-engineer existing WS protocol from `plasticity-blender-addon`; confirm port/auth/binary format; map opcodes; document scene-graph schema | 4–6 |
| 1 | **MCP MVP — read & mesh push (no fork)** | Node MCP server speaking existing WS. Tools: `connect`, `list_scene`, `get_object`, `subscribe_changes`, `drain_events`, `refacet`, `push_mesh`, `status`. ✅ **Done** — verified against live Plasticity 26.1.2. **Note:** `PUT_SOME_1` not advertised by 26.1.2, so `push_mesh` is wired but server-rejected pending a Plasticity build that exposes it. | 8–12 → ~3 actual |
| 2 | **Recon CommandExecutor** | Build Plasticity from source; map which `CommandExecutor` commands accept programmatic args; identify clean injection point for new WS opcodes | 6–10 |
| 3 | **Bridge patch (fork)** | Minimal patch to Plasticity adding `EXEC_COMMAND_1` opcode that invokes named commands with JSON args; rebase-friendly | 8–14 |
| 4 | **MCP CAD tools** | Tools wrapping commands: `create_box/sphere/cylinder/circle/rectangle`, `extrude`, `boolean_{union,diff,intersect}`, `move/rotate/scale`, `fillet`, `undo/redo` | 8–12 |
| 5 | **Scene awareness** | `select_by_name`, `get_bbox`, `get_selection`, history inspection, named refs across calls | 6–10 |
| 6 | **High-level generation** | Composite tools (`make_bracket(specs)`, etc.); prompt-to-geometry recipes | 15+ (open) |
| 7 | **Verification loop** | Screenshot via Electron `capturePage` returned as image; LLM visual confirmation | 6–10 |

**Useful-without-fork target (Phases 0–1): ~12–18 h.**
**Full CAD MVP (Phases 0–4): ~34–54 h.**

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
