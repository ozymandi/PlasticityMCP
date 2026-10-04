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
  const disposable = baseline.undoDepth === 0 || baseline.bodies.length === 0;
  if (!target.title.startsWith("Untitled") || !disposable) {
    throw new Error(
      `Refusing to run in "${target.title}" (${baseline.bodies.length} bodies, undo depth ` +
        `${baseline.undoDepth}). Use a fresh or empty Untitled document.`,
    );
  }
  const baselineIds = baseline.bodies.map((b) => b.id).join(",");
  const ids = (bodies: BodyInfo[]) => bodies.map((b) => b.id).join(",");

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

  // --- scene: list / rename / select / delete ---
  const boxId = box.created[0]!.id;
  const sphereId = sphere.created[0]!.id;

  const listed = (await native.state()).bodies.find((b) => b.id === boxId);
  check("box is listed with topology and flags",
    listed?.faceCount === 6 && listed.edgeCount === 12 && listed.visible && !listed.locked,
    JSON.stringify({ faces: listed?.faceCount, edges: listed?.edgeCount }));

  const renamed = await native.renameBody(boxId, "mcp-smoke-renamed");
  check("rename", renamed.name === "mcp-smoke-renamed");
  await native.undo();
  const unrenamed = (await native.state()).bodies.find((b) => b.id === boxId);
  check("undo restores the name", unrenamed?.name === "mcp-smoke-box", String(unrenamed?.name));

  const selected = await native.selectBodies([boxId, sphereId]);
  check("select two bodies", ids(selected) === `${boxId},${sphereId}`, ids(selected));
  check("get_selection agrees", ids(await native.getSelection()) === `${boxId},${sphereId}`);
  const badSelect = await native.selectBodies([boxId, 999999]).then(() => null, (e: Error) => e);
  check("unknown id is rejected", badSelect !== null, badSelect?.message ?? "no error");
  check("failed select keeps the selection",
    ids(await native.getSelection()) === `${boxId},${sphereId}`);
  check("empty list clears the selection", (await native.selectBodies([])).length === 0);

  const deleted = await native.deleteBodies([sphereId]);
  check("delete removes the sphere",
    deleted.removedIds.length === 1 && deleted.removedIds[0] === sphereId);
  const undeleted = await native.undo();
  check("undo restores the sphere", undeleted.created[0]?.id === sphereId,
    fmt(undeleted.created[0]));

  // --- transforms: move / rotate / scale (box is [10,20,0]..[90,60,8], centre [50,40,4]) ---
  const transformed = (label: string, result: { changed: BodyInfo[] }, min: Vec3, max: Vec3) => {
    const body = result.changed.find((b) => b.id === boxId);
    check(label, boundsMatch(body, min, max), fmt(body));
  };

  transformed("move", await native.moveBodies([boxId], [5, -5, 10]), [15, 15, 10], [95, 55, 18]);
  transformed("undo move", await native.undo(), [10, 20, 0], [90, 60, 8]);

  transformed("rotate 90° about Z, default pivot",
    await native.rotateBodies([boxId], [0, 0, 1], 90), [30, 0, 0], [70, 80, 8]);
  await native.undo();
  transformed("rotate 90° about Z, pivot at origin",
    await native.rotateBodies([boxId], [0, 0, 2], 90, [0, 0, 0]), [-60, 10, 0], [-20, 90, 8]);
  await native.undo();

  transformed("scale ×2, default pivot",
    await native.scaleBodies([boxId], [2, 2, 2]), [-30, 0, -4], [130, 80, 12]);
  await native.undo();
  transformed("scale [2, 1, 0.5] from the min corner",
    await native.scaleBodies([boxId], [2, 1, 0.5], [10, 20, 0]), [10, 20, 0], [170, 60, 4]);
  await native.undo();

  const pair = await native.moveBodies([boxId, sphereId], [0, 0, 100]);
  check("move two bodies at once", ids(pair.changed) === `${boxId},${sphereId}`, ids(pair.changed));
  await native.undo();
  const badMove = await native.moveBodies([999999], [1, 0, 0]).then(() => null, (e: Error) => e);
  check("transform rejects an unknown id", badMove !== null, badMove?.message ?? "no error");

  // Clean up: undo everything this test did and put the selection back.
  for (let i = 0; i < 60 && (await native.state()).undoDepth > baseline.undoDepth; i++) {
    await native.undo();
  }
  await native.selectBodies(baseline.bodies.filter((b) => b.selected).map((b) => b.id));
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
