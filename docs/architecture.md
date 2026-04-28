# Architecture & Plan Revision (Phase 2 recon)

**Date:** 2026-04-28
**Status:** Critical re-plan — original Phase 3 (fork patch) is **not viable**.

## Recon target

Goal: clone `nkallen/plasticity`, find the WS server / `CommandExecutor` injection point, plan a minimal fork patch adding `EXEC_COMMAND_1` for CAD-level operations.

## Finding 1 — The OSS repo is frozen at v1.4-era

| Fact | Evidence |
|------|----------|
| `package.json` declares `"version": "0.6.30"` | repo root |
| Last meaningful commit: 2023-10-20 (only README touch-ups since) | `git log` |
| Tags `v26.1.0`, `v26.1.2`, `v26.1.3`, `v2024.1.0` exist… | `git tag --sort=-v:refname` |
| …but **all point at the same 2023 commit** | `git checkout v26.1.3` shows the same `package.json` v0.6.30 |
| The repo's `master` is what shipped before Plasticity went commercial-closed | inferred — README points to private Discord for paid users, no source after v1.4-beta is public |

**The current Plasticity 26.x is fully closed-source.** Tags in the public repo are decorative — they mark which README revision was contemporary with which binary release, but the code at those tags is the v1.4-era snapshot.

## Finding 2 — The WS server / blender-bridge is NOT in the OSS code

Searched the entire OSS source tree for traces of the WS protocol we already verified is live in 26.1.2:

| Pattern | Hits |
|---------|------|
| `8980` (port) | 0 in `src/` |
| `WebSocket`, `ws://`, `net.Server` | 0 in `src/` |
| `PUT_SOME`, `HANDSHAKE_1`, `SUBSCRIBE_ALL`, `MessageType` | 0 in `src/` |
| `blender` | only as a viewport-orbit-control preset string |

→ The WS server, the entire blender-bridge protocol, and all 13 advertised opcodes were **added to the closed-source codebase after the OSS snapshot froze**. We cannot fork.

## Finding 3 — The Command/Factory pattern (still useful as reference)

Even though we can't modify the binary, the OSS code reveals the architectural pattern that the closed binary almost certainly still uses (it's too central to remove). Capturing it for future leverage:

### `CommandExecutor`
- File: `src/command/CommandExecutor.ts`
- Owns one active `Command` and a queue of one pending `Command`
- Single entry point: `enqueue(command, interrupt = true, remember = true)`
- Commands run **atomically** — no overlap; a new command interrupts and waits for cleanup
- Uses `EditorLike` (db, registry, signals, history, selection, contours, viewports, meshCreator, snaps, copier, helpers) — the broker between commands and the world

### `Command` (UI-level)
- Drives gizmos, point pickers, keyboard input
- Example, `SphereCommand`:
  ```ts
  class SphereCommand extends Command {
    async execute() {
      const sphere = new PossiblyBooleanSphereFactory(db, materials, signals).resource(this);
      const { point: p1 } = await pointPicker.execute().resource(this);  // UI pick
      sphere.center = p1;
      await pointPicker.execute(({ point: p2 }) => {                     // UI drag
        sphere.radius = p1.distanceTo(p2);
        sphere.update();
      }).resource(this);
      const results = await sphere.commit();
    }
  }
  ```

### `GeometryFactory` (logic-level — **the real entry point we'd want**)
- File: `src/command/GeometryFactory.ts`
- Pure computation — no UI. Takes parameters, calls into c3d kernel, returns solids.
- Example, `SphereFactory`:
  ```ts
  class SphereFactory extends GeometryFactory {
    center!: THREE.Vector3;
    radius!: number;

    async calculate() {
      const points = [point2point(center), /* + X axis, + Z*radius */];
      const names = new c3d.SNameMaker(composeMainName(c3d.CreatorType.ElementarySolid, db.version), c3d.ESides.SideNone, 0);
      return c3d.ActionSolid.ElementarySolid(points, c3d.ElementaryShellType.Sphere, names);
    }
  }
  ```
- Lifecycle: set params → `update()` (preview) → `commit()` (finalize, push to GeometryDatabase, emit signals)

### Why this matters

If we ever **could** call into the binary's process, we'd skip `Command` entirely and call `Factory.commit()` directly with our params. That's the cleanest API for programmatic generation. This informs:

