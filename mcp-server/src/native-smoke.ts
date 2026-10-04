/**
 * Live smoke test for the native (CDP) write path. MUTATES the open document, so it only runs
 * in a pristine "Untitled" document (no edit history). A new document is not empty — Plasticity
 * starts with a default 1 m cube — so the test undoes back to the baseline it found.
 *
 *   npm run smoke:native
 */
import { launchPlasticity } from "./launcher.js";
import { BodyInfo, NativeSession, Vec3 } from "./native.js";

const TOLERANCE_MM = 1e-3;

function check(label: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) process.exitCode = 1;
}

function boundsMatch(body: BodyInfo | undefined, min: Vec3, max: Vec3): boolean {
  if (!body?.boundsMm) return false;
  const near = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]!) < TOLERANCE_MM);
  return near(body.boundsMm.min, min) && near(body.boundsMm.max, max);
}

const fmt = (body: BodyInfo | undefined) => JSON.stringify(body?.boundsMm ?? null);

async function main() {
  const launch = await launchPlasticity();
  console.log(launch.alreadyAvailable ? "Plasticity already has CDP." : "Launched Plasticity.");

  const native = new NativeSession();
  const target = await native.connect();
  console.log(`Connected to "${target.title}"`);

  const baseline = await native.state();
  if (!target.title.startsWith("Untitled") || baseline.undoDepth > 0) {
    throw new Error(
      `Refusing to run in "${target.title}" (undo depth ${baseline.undoDepth}). ` +
        `Use a fresh Untitled document.`,
    );
  }
  const baselineIds = baseline.bodies.map((b) => b.id).join(",");

  const box = await native.createBox([10, 20, 0], [80, 40, 8], "mcp-smoke-box");
  check("box created", box.created.length === 1, `id ${box.created[0]?.id}`);
  check("box is a Solid named mcp-smoke-box",
    box.created[0]?.type === "Solid" && box.created[0]?.name === "mcp-smoke-box");
  check("box bounds", boundsMatch(box.created[0], [10, 20, 0], [90, 60, 8]), fmt(box.created[0]));

  const sphere = await native.createSphere([0, 0, 50], 15);
  check("sphere created", sphere.created.length === 1);
  check("sphere bounds", boundsMatch(sphere.created[0], [-15, -15, 35], [15, 15, 65]),
    fmt(sphere.created[0]));

  const cylinder = await native.createCylinder([-50, 0, 0], 5, 30);
  check("cylinder created", cylinder.created.length === 1);
  check("cylinder bounds", boundsMatch(cylinder.created[0], [-55, -5, 0], [-45, 5, 30]),
    fmt(cylinder.created[0]));

  const tilted = await native.createCylinder([0, 100, 0], 5, 30, [1, 0, 0]);
  check("cylinder along +X bounds", boundsMatch(tilted.created[0], [0, 95, -5], [30, 105, 5]),
    fmt(tilted.created[0]));
  await native.undo();

  const undone = await native.undo();
  check("undo removes the cylinder",
    undone.removedIds.length === 1 && undone.removedIds[0] === cylinder.created[0]?.id);
  const redone = await native.redo();
  check("redo restores the cylinder", boundsMatch(redone.created[0], [-55, -5, 0], [-45, 5, 30]));

  // Clean up: undo everything this test did.
  for (let i = 0; i < 10 && (await native.state()).undoDepth > baseline.undoDepth; i++) {
    await native.undo();
  }
  const final = await native.state();
  check("document is back to its baseline",
    final.bodies.map((b) => b.id).join(",") === baselineIds, `${final.bodies.length} bodies`);

  native.disconnect();
  console.log(process.exitCode ? "\nSMOKE FAILED" : "\nSMOKE PASSED");
}

main().catch((err) => {
  console.error("SMOKE ERROR:", (err as Error).message);
  process.exit(1);
});
