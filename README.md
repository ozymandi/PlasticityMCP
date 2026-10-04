# PlasticityMCP

MCP server for [Plasticity](https://www.plasticity.xyz/) — lets an LLM read, create and modify real CAD geometry inside a running Plasticity window.

**Status:** working, for internal use. 39 tools, verified live on **Plasticity 26.1.3 / Windows**. Unofficial: it relies on Plasticity's internal APIs and is pinned to that exact version.

## What it can do

| Area | Tools |
|------|-------|
| Session | `native_launch`, `native_connect`, `native_status` |
| Primitives | `create_box`, `create_sphere`, `create_cylinder` |
| Curves | `create_polyline`, `create_spline`, `create_circle`, `extrude_profile` |
| Scene | `list_bodies`, `get_selection`, `select_bodies`, `delete_bodies`, `rename_body` |
| Transforms | `move_bodies`, `rotate_bodies`, `scale_bodies` |
| Modelling | `get_body_topology`, `boolean`, `fillet_edges`, `chamfer_edges`, `extrude_faces` |
| Files | `export_step`, `import_step`, `save_document` |
| View | `set_view`, `screenshot` |
| History | `undo`, `redo` |
| Blender-bridge channel | `connect`, `status`, `list_scene`, `get_object`, `subscribe_changes`, `unsubscribe_changes`, `drain_events`, `refacet`, `push_mesh` |

Geometry is native B-Rep made by Plasticity's own factories, so every operation lands in Plasticity's history and can be undone there. Units are millimetres. Details per tool: [mcp-server/README.md](mcp-server/README.md).

## How it works

```
LLM ──stdio──> MCP server (Node/TS) ──┬─ CDP, 127.0.0.1:9223 ──> Plasticity renderer   (native CAD tools)
                                      └─ WebSocket, :8980 ─────> Plasticity bridge     (read-only scene sync)
```

Two independent channels:

- **Native channel (CDP).** Plasticity 26.x is closed-source and strips `--remote-debugging-port`, but the Node main-process inspector still works. `native_launch` starts Plasticity paused with `--inspect-brk`, re-enables a loopback-only debugging port before any app code runs, and resumes. Nothing on disk is patched. The server then reaches `editor` and the Factory classes through the closure scopes of the command-log element and runs operations as native commands.
- **Bridge channel (WebSocket).** The built-in server used by the official [Blender add-on](https://github.com/nkallen/plasticity-blender-addon): scene listing, change subscription, retessellation. Read-side only on 26.1.x.

## Requirements

- Windows, Plasticity **26.1.3** installed (the server refuses any other version)
- Node.js 18+

## Quick start

```bash
cd mcp-server
npm install
npm run build
```

Register `mcp-server/dist/index.js` as a stdio MCP server in your client, then ask it to call `native_launch` followed by `native_connect`.

Plasticity has to be started through `native_launch`; an instance started normally has no debugging port and must be closed first (the server never closes it for you).

Live check against a running instance — it only runs in an empty "Untitled" document and undoes everything it does:

```bash
npm run smoke:native
```

## Caveats

- **Do not update Plasticity** past 26.1.3 without re-verifying: any release can change the internal APIs or close the inspector path.
- While Plasticity runs with the debugging port, any local process can drive it. The port is bound to loopback and disappears when Plasticity closes.
- Face and edge ids change after every modification of a body — re-read `get_body_topology` before each fillet / chamfer / face extrusion.
- Failed operations appear as red toasts in the Plasticity window.
- The developer removes debug access from release builds on purpose. Fine for personal use; think twice before distributing.

## Repository

- [mcp-server/](mcp-server/) — the server (`src/native.ts` is the CAD layer, `src/launcher.ts` the launch trick, `src/native-smoke.ts` the live test)
- [task.md](task.md) — scope, decisions, per-block status and findings
- [docs/ws-protocol.md](docs/ws-protocol.md) — reverse-engineered bridge protocol
- [docs/architecture.md](docs/architecture.md), [docs/feature-request.md](docs/feature-request.md) — April 2026 recon, kept for history; the "every path is closed" conclusion there is superseded by the native channel

## License

TBD. Plasticity itself is licensed under its own terms.
