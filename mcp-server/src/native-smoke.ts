/**
 * Live smoke test for the native (CDP) write path. MUTATES the open document, so it only runs
 * in an "Untitled" document that is empty or holds just the default 1 m cube Plasticity starts
 * with. It undoes back to the baseline it found.
 *
 *   npm run smoke:native
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchPlasticity } from "./launcher.js";
import { BodyInfo, NativeSession, RegionInfo, Vec3, ViewName } from "./native.js";

const TOLERANCE_MM = 1e-3;

function check(label: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) process.exitCode = 1;
}

function boundsMatch(
  body: BodyInfo | undefined,
  min: Vec3,
  max: Vec3,
  tolerance = TOLERANCE_MM,
): boolean {
  if (!body?.boundsMm) return false;
  const near = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]!) < tolerance);
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

  try {
    await runChecks(native, target.title);
  } catch (err) {
    console.error("SMOKE ERROR:", (err as Error).message);
    process.exitCode = 1;
  }

  // Clean up, whatever happened above: undo everything this test did and put the selection back.
  for (let i = 0; i < 400 && (await native.state()).undoDepth > baseline.undoDepth; i++) {
    await native.undo();
  }
  await native.selectBodies(baseline.bodies.filter((b) => b.selected).map((b) => b.id));
  const final = await native.state();
  check("document is back to its baseline",
    final.bodies.map((b) => b.id).join(",") === baselineIds, `${final.bodies.length} bodies`);

  native.disconnect();
  console.log(process.exitCode ? "\nSMOKE FAILED" : "\nSMOKE PASSED");
}

async function runChecks(native: NativeSession, title: string): Promise<void> {
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

  // --- curves and profile extrusion (drawn around x = 400) ---
  const wire = (result: { created: BodyInfo[] }) => result.created.find((b) => b.type === "Wire");
  const failure = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);

  const rect = wire(await native.createPolyline(
    [[400, 0, 0], [440, 0, 0], [440, 30, 0], [400, 30, 0]], true, "mcp-smoke-rect"));
  check("closed polyline", rect?.name === "mcp-smoke-rect" &&
    boundsMatch(rect, [400, 0, 0], [440, 30, 0]), fmt(rect));
  const spline = wire(await native.createSpline([[400, 100, 0], [420, 110, 0], [440, 100, 0], [460, 110, 0]]));
  check("spline passes its end points",
    spline?.boundsMm?.min[0] === 400 && spline.boundsMm.max[0] === 460, fmt(spline));
  const tiltedCircle = wire(await native.createCircle([400, 200, 50], 10, [1, 0, 0]));
  check("circle with normal +X", boundsMatch(tiltedCircle, [400, 190, 40], [400, 210, 60]), fmt(tiltedCircle));
  const disc = wire(await native.createCircle([500, 0, 0], 10));
  check("circle", boundsMatch(disc, [490, -10, 0], [510, 10, 0]), fmt(disc));
  const corner = wire(await native.createPolyline([[400, 300, 0], [440, 300, 0], [440, 330, 0]]));
  check("open polyline", boundsMatch(corner, [400, 300, 0], [440, 330, 0]), fmt(corner));

  // Wires go through the scene and transform tools like any body.
  const movedWire = await native.moveBodies([corner!.id], [0, 0, 5]);
  check("move a curve", boundsMatch(changedBody(movedWire, corner!.id), [400, 300, 5], [440, 330, 5]));
  await native.undo();
  check("topology rejects a curve", (await failure(native.topology(corner!.id))) !== null);

  const prism = await native.extrudeProfile(rect!.id, 10);
  const prismBody = prism.created.find((b) => b.type === "Solid");
  check("closed profile becomes a Solid", prismBody?.faceCount === 6 &&
    boundsMatch(prismBody, [400, 0, 0], [440, 30, 10]), fmt(prismBody));
  check("the profile curve is kept", prism.removedIds.length === 0,
    JSON.stringify(prism.removedIds));
  await native.undo();
  const sunk = (await native.extrudeProfile(rect!.id, -10)).created.find((b) => b.type === "Solid");
  check("negative distance goes the other way", boundsMatch(sunk, [400, 0, -10], [440, 30, 0]), fmt(sunk));
  await native.undo();
  const rod = (await native.extrudeProfile(disc!.id, 20)).created.find((b) => b.type === "Solid");
  check("circle profile becomes a cylinder", rod?.faceCount === 3 &&
    boundsMatch(rod, [490, -10, 0], [510, 10, 20]), fmt(rod));
  await native.undo();

  const sideways = (await native.extrudeProfile(tiltedCircle!.id, 10)).created.find((b) => b.type === "Solid");
  check("direction follows the plane normal (+X circle)", boundsMatch(sideways, [400, 190, 40], [410, 210, 60]),
    fmt(sideways));
  await native.undo();
  const clockwise = wire(await native.createPolyline(
    [[400, 500, 0], [400, 530, 0], [440, 530, 0], [440, 500, 0]], true));
  const cwPrism = (await native.extrudeProfile(clockwise!.id, 10)).created.find((b) => b.type === "Solid");
  check("direction does not depend on winding", boundsMatch(cwPrism, [400, 500, 0], [440, 530, 10]), fmt(cwPrism));
  await native.undo();
  await native.undo(); // the clockwise rectangle

  const wallResult = await native.extrudeProfile(corner!.id, 10);
  const wall = wallResult.created.find((b) => b.type === "Sheet");
  check("open curve becomes a Sheet", wall?.faceCount === 2 &&
    boundsMatch(wall, [400, 300, 0], [440, 330, 10]), fmt(wall));
  const wallTopo = await native.topology(wall!.id);
  const sharedEdge = wallTopo.edges!.find((e) => e.faceIds.length === 2)!;
  const rounded = await native.filletEdges(wall!.id, [sharedEdge.id], 5);
  check("fillet on a Sheet", changedBody(rounded, wall!.id)?.faceCount === 3);
  await native.undo();
  const thick = await native.extrudeFaces(wall!.id, [wallTopo.faces![0]!.id], 3);
  check("extruding a Sheet face makes a new Solid",
    thick.created.length === 1 && thick.created[0]?.type === "Solid" && thick.changed.length === 0);
  await native.undo();
  const noWall = await native.deleteBodies([wall!.id]);
  check("delete a Sheet", noWall.removedIds[0] === wall!.id);
  await native.undo();
  await native.undo(); // the Sheet itself

  // Ambiguous and invalid profiles.
  const inner = wire(await native.createCircle([420, 15, 0], 5));
  const nested = await failure(native.extrudeProfile(rect!.id, 10));
  check("nested profile is refused", /ambiguous/.test(nested?.message ?? ""), nested?.message ?? "no error");
  const innerRod = (await native.extrudeProfile(inner!.id, 10)).created.find((b) => b.type === "Solid");
  check("the inner curve still extrudes", boundsMatch(innerRod, [415, 10, 0], [425, 20, 10]), fmt(innerRod));
  await native.undo();
  await native.undo(); // the inner circle
  const bent = wire(await native.createPolyline(
    [[400, 400, 0], [440, 400, 0], [440, 430, 20], [400, 430, 0]], true));
  const nonPlanar = await failure(native.extrudeProfile(bent!.id, 10));
  check("non-planar closed curve is refused", /not planar/.test(nonPlanar?.message ?? ""),
    nonPlanar?.message ?? "no error");
  const notACurve = await failure(native.extrudeProfile(boxId, 10));
  check("extrude_profile refuses a Solid", /not a curve/.test(notACurve?.message ?? ""));
  const noCurve = await native.deleteBodies([bent!.id]);
  check("delete a curve", noCurve.removedIds[0] === bent!.id);

  // --- revolve / sweep / loft (drawn at x >= 700, clear of the curves above) ---
  const made = (result: { created: BodyInfo[] }, type: string) =>
    result.created.find((b) => b.type === type);
  const LOFT_TOLERANCE_MM = 0.05; // bounds of lofted surfaces come out a few microns large

  const section = wire(await native.createPolyline(
    [[720, 0, 0], [730, 0, 0], [730, 0, 10], [720, 0, 10]], true))!; // in the XZ plane
  const ringSolid = made(await native.revolveProfile(section.id, [700, 0, 0], [0, 0, 1]), "Solid");
  check("revolve 360° makes a ring", ringSolid?.faceCount === 4 &&
    boundsMatch(ringSolid, [670, -30, 0], [730, 30, 10]), fmt(ringSolid));
  await native.undo();
  const quarter = made(await native.revolveProfile(section.id, [700, 0, 0], [0, 0, 1], 90), "Solid");
  check("revolve 90° follows the right-hand rule", quarter?.faceCount === 6 &&
    boundsMatch(quarter, [700, 0, 0], [730, 30, 10]), fmt(quarter));
  await native.undo();
  const slope = wire(await native.createPolyline([[720, 100, 0], [730, 100, 10]]))!;
  const cone = made(await native.revolveProfile(slope.id, [700, 100, 0], [0, 0, 1]), "Sheet");
  check("revolving an open curve makes a Sheet",
    boundsMatch(cone, [670, 70, 0], [730, 130, 10]), fmt(cone));
  await native.undo();
  const badAxis = await failure(native.revolveProfile(section.id, [725, 0, 0], [0, 0, 1]));
  check("axis through the profile is refused with a hint",
    /axis must lie in the plane/.test(badAxis?.message ?? ""), badAxis?.message ?? "no error");

  const tubeProfile = wire(await native.createCircle([700, 200, 0], 5, [1, 0, 0]))!;
  const straightPath = wire(await native.createPolyline([[700, 200, 0], [800, 200, 0]]))!;
  const elbowPath = wire(await native.createPolyline([[700, 200, 0], [800, 200, 0], [800, 280, 0]]))!;
  const rod2 = made(await native.sweepProfile(tubeProfile.id, straightPath.id), "Solid");
  check("sweep a circle along a line", rod2?.faceCount === 3 &&
    boundsMatch(rod2, [700, 195, -5], [800, 205, 5]), fmt(rod2));
  await native.undo();
  const elbow = made(await native.sweepProfile(tubeProfile.id, elbowPath.id), "Solid");
  check("sweep around a corner", elbow?.faceCount === 4 && elbow.boundsMm?.max[1] === 280 &&
    (elbow.boundsMm?.max[0] ?? 0) > 804, fmt(elbow));
  await native.undo();
  const flared = made(await native.sweepProfile(tubeProfile.id, straightPath.id, 0, 2), "Solid");
  check("sweep with scale 2 doubles the far end",
    boundsMatch(flared, [700, 190, -10], [800, 210, 10]), fmt(flared));
  await native.undo();
  const squareProfile = wire(await native.createPolyline(
    [[700, 295, -5], [700, 305, -5], [700, 305, 5], [700, 295, 5]], true))!;
  const squarePath = wire(await native.createPolyline([[700, 300, 0], [800, 300, 0]]))!;
  const twisted = made(await native.sweepProfile(squareProfile.id, squarePath.id, 45), "Solid");
  const halfDiagonal = 5 * Math.SQRT2;
  check("sweep with twist 45°", boundsMatch(twisted,
    [700, 300 - halfDiagonal, -halfDiagonal], [800, 300 + halfDiagonal, halfDiagonal]), fmt(twisted));
  await native.undo();
  const ringPath = wire(await native.createCircle([700, 400, 0], 30))!;
  const ringProfile = wire(await native.createCircle([730, 400, 0], 5, [0, 1, 0]))!;
  const torus = made(await native.sweepProfile(ringProfile.id, ringPath.id), "Solid");
  check("sweep along a closed path makes a torus",
    boundsMatch(torus, [665, 365, -5], [735, 435, 5], LOFT_TOLERANCE_MM), fmt(torus));
  await native.undo();
  const samePath = await failure(native.sweepProfile(tubeProfile.id, tubeProfile.id));
  check("sweep refuses path = profile", /different curve/.test(samePath?.message ?? ""));
  const solidPath = await failure(native.sweepProfile(tubeProfile.id, boxId));
  check("sweep refuses a Solid as path", /not a curve/.test(solidPath?.message ?? ""));

  const loftBase = wire(await native.createPolyline(
    [[680, 580, 0], [720, 580, 0], [720, 620, 0], [680, 620, 0]], true))!;
  const loftTop = wire(await native.createCircle([700, 600, 50], 10))!;
  const funnel = made(await native.loftProfiles([loftBase.id, loftTop.id]), "Solid");
  check("loft square to circle", boundsMatch(funnel, [680, 580, 0], [720, 620, 50], LOFT_TOLERANCE_MM),
    fmt(funnel));
  await native.undo();
  const loftLid = wire(await native.createPolyline(
    [[680, 580, 80], [720, 580, 80], [720, 620, 80], [680, 620, 80]], true))!;
  const bulge = wire(await native.createSpline([[720, 620, 0], [735, 635, 40], [720, 620, 80]]))!;
  const guided = made(await native.loftProfiles([loftBase.id, loftLid.id], [bulge.id]), "Solid");
  check("loft follows a guide curve", (guided?.boundsMm?.max[0] ?? 0) > 734 &&
    (guided?.boundsMm?.min[0] ?? 0) > 679.9, fmt(guided));
  await native.undo();
  const posts: number[] = [];
  for (const degrees of [0, 120, 240]) {
    const t = (degrees * Math.PI) / 180;
    const x = 700 + 30 * Math.cos(t);
    const y = 800 + 30 * Math.sin(t);
    posts.push(wire(await native.createPolyline([[x, y, 0], [x, y, 40]]))!.id);
  }
  const fence = made(await native.loftProfiles(posts.slice(0, 2)), "Sheet");
  check("loft of open curves makes a Sheet", fence?.faceCount === 1, fmt(fence));
  await native.undo();
  const drum = made(await native.loftProfiles(posts, [], true), "Sheet");
  check("closed loft of open curves wraps around",
    (drum?.boundsMm?.min[1] ?? 0) < 771 && (drum?.boundsMm?.max[1] ?? 0) > 829, fmt(drum));
  await native.undo();
  const mixed = await failure(native.loftProfiles([loftBase.id, posts[0]!]));
  check("loft refuses mixed closed and open profiles", /all closed .* or all open/.test(mixed?.message ?? ""));
  const single = await failure(native.loftProfiles([loftBase.id]));
  check("loft refuses a single profile", /at least two/.test(single?.message ?? ""));

  // --- arcs, ellipse, join, regions (drawn at y >= 1000, clear of everything above) ---
  const REGION_TOLERANCE_MM = 0.05; // region bounds come from the display mesh
  const regionAt = (regions: RegionInfo[], min: Vec3, max: Vec3) =>
    regions.find((r) =>
      r.boundsMm.min.every((v, i) => Math.abs(v - min[i]!) < REGION_TOLERANCE_MM) &&
      r.boundsMm.max.every((v, i) => Math.abs(v - max[i]!) < REGION_TOLERANCE_MM));

  const quarterArc = wire(await native.createArcCenter([0, 1000, 0], [10, 1000, 0], 90));
  check("arc +90° turns counter-clockwise", boundsMatch(quarterArc, [0, 1000, 0], [10, 1010, 0]), fmt(quarterArc));
  const backArc = wire(await native.createArcCenter([0, 1000, 0], [10, 1000, 0], -90));
  check("arc -90° turns clockwise", boundsMatch(backArc, [0, 990, 0], [10, 1000, 0]), fmt(backArc));
  const wideArc = wire(await native.createArcCenter([0, 1000, 0], [10, 1000, 0], 270));
  check("arc 270°", boundsMatch(wideArc, [-10, 990, 0], [10, 1010, 0]), fmt(wideArc));
  const uprightArc = wire(await native.createArcCenter([0, 1000, 0], [0, 1010, 0], 90, [1, 0, 0]));
  check("arc about the X axis", boundsMatch(uprightArc, [0, 1000, 0], [0, 1010, 10]), fmt(uprightArc));
  const threePoint = wire(await native.createArc([10, 1000, 0], [-10, 1000, 0], [0, 990, 0]));
  check("three-point arc takes the long way through its middle point",
    boundsMatch(threePoint, [-10, 990, 0], [10, 1010, 0]), fmt(threePoint));
  const collinear = await failure(native.createArc([0, 1000, 0], [5, 1000, 0], [10, 1000, 0]));
  check("collinear arc points are refused", /collinear/.test(collinear?.message ?? ""));
  const offPlane = await failure(native.createArcCenter([0, 1000, 0], [10, 1000, 5], 90));
  check("arc start off the plane is refused", /must lie in the plane/.test(offPlane?.message ?? ""));
  for (let i = 0; i < 5; i++) await native.undo(); // the five arcs

  const oval = wire(await native.createEllipse([0, 1100, 0], 20, 10));
  check("ellipse, major axis along X", boundsMatch(oval, [-20, 1090, 0], [20, 1110, 0]), fmt(oval));
  await native.undo();
  const tallOval = wire(await native.createEllipse([0, 1100, 0], 20, 10, [0, 0, 1], [0, 1, 0]));
  check("ellipse, major axis along Y", boundsMatch(tallOval, [-10, 1080, 0], [10, 1120, 0]), fmt(tallOval));
  await native.undo();

  // A slot drawn as two lines and two arcs: no single curve, but one region.
  const slotTop = wire(await native.createPolyline([[0, 1210, 0], [40, 1210, 0]]))!;
  const slotBottom = wire(await native.createPolyline([[40, 1190, 0], [0, 1190, 0]]))!;
  const slotRight = wire(await native.createArcCenter([40, 1200, 0], [40, 1190, 0], 180))!;
  const slotLeft = wire(await native.createArcCenter([0, 1200, 0], [0, 1210, 0], 180))!;
  const slotRegion = regionAt(await native.listRegions(), [-10, 1190, 0], [50, 1210, 0]);
  check("four curves form one region", slotRegion?.edgeCount === 4 && slotRegion.holes === 0 &&
    Math.abs((slotRegion.boundaryLengthMm ?? 0) - (80 + 20 * Math.PI)) < 1e-3, JSON.stringify(slotRegion));
  const slotSolid = made(await native.extrudeProfile([slotRegion!.id], 5), "Solid");
  check("extrude a region", slotSolid?.faceCount === 6 &&
    boundsMatch(slotSolid, [-10, 1190, 0], [50, 1210, 5]), fmt(slotSolid));
  await native.undo();
  const joinedSlot = await native.joinCurves([slotTop.id, slotRight.id, slotBottom.id, slotLeft.id]);
  check("join keeps the first curve and removes the rest",
    joinedSlot.changed[0]?.id === slotTop.id && joinedSlot.removedIds.length === 3 &&
      boundsMatch(joinedSlot.changed[0], [-10, 1190, 0], [50, 1210, 0]), fmt(joinedSlot.changed[0]));
  const joinedSolid = made(await native.extrudeProfile(slotTop.id, 5), "Solid");
  check("the joined curve is a profile of its own", joinedSolid?.faceCount === 6, fmt(joinedSolid));
  await native.undo();
  const staleRegion = await failure(native.extrudeProfile([slotRegion!.id], 5));
  check("stale region ids are rejected", /Stale or unknown region/.test(staleRegion?.message ?? ""),
    staleRegion?.message ?? "no error");

  // A plate with a hole: the nested circle splits the rectangle into a ring and a disc.
  const holed = wire(await native.createPolyline(
    [[100, 1280, 0], [160, 1280, 0], [160, 1320, 0], [100, 1320, 0]], true))!;
  await native.createCircle([130, 1300, 0], 8);
  const plateRegions = await native.listRegions();
  const ringRegion = regionAt(plateRegions, [100, 1280, 0], [160, 1320, 0]);
  const discRegion = regionAt(plateRegions, [122, 1292, 0], [138, 1308, 0]);
  check("ring and disc regions", ringRegion?.holes === 1 && discRegion?.holes === 0,
    JSON.stringify({ ring: ringRegion?.holes, disc: discRegion?.holes }));
  const stillAmbiguous = await failure(native.extrudeProfile(holed.id, 10));
  check("the rectangle curve itself is still ambiguous", /ambiguous/.test(stillAmbiguous?.message ?? ""));
  const holedPlate = made(await native.extrudeProfile([ringRegion!.id], 10), "Solid");
  check("extruding the ring gives a plate with a hole", holedPlate?.faceCount === 7 &&
    boundsMatch(holedPlate, [100, 1280, 0], [160, 1320, 10]), fmt(holedPlate));
  await native.undo();
  const fullPlate = made(await native.extrudeProfile([ringRegion!.id, discRegion!.id], 10), "Solid");
  check("ring and disc together give a full plate", fullPlate?.faceCount === 6, fmt(fullPlate));
  await native.undo();
  const arch = made(await native.revolveProfile([ringRegion!.id], [0, 1250, 0], [1, 0, 0], 90), "Solid");
  check("revolve a region", boundsMatch(arch, [100, 1250, 0], [160, 1320, 70]), fmt(arch));
  await native.undo();
  await native.createCircle([130, 1300, 50], 15);
  const upperRegion = regionAt(await native.listRegions(), [115, 1285, 50], [145, 1315, 50]);
  const cup = made(await native.loftProfiles([discRegion!.id, upperRegion!.id]), "Solid");
  check("loft through regions", boundsMatch(cup, [115, 1285, 0], [145, 1315, 50], LOFT_TOLERANCE_MM), fmt(cup));
  await native.undo();

  // A sweep path of a line and an arc has to be joined into one curve first.
  const leg = wire(await native.createPolyline([[300, 1000, 0], [300, 1000, 40]]))!;
  const bend = wire(await native.createArcCenter([320, 1000, 40], [300, 1000, 40], 90, [0, 1, 0]))!;
  const hook = (await native.joinCurves([leg.id, bend.id])).changed[0];
  check("join a line and an arc", hook?.id === leg.id &&
    boundsMatch(hook, [300, 1000, 0], [320, 1000, 60]), fmt(hook));
  const hookProfile = wire(await native.createCircle([300, 1000, 0], 4))!;
  const bentPipe = made(await native.sweepProfile(hookProfile.id, leg.id), "Solid");
  check("sweep along the joined path", bentPipe?.faceCount === 4 &&
    boundsMatch(bentPipe, [296, 996, 0], [320, 1004, 64]), fmt(bentPipe));
  await native.undo();
  const apart = await failure(native.joinCurves([hookProfile.id, slotTop.id]));
  check("joining curves that do not touch is refused with a hint",
    /must touch end to end/.test(apart?.message ?? ""), apart?.message ?? "no error");
  const lonely = await failure(native.joinCurves([leg.id]));
  check("joining needs two curves", /at least two/.test(lonely?.message ?? ""));

  // --- files, camera, screenshot (temporary folder, removed afterwards) ---
  const folder = mkdtempSync(join(tmpdir(), "plasticity-mcp-smoke-"));
  try {
    const stepPath = join(folder, "plate.step");
    const exported = await native.exportStep(stepPath, [plateId]);
    check("export STEP", exported.bytes > 0 &&
      readFileSync(stepPath, "utf8").startsWith("ISO-10303-21;"), `${exported.bytes} bytes`);
    const again = await failure(native.exportStep(stepPath, [plateId]));
    check("export refuses to overwrite", /already exists/.test(again?.message ?? ""));
    check("export overwrites on request", (await native.exportStep(stepPath, [plateId], true)).bytes > 0);
    const relative = await failure(native.exportStep("plate.step"));
    check("relative path is refused", /absolute/.test(relative?.message ?? ""));
    const wrongType = await failure(native.exportStep(join(folder, "plate.txt")));
    check("wrong extension is refused", /must end in/.test(wrongType?.message ?? ""));

    const imported = await native.importStep(stepPath);
    check("import STEP brings the plate back", imported.created.length === 1 &&
      imported.created[0]?.faceCount === 6 &&
      boundsMatch(imported.created[0], [200, 0, 0], [240, 30, 10]), fmt(imported.created[0]));
    await native.undo();
    const missing = await failure(native.importStep(join(folder, "nothing.step")));
    check("import of a missing file is refused", /not found/.test(missing?.message ?? ""));

    const before = await native.state();
    const saved = await native.saveCopy(join(folder, "copy.plasticity"));
    check("save a copy", saved.bytes > 0 &&
      readFileSync(saved.path).subarray(0, 10).toString() === "plasticity", `${saved.bytes} bytes`);
    check("saving leaves the document untouched",
      (await native.state()).undoDepth === before.undoDepth && native.getTarget()?.title === title);

    if ((await native.state()).windowHidden) {
      const blocked = await failure(native.setView("top"));
      check("set_view reports a covered window", /covered or minimized/.test(blocked?.message ?? ""));
      const noShot = await failure(native.screenshot());
      check("screenshot reports a covered window", /covered or minimized/.test(noShot?.message ?? ""));
      console.log(" skip  views and screenshot — the Plasticity window is covered or minimized");
      return;
    }

    const expected: Array<[ViewName, Vec3]> = [
      ["front", [0, -1, 0]], ["back", [0, 1, 0]], ["left", [-1, 0, 0]], ["right", [1, 0, 0]],
      ["top", [0, 0, 1]], ["bottom", [0, 0, -1]],
    ];
    for (const [view, direction] of expected) {
      const camera = await native.setView(view);
      check(`view ${view}`, camera.aligned &&
        camera.direction.every((v, i) => Math.abs(v - direction[i]!) < 1e-6), JSON.stringify(camera.direction));
    }
    const iso = await native.setView("isometric");
    check("view isometric", !iso.aligned &&
      iso.direction.every((v, i) => Math.abs(v - [1, -1, 1][i]! / Math.sqrt(3)) < 1e-6),
      JSON.stringify(iso.direction));

    const pngPath = join(folder, "view.png");
    const shot = await native.screenshot(pngPath);
    check("screenshot", Math.max(shot.width, shot.height) <= 1568 && shot.width > 100 &&
      readFileSync(pngPath).length === shot.png.length, `${shot.width} x ${shot.height}`);
    if (process.env.SMOKE_KEEP_SCREENSHOT) copyFileSync(pngPath, process.env.SMOKE_KEEP_SCREENSHOT);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("SMOKE ERROR:", (err as Error).message);
  process.exit(1);
});