1. The shape of a hypothetical `EXEC_COMMAND_1` opcode payload
2. The shape of any feature request to Plasticity dev
3. Anything we build via runtime injection (see Path D below)

## Revised paths forward

| Path | What it requires | What it gives | Honest estimate | Verdict |
|------|------------------|---------------|-----------------|---------|
| **A. Wait for `PUT_SOME_1` to ship in stable** | Plasticity dev to flip a flag | Mesh-push generation (triangulated, not parametric) | Out of our hands | **Try first** — user updates to 26.1.3 → smoke-test handshake. 5-min check. |
| **B. Lobby Plasticity dev for `EXEC_COMMAND_1`** | File request at plasticity.canny.io / Discord | True parametric CAD ops over WS | Months, no guarantee | Worth a request. Low effort. |
| **C. Fork OSS v1.4-era and add the opcode there** | ~14–24h dev | A custom modeler with MCP, but **missing 2+ years of features** (no PolySplines, Slot, modern Extrude/Mirror, etc.) | Useless deliverable — would not match any current Plasticity workflow | **Dead.** |
| **D. Electron CDP injection** | Plasticity launched with `--remote-debugging-port=N`, then WS into renderer to call `editor.executor.enqueue(new SphereCommand(editor))` directly | Real CAD ops against the **actual** running 26.x binary | 8–14h to prototype if access path works; very fragile across versions | **Worth a recon spike.** Highest ceiling, real risk. |
| **E. UI automation via Windows-MCP / accessibility** | Drive Plasticity's UI by mouse/keyboard | Any operation a human can do | 6–12h | **Fallback.** Slow, brittle to UI changes, but version-independent. |
| **F. Hybrid: read via WS (Phase 1, done) + write via D or E** | Pick D or E as the write side | Working "generate spheres" today, with a real upgrade path | Phase 1 done; +D or +E above | **Most pragmatic next step.** |

## Recommended next step

1. **5-min check:** user updates Plasticity to 26.1.3 → run `npm run smoke` → does `PUT_SOME_1` show up in `supportedOpcodes`?
   - If **yes**: mesh-push works. We can generate "spheres" as triangulated meshes today. Ship Phase 1 as the MVP and re-evaluate if mesh-only is enough.
   - If **no**: continue to step 2.

2. **Path D recon spike (~2h):** does Plasticity start with a debugger port? Can we attach via CDP? Is there a global `editor` reachable from the renderer? If yes, we have a real injection vector.

3. **In parallel:** post a feature request at plasticity.canny.io for a documented `EXEC_COMMAND_1` opcode. Even if Path D works, that's the long-term clean solution.

## What Phase 2 actually delivered

- Confirmed OSS repo is unusable as a base for a fork patch
- Captured the `CommandExecutor` / `Command` / `GeometryFactory` pattern as future leverage
- Mapped 6 viable paths forward and ranked them honestly
- **Phase 3 (as originally scoped) is closed.** Any "generation" path now goes through A, D, E, or a future feature from Plasticity dev.

---

## Appendix: SphereFactory dependencies (if Path D works)

If we end up calling factories from injected JS, the minimum context required is:

```ts
const factory = new SphereFactory(editor.db, editor.materials, editor.signals);
factory.center = new THREE.Vector3(x, y, z);
factory.radius = r;
await factory.commit();   // pushes to GeometryDatabase, fires signals, our WS subscriber sees ADD_1
```

Equivalent params for other primitives (from OSS code, names current Plasticity likely retains):

| Factory | Params |
|---------|--------|
| `SphereFactory` | `center: Vector3`, `radius: number` |
| `ThreePointBoxFactory` | `p1, p2, p3: Vector3`, `height: number` (3-corner + height) |
| `CylinderFactory` | `base: Vector3`, `radius`, `height` |
| `CircleFactory` | `center: Vector3`, `radius`, `normal?: Vector3` |
| `RectangleFactory` | `p1, p2: Vector3` (corners) |
| `ExtrudeFactory` | `region` or `face`, `distance: number` |
| `BooleanFactory` (Union/Diff/Intersect) | `target`, `tools`, `operationType` |
| `FilletFactory` | `edges: visual.CurveEdge[]`, `distance: number` |
