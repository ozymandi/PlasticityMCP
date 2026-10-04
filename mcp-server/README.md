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

Mutating tools return the created bodies (stable id, type, name, bounds) and removed ids.

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
