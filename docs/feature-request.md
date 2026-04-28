# Feature Request — Programmatic Command Invocation via WebSocket

**Target:** https://plasticity.canny.io/
**Author:** internal use, Plasticity 26.1.2
**Status:** draft, not yet submitted

---

## Title

Add a WebSocket opcode to invoke `CommandExecutor` commands programmatically (for AI / MCP / scripting integrations)

## Summary

Plasticity already runs a built-in WebSocket server on `localhost:8980` (used by the official Blender bridge, with opcodes `LIST_ALL_1`, `SUBSCRIBE_*`, `PUT_SOME_1`, `REFACET_SOME_1`, etc.). The protocol is great for **reading** the scene and pushing meshes, but there is no way to **invoke a CAD command** — Sphere, Box, Extrude, Boolean, Fillet — from outside the application.

I'd like to propose a single new opcode that fills that gap.

## Use case

I'm building a [Model Context Protocol](https://modelcontextprotocol.io/) bridge that lets an LLM (Claude/GPT/etc.) read the current Plasticity scene and **modify** it through natural language instructions like:

> "Place a sphere of radius 5 at (0, 0, 0), then boolean-subtract a cylinder going through it along Z."

Read-side already works through the existing protocol (subscribing to `TRANSACTION_1`, calling `LIST_ALL_1`). Write-side is the missing piece.

This pattern unlocks several workflows beyond AI:

- **Procedural/generative design:** scriptable parameter sweeps, parametric variants
- **External tooling:** generators in JS/Python writing directly into Plasticity
- **Headless test automation** for plugin or workflow developers
- **Cross-app pipelines** (e.g. generate from a config in another tool, push to Plasticity)

## Proposed opcode

```
EXEC_COMMAND_1 (suggested value: 30)

Client → Plasticity:
  u32 type = 30
  u32 msg_id
  u32 cmd_name_len
  [cmd_name_len] u8 cmd_name      // e.g. "SphereCommand", "ExtrudeCommand"
  pad4
  u32 args_json_len
  [args_json_len] u8 args_json    // UTF-8 JSON, command-specific
  pad4

Plasticity → Client:
  u32 type = 30
  u32 msg_id
  u32 code           // 200 OK, 4xx client error, 5xx server error
  u32 message_len
  [message_len] u8 message        // success info OR error text
  pad4
  u32 num_created_ids             // plasticity_ids of new objects
  [num_created_ids] u32 created_id
```

## Per-command JSON schemas (suggested)

```jsonc
// SphereCommand
{ "center": [x, y, z], "radius": r }

// ThreePointBoxCommand
{ "p1": [x, y, z], "p2": [x, y, z], "p3": [x, y, z], "height": h }

// CylinderCommand
{ "base": [x, y, z], "radius": r, "height": h, "axis": [0, 0, 1] }

// ExtrudeCommand
{ "regionIds": [pid, ...] /* or faceIds */, "distance": d, "axis": [...] }

// BooleanCommand
{ "operation": "union" | "difference" | "intersection",
  "targetId": pid, "toolIds": [pid, ...] }

// FilletSolidCommand
{ "edgeIds": [eid, ...], "distance": d }

// MoveCommand / RotateCommand / ScaleCommand
{ "ids": [pid, ...], "delta": [...] /* or pivot+angle, or factor */ }
```

The set of accepted commands could mirror what's already exported from `commands/GeometryCommands.ts`. The dev decides which subset is safe to expose programmatically.

## Implementation hints (taking the load off your plate)

The existing OSS architecture (still visible in older `nkallen/plasticity` master) suggests the cleanest entry point is the **Factory** (e.g. `SphereFactory`) rather than the `Command` (which expects a UI flow with `PointPicker`). Roughly:

```ts
// pseudo-code, conceptual
async function execCommand(name: string, argsJson: string) {
  const args = JSON.parse(argsJson);
  switch (name) {
    case "SphereCommand": {
      const f = new SphereFactory(editor.db, editor.materials, editor.signals);
      f.center = new Vector3(...args.center);
      f.radius = args.radius;
      const result = await f.commit();
      return { code: 200, createdIds: [result.simpleName] };
    }
    // ... etc
  }
}
```

This avoids touching `Command` / `PointPicker` and stays parametric end-to-end.

## Why this matters now

- The "AI + 3D modeling" space is moving fast (early 2026). Plasticity has the right primitives to be a leader here, especially because the Blender bridge already proves you're comfortable with WS integration.
- A documented opcode is **much cleaner than the alternatives** people are starting to attempt: CDP injection, asar patching, UI automation. Those are all fragile and bad PR vectors when they break.
- One opcode unlocks an unbounded space of community tooling.

## Smallest possible v1

If full coverage is too much for one release, even **just `SphereCommand` + `ThreePointBoxCommand` + `MoveCommand` + `BooleanCommand`** would be enough to prove the pattern and let the community build on top.

## What I'm willing to do

- Test against pre-release builds and report bugs
- Document the opcode publicly (the existing protocol is already partially reverse-engineered in [PlasticityMCP/docs/ws-protocol.md](https://github.com/ozymandi/PlasticityMCP/blob/main/docs/ws-protocol.md) — happy to PR canonical docs once the opcode lands)
- Build/maintain the open-source MCP bridge to drive adoption

Thanks for considering this — Plasticity is already the best-feeling NURBS modeler I've used, and this would put it in a unique position vs. anything else on the market.
