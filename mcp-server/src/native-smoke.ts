/**
 * Live smoke test for the native (CDP) write path. MUTATES the open document, so it only runs
 * in an "Untitled" document that is empty or holds just the default 1 m cube Plasticity starts
 * with. It undoes back to the baseline it found.
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
  // An Untitled document can hold real unsaved work (Plasticity restores it from its backup
  // on start), so "untitled with no history" is not enough: it must be empty or hold only the
  // default 1 m cube.
  const onlyDefaultCube = baseline.bodies.length === 1 &&
    boundsMatch(baseline.bodies[0], [-500, -500, 0], [500, 500, 1000]);
  if (!target.title.startsWith("Untitled") || !(baseline.bodies.length === 0 || onlyDefaultCube)) {
    throw new Error(
      `Refusing to run in "${target.title}" (${baseline.bodies.length} bodies). ` +
        `Use an Untitled document that is empty or holds only the default cube.`,
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

  // --- topology / boolean / fillet / chamfer / extrude (plate [0,0,0]..[40,30,10]) ---
  const plateId = (await native.createBox([200, 0, 0], [40, 30, 10])).created[0]!.id;
  const drillId = (await native.createCylinder([220, 15, -5], 5, 20)).created[0]!.id;
  const changedBody = (result: { changed: BodyInfo[] }, id: number) =>
    result.changed.find((b) => b.id === id);

  const topo = await native.topology(plateId);
  check("topology of a box", topo.faces?.length === 6 && topo.edges?.length === 12);
  const topFace = topo.faces!.find((f) => f.normal[2] > 0.9)!;
  check("top face", topFace.surface === "Plane" && topFace.centerMm[2] === 10 &&
    topFace.edgeIds.length === 4, JSON.stringify(topFace.centerMm));
  const verticalEdges = topo.edges!.filter((e) => Math.abs(e.startMm[2] - e.endMm[2]) > 1);
  check("four vertical edges of length 10",
    verticalEdges.length === 4 && verticalEdges.every((e) => e.kind === "line" && e.lengthMm === 10));
  const drillTopo = await native.topology(drillId, "faces");
  check("cylinder topology", drillTopo.edges === undefined &&
    drillTopo.faces?.some((f) => f.surface === "Cylinder" && f.radiusMm === 5) === true);
  const wireless = await native.topology(999999).then(() => null, (e: Error) => e);
  check("topology rejects an unknown id", wireless !== null);

  const cut = await native.boolean("difference", [plateId], [drillId]);
  check("difference drills a hole", changedBody(cut, plateId)?.faceCount === 7 &&
    boundsMatch(changedBody(cut, plateId), [200, 0, 0], [240, 30, 10]) &&
    cut.removedIds[0] === drillId, fmt(changedBody(cut, plateId)));
  await native.undo();
  const kept = await native.boolean("difference", [plateId], [drillId], true);
  check("keepTools keeps the tool", kept.removedIds.length === 0 &&
    changedBody(kept, plateId)?.faceCount === 7);
  await native.undo();
  const fused = await native.boolean("union", [plateId], [drillId]);
  check("union", boundsMatch(changedBody(fused, plateId), [200, 0, -5], [240, 30, 15]),
    fmt(changedBody(fused, plateId)));
  await native.undo();
  const common = await native.boolean("intersection", [plateId], [drillId]);
  check("intersection", boundsMatch(changedBody(common, plateId), [215, 10, 0], [225, 20, 10]),
    fmt(changedBody(common, plateId)));
  await native.undo();
  // Two targets, two tools: a second plate next to the first, each drilled by its own cylinder.
  const plate2Id = (await native.createBox([250, 0, 0], [40, 30, 10])).created[0]!.id;
  const drill2Id = (await native.createCylinder([270, 15, -5], 5, 20)).created[0]!.id;
  const multi = await native.boolean("difference", [plateId, plate2Id], [drillId, drill2Id]);
  check("boolean with two targets and two tools",
    changedBody(multi, plateId)?.faceCount === 7 && changedBody(multi, plate2Id)?.faceCount === 7 &&
      multi.removedIds.length === 2 && multi.created.length === 0,
    JSON.stringify({ changed: ids(multi.changed), removed: multi.removedIds }));
  await native.undo();
  await native.deleteBodies([plate2Id, drill2Id]);

  const selfBoolean = await native.boolean("union", [plateId], [plateId]).then(() => null, (e: Error) => e);
  check("boolean rejects target = tool", selfBoolean !== null);

  const edgeIds = verticalEdges.map((e) => e.id);
  const filleted = await native.filletEdges(plateId, edgeIds, 2);
  check("fillet adds four faces, bounds unchanged", changedBody(filleted, plateId)?.faceCount === 10 &&
    boundsMatch(changedBody(filleted, plateId), [200, 0, 0], [240, 30, 10]));
  const roundFaces = (await native.topology(plateId, "faces")).faces!.filter((f) => f.radiusMm === 2);
  check("fillet faces are cylinders of radius 2", roundFaces.length === 4);
  const stale = await native.filletEdges(plateId, edgeIds, 1).then(() => null, (e: Error) => e);
  check("stale edge ids are rejected", /Stale or unknown edge/.test(stale?.message ?? ""),
    stale?.message ?? "no error");
  await native.undo();

  const chamfered = await native.chamferEdges(plateId, edgeIds, 2);
  const bevels = (await native.topology(plateId, "faces")).faces!;
  check("chamfer adds four planar faces", changedBody(chamfered, plateId)?.faceCount === 10 &&
    bevels.every((f) => f.planar));
  await native.undo();

  const pulled = await native.extrudeFaces(plateId, [topFace.id], 5);
  check("extrude +5 raises the top", pulled.created.length === 0 &&
    boundsMatch(changedBody(pulled, plateId), [200, 0, 0], [240, 30, 15]), fmt(changedBody(pulled, plateId)));
  await native.undo();
  const pushed = await native.extrudeFaces(plateId, [topFace.id], -4);
  check("extrude -4 lowers the top",
    boundsMatch(changedBody(pushed, plateId), [200, 0, 0], [240, 30, 6]), fmt(changedBody(pushed, plateId)));
  await native.undo();

  // Clean up: undo everything this test did and put the selection back.
  for (let i = 0; i < 100 && (await native.state()).undoDepth > baseline.undoDepth; i++) {
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
