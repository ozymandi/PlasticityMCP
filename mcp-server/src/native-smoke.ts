/**
 * Live smoke test for the native (CDP) write path. MUTATES the open document, so it only runs
 * in an "Untitled" document that is empty or holds just the default 1 m cube Plasticity starts
 * with. It undoes back to the baseline it found.
 *
 *   npm run smoke:native
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchPlasticity } from "./launcher.js";
import {
  BodyInfo,
  BodyTopology,
  MutationResult,
  NativeSession,
  RegionInfo,
  Vec3,
  ViewName,
} from "./native.js";

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
  const baselineReferences = (await native.listReferenceMeshes()).length;

  try {
    await runChecks(native, target.title);
    await solidChecks(native);
    await faceChecks(native);
    await curveChecks(native);
    await curveEditChecks(native);
    await projectionChecks(native);
    await surfaceChecks(native);
    await instanceChecks(native);
    await sceneChecks(native);
    await measureChecks(native);
  } catch (err) {
    console.error("SMOKE ERROR:", (err as Error).message);
    process.exitCode = 1;
  }

  // Clean up, whatever happened above: undo everything this test did and put the selection back.
  for (let i = 0; i < 500 && (await native.state()).undoDepth > baseline.undoDepth; i++) {
    await native.undo();
  }
  await native.selectBodies(baseline.bodies.filter((b) => b.selected).map((b) => b.id));
  const final = await native.state();
  check("document is back to its baseline",
    final.bodies.map((b) => b.id).join(",") === baselineIds &&
      (await native.listReferenceMeshes()).length === baselineReferences,
    `${final.bodies.length} bodies`);

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
  const cornerTopo = await native.topology(corner!.id);
  check("topology of a curve: segments and vertices", cornerTopo.closed === false &&
    cornerTopo.segments?.length === 2 && cornerTopo.vertices?.length === 3 &&
    cornerTopo.segments.every((s) => s.kind === "line") &&
    cornerTopo.segments.map((s) => s.lengthMm).sort((a, b) => a - b).join() === "30,40" &&
    cornerTopo.vertices.some((v) => v.positionMm.join() === "440,300,0"),
    JSON.stringify({ lengths: cornerTopo.segments?.map((s) => s.lengthMm), vertices: cornerTopo.vertices?.map((v) => v.positionMm) }));
  const splineTopo = await native.topology(spline!.id);
  check("topology of a spline has control points", (splineTopo.controlPoints?.length ?? 0) > 0 &&
    splineTopo.segments?.[0]?.kind === "curve", JSON.stringify(splineTopo.controlPoints?.length));
  const discTopo = await native.topology(disc!.id);
  check("topology of a circle: closed, one segment, no vertices", discTopo.closed === true &&
    discTopo.segments?.length === 1 && discTopo.segments[0]?.kind === "circle" &&
    discTopo.vertices?.length === 0, JSON.stringify(discTopo.segments?.[0]));

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
  const joinedSlot = await native.join([slotTop.id, slotRight.id, slotBottom.id, slotLeft.id]);
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
  const hook = (await native.join([leg.id, bend.id])).changed[0];
  check("join a line and an arc", hook?.id === leg.id &&
    boundsMatch(hook, [300, 1000, 0], [320, 1000, 60]), fmt(hook));
  const hookProfile = wire(await native.createCircle([300, 1000, 0], 4))!;
  const bentPipe = made(await native.sweepProfile(hookProfile.id, leg.id), "Solid");
  check("sweep along the joined path", bentPipe?.faceCount === 4 &&
    boundsMatch(bentPipe, [296, 996, 0], [320, 1004, 64]), fmt(bentPipe));
  await native.undo();
  const apart = await failure(native.join([hookProfile.id, slotTop.id]));
  check("joining curves that do not touch is refused with a hint",
    /must touch end to end/.test(apart?.message ?? ""), apart?.message ?? "no error");
  const lonely = await failure(native.join([leg.id]));
  check("joining needs two curves", /at least two/.test(lonely?.message ?? ""));

  // --- copy, mirror, arrays (an L-shaped body at x >= 2000, so reflections are visible) ---
  const elbowBody = (await native.createBox([2000, 0, 0], [40, 20, 10])).created[0]!.id;
  const tabBody = (await native.createBox([2000, 0, 10], [10, 20, 15])).created[0]!.id;
  await native.boolean("union", [elbowBody], [tabBody]);
  const topFaceX = async (id: number) =>
    (await native.topology(id, "faces")).faces!.find((f) => f.centerMm[2] > 24)?.centerMm[0];
  const pathCurve = wire(await native.createPolyline([[2000, 100, 0], [2030, 100, 0], [2030, 120, 0]]))!;

  const copyDepth = (await native.state()).undoDepth;
  const copies = await native.copyBodies([elbowBody, pathCurve.id], [100, 0, 0]);
  check("copy a solid and a curve with a shift", copies.created.length === 2 &&
    boundsMatch(made(copies, "Solid"), [2100, 0, 0], [2140, 20, 25]) &&
    boundsMatch(made(copies, "Wire"), [2100, 100, 0], [2130, 120, 0]) &&
    copies.changed.length === 0, fmt(made(copies, "Solid")));
  check("a copy is one undo step", copies.undoDepth === copyDepth + 1);
  check("the copy keeps the shape", (await topFaceX(made(copies, "Solid")!.id)) === 2105);
  await native.undo();
  const inPlace = await native.copyBodies([elbowBody]);
  check("copy without a shift sits on the original",
    boundsMatch(inPlace.created[0], [2000, 0, 0], [2040, 20, 25]), fmt(inPlace.created[0]));
  await native.undo();

  const reflected = await native.mirrorBodies([elbowBody, pathCurve.id], [1990, 0, 0], [1, 0, 0]);
  check("mirror makes reflected copies", reflected.created.length === 2 &&
    boundsMatch(made(reflected, "Solid"), [1940, 0, 0], [1980, 20, 25]) &&
    boundsMatch(made(reflected, "Wire"), [1950, 100, 0], [1980, 120, 0]) &&
    reflected.removedIds.length === 0, fmt(made(reflected, "Solid")));
  check("the mirror is a true reflection", (await topFaceX(made(reflected, "Solid")!.id)) === 1975);
  await native.undo();
  const flipDepth = (await native.state()).undoDepth;
  const flipped = await native.mirrorBodies([elbowBody], [1990, 0, 0], [1, 0, 0], false);
  check("mirror without the original", flipped.created.length === 1 &&
    flipped.removedIds[0] === elbowBody && flipped.undoDepth === flipDepth + 2,
    JSON.stringify({ created: ids(flipped.created), removed: flipped.removedIds }));
  await native.undo();
  await native.undo();
  await native.redo();
  await native.redo();
  check("redo after that mirror works", ids((await native.state()).bodies).includes(String(flipped.created[0]!.id)));
  await native.undo();
  await native.undo();
  check("and undo brings the original back",
    (await native.state()).bodies.some((b) => b.id === elbowBody));

  const row = await native.arrayRectangular([elbowBody], [1, 0, 0], 3, 60);
  check("row of three adds two copies", row.created.length === 2 &&
    row.created.some((b) => boundsMatch(b, [2120, 0, 0], [2160, 20, 25])), ids(row.created));
  await native.undo();
  const grid = await native.arrayRectangular([elbowBody], [1, 0, 0], 3, 60, [0, 1, 0], 2, 40);
  check("3 x 2 grid adds five copies", grid.created.length === 5 &&
    grid.created.some((b) => boundsMatch(b, [2120, 40, 0], [2160, 60, 25])), ids(grid.created));
  await native.undo();
  const lonelyArray = await failure(native.arrayRectangular([elbowBody], [1, 0, 0], 1, 60));
  check("an array of one is refused", /at least two items/.test(lonelyArray?.message ?? ""));
  const parallel = await failure(native.arrayRectangular([elbowBody], [1, 0, 0], 2, 60, [2, 0, 0], 2, 40));
  check("parallel array directions are refused", /must not be parallel/.test(parallel?.message ?? ""));

  const pinBody = (await native.createCylinder([2030, 300, 0], 3, 10)).created[0]!.id;
  const circleOfPins = await native.arrayRadial([pinBody], [2000, 300, 0], [0, 0, 1], 6);
  check("radial array of six adds five copies", circleOfPins.created.length === 5 &&
    circleOfPins.created.some((b) => boundsMatch(b, [1967, 297, 0], [1973, 303, 10])),
    ids(circleOfPins.created));
  await native.undo();
  const fan = await native.arrayRadial([pinBody], [2000, 300, 0], [0, 0, 1], 3, 90);
  check("radial array over 90° ends at 90°", fan.created.length === 2 &&
    fan.created.some((b) => boundsMatch(b, [1997, 327, 0], [2003, 333, 10])), ids(fan.created));
  await native.undo();

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

    // Mesh and Parasolid export of the plate (40 x 30 x 10 at x = 200) and the sphere.
    const stlPath = join(folder, "plate.stl");
    const stl = await native.exportMesh(stlPath, [plateId]);
    const stlData = readFileSync(stlPath);
    let stlMax = -Infinity;
    for (let t = 0; t < 12; t++) {
      for (let v = 0; v < 3; v++) stlMax = Math.max(stlMax, stlData.readFloatLE(84 + t * 50 + 12 + v * 12));
    }
    check("STL of a box has 12 triangles", stl.triangles === 12 && stl.bytes === 84 + 12 * 50, `${stl.triangles}`);
    check("STL is written in millimetres", Math.abs(stlMax - 240) < 1e-3, `max x ${stlMax}`);
    const coarse = await native.exportMesh(join(folder, "ball-coarse.stl"), [sphereId], 0.5, 30);
    const fine = await native.exportMesh(join(folder, "ball-fine.stl"), [sphereId], 0.01, 5);
    check("a finer tolerance gives more triangles", (fine.triangles ?? 0) > (coarse.triangles ?? Infinity),
      `${coarse.triangles} -> ${fine.triangles}`);
    const objPath = join(folder, "plate.obj");
    const obj = await native.exportMesh(objPath, [plateId]);
    const objVertices = readFileSync(objPath, "utf8").split(/\r?\n/).filter((line) => line.startsWith("v "));
    check("OBJ of a box", obj.triangles === 12 && objVertices.length === 8 &&
      objVertices.some((line) => line === "v 240 30 10"), `${objVertices.length} vertices`);
    const threeMf = await native.exportMesh(join(folder, "plate.3mf"), [plateId]);
    check("3MF archive", threeMf.format === "3mf" && threeMf.bytes > 500 && threeMf.triangles === undefined,
      `${threeMf.bytes} bytes`);
    const meshOfCurve = await failure(native.exportMesh(join(folder, "curve.stl"), [rect!.id]));
    check("a curve cannot be meshed", /has no surface to mesh/.test(meshOfCurve?.message ?? ""));
    const meshAgain = await failure(native.exportMesh(stlPath, [plateId]));
    check("mesh export refuses to overwrite", /already exists/.test(meshAgain?.message ?? ""));
    const unknownMesh = await failure(native.exportMesh(join(folder, "plate.ply"), [plateId]));
    check("unknown mesh format is refused", /must end in/.test(unknownMesh?.message ?? ""));

    for (const name of ["plate.x_t", "plate.x_b"]) {
      const parasolid = await native.exportParasolid(join(folder, name), [plateId]);
      check(`Parasolid ${name}`, parasolid.bytes > 1000 &&
        readFileSync(parasolid.path).subarray(0, 12).toString("latin1") === "**ABCDEFGHIJ", `${parasolid.bytes} bytes`);
    }

    // Drawing of the L-shaped body: front 40 x 25, top 40 x 20, right 20 x 25.
    const svgPath = join(folder, "elbow.svg");
    const drawing = await native.exportDrawing(svgPath, [elbowBody], ["front", "top", "right", "isometric"]);
    const sizeOf = (view: string) => drawing.views.find((v) => v.view === view)?.sizeMm.join(" x ");
    check("drawing views have the true sizes", sizeOf("front") === "40 x 25" &&
      sizeOf("top") === "40 x 20" && sizeOf("right") === "20 x 25",
      drawing.views.map((v) => `${v.view} ${v.sizeMm.join(" x ")}`).join(", "));
    const svgText = readFileSync(svgPath, "utf8");
    check("drawing is an SVG in millimetres", svgText.includes(`width="${drawing.widthMm}mm"`) &&
      svgText.includes('id="view-isometric"') && drawing.views.every((v) => v.visibleLines > 0));
    const frontHidden = drawing.views.find((v) => v.view === "front")!.hiddenLines;
    const visibleOnly = await native.exportDrawing(join(folder, "visible.svg"), [elbowBody], ["front"], false);
    check("hidden lines can be left out", frontHidden > 0 && visibleOnly.views[0]?.hiddenLines === 0,
      `${frontHidden} -> ${visibleOnly.views[0]?.hiddenLines}`);
    const holedDrawing = await native.exportDrawing(join(folder, "plate.svg"), [plateId], ["top"]);
    check("drawing of the plain plate, top view", holedDrawing.views[0]?.sizeMm.join(" x ") === "40 x 30");
    const drawCurve = await failure(native.exportDrawing(join(folder, "curve.svg"), [rect!.id]));
    check("only Solids can be drawn", /only Solids can be drawn/.test(drawCurve?.message ?? ""));

    // Imports: Parasolid and meshes round-trip the files written above; SVG is hand-written.
    const fromParasolid = await native.importParasolid(join(folder, "plate.x_t"));
    check("import Parasolid brings the plate back", fromParasolid.created.length === 1 &&
      fromParasolid.created[0]?.faceCount === 6 &&
      boundsMatch(fromParasolid.created[0], [200, 0, 0], [240, 30, 10]), fmt(fromParasolid.created[0]));
    await native.undo();

    const shapesPath = join(folder, "shapes.svg");
    writeFileSync(shapesPath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">
  <rect x="10" y="10" width="40" height="30" fill="none" stroke="black"/>
  <circle cx="75" cy="25" r="10" fill="none" stroke="black"/>
</svg>`);
    const shapes = await native.importSvg(shapesPath);
    const svgRect = shapes.created.find((b) => boundsMatch(b, [10, -40, 0], [50, -10, 0]));
    const svgCircle = shapes.created.find((b) => boundsMatch(b, [65, -35, 0], [85, -15, 0]));
    check("import SVG: curves in millimetres, y flipped", shapes.created.length === 2 &&
      svgRect?.type === "Wire" && svgCircle?.type === "Wire",
      shapes.created.map((b) => fmt(b)).join(" "));
    const svgSolid = made(await native.extrudeProfile(svgCircle!.id, 5), "Solid");
    check("an imported SVG shape is a usable profile",
      boundsMatch(svgSolid, [65, -35, 0], [85, -15, 5]), fmt(svgSolid));
    await native.undo();
    await native.undo();
    const bigShapes = await native.importSvg(shapesPath, "centimeter");
    check("import SVG in centimetres",
      bigShapes.created.some((b) => boundsMatch(b, [100, -400, 0], [500, -100, 0])));
    await native.undo();

    const bodiesBeforeMesh = (await native.state()).bodies.length;
    const reference = await native.importMesh(stlPath);
    const mesh = reference.created[0];
    const sameBox = (m: { boundsMm: { min: Vec3; max: Vec3 } | null } | undefined, min: Vec3, max: Vec3) =>
      m?.boundsMm != null && m.boundsMm.min.every((v, i) => Math.abs(v - min[i]!) < 1e-3) &&
      m.boundsMm.max.every((v, i) => Math.abs(v - max[i]!) < 1e-3);
    check("import STL as a reference mesh", reference.created.length === 1 && mesh?.triangles === 12 &&
      sameBox(mesh, [200, 0, 0], [240, 30, 10]), JSON.stringify(mesh?.boundsMm));
    check("a reference mesh is not a body", (await native.state()).bodies.length === bodiesBeforeMesh &&
      (await native.listReferenceMeshes()).some((m) => m.id === mesh?.id));
    const dropped = await native.deleteReferenceMeshes([mesh!.id]);
    check("delete a reference mesh", dropped.removedIds[0] === mesh!.id && dropped.referenceCount === 0);
    await native.undo();
    check("undo brings the reference mesh back", (await native.listReferenceMeshes()).length === 1);
    await native.undo();
    check("undo of the import removes it", (await native.listReferenceMeshes()).length === 0);
    const inMetres = await native.importMesh(stlPath, "meter");
    check("mesh unit scales the import", sameBox(inMetres.created[0], [200000, 0, 0], [240000, 30000, 10000]));
    await native.undo();
    const fromObj = await native.importMesh(objPath);
    check("import OBJ", sameBox(fromObj.created[0], [200, 0, 0], [240, 30, 10]), JSON.stringify(fromObj.created[0]?.boundsMm));
    await native.undo();
    const from3mf = await native.importMesh(join(folder, "plate.3mf"));
    check("3MF round trip keeps the true size", sameBox(from3mf.created[0], [200, 0, 0], [240, 30, 10]),
      JSON.stringify(from3mf.created[0]?.boundsMm));
    await native.undo();
    const noReference = await failure(native.deleteReferenceMeshes([424242]));
    check("unknown reference mesh id is refused", /Unknown reference mesh id/.test(noReference?.message ?? ""),
      noReference?.message ?? "no error");
    const missingMesh = await failure(native.importMesh(join(folder, "nothing.stl")));
    check("import of a missing mesh is refused", /not found/.test(missingMesh?.message ?? ""));
    const wrongImport = await failure(native.importParasolid(stepPath));
    check("import checks the extension", /must end in/.test(wrongImport?.message ?? ""));

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

const failure = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e);
const changed = (result: MutationResult, id: number) => result.changed.find((b) => b.id === id);
const faceBy = (t: BodyTopology, normal: Vec3) =>
  t.faces!.find((f) => f.normal.every((n, i) => Math.abs(n - normal[i]!) < 1e-6))!.id;
const brief = (result: MutationResult) => JSON.stringify({
  created: result.created.map((b) => `${b.type}/${b.faceCount}`),
  changed: result.changed.map((b) => `${b.type}/${b.faceCount}`),
  removed: result.removedIds.length,
});

// Cut, hollow, thicken, face tools, patch, pipe, join / unjoin — drawn around x = 2000.
async function solidChecks(native: NativeSession): Promise<void> {
  const X = 2000;

  const box = (await native.createBox([X, 0, 0], [40, 30, 20])).created[0]!;
  let t = await native.topology(box.id);
  const top = () => faceBy(t, [0, 0, 1]);
  const sides = () => [faceBy(t, [1, 0, 0]), faceBy(t, [-1, 0, 0]), faceBy(t, [0, 1, 0]), faceBy(t, [0, -1, 0])];

  // --- faces ---
  const raised = await native.offset(box.id, { faceIds: [top()] }, 5);
  check("offset faces +5 raises the top", boundsMatch(changed(raised, box.id), [X, 0, 0], [X + 40, 30, 25]),
    fmt(changed(raised, box.id)));
  await native.undo();

  t = await native.topology(box.id);
  const lean = 20 * Math.tan((10 * Math.PI) / 180);
  const drafted = await native.draftFaces(box.id, sides(), faceBy(t, [0, 0, -1]), 10);
  check("draft_faces 10° leans the sides out from the bottom",
    boundsMatch(changed(drafted, box.id), [X - lean, -lean, 0], [X + 40 + lean, 30 + lean, 20]),
    fmt(changed(drafted, box.id)));
  await native.undo();
  t = await native.topology(box.id);
  const selfReference = await failure(native.draftFaces(box.id, [top()], top(), 5));
  check("draft_faces rejects its own reference face", /reference face/.test(selfReference?.message ?? ""),
    selfReference?.message);

  const tray = await native.hollow(box.id, 2, [top()]);
  check("hollow with an open face keeps the outer size", changed(tray, box.id)?.faceCount === 11 &&
    boundsMatch(changed(tray, box.id), [X, 0, 0], [X + 40, 30, 20]), brief(tray));
  await native.undo();
  t = await native.topology(box.id);
  const grown = await native.hollow(box.id, 2, [top()], true);
  check("hollow outward grows the body",
    boundsMatch(changed(grown, box.id), [X - 2, -2, -2], [X + 42, 32, 20]), fmt(changed(grown, box.id)));
  await native.undo();
  const cavity = await native.hollow(box.id, 2);
  check("hollow without faces makes a closed cavity", changed(cavity, box.id)?.faceCount === 12 &&
    changed(cavity, box.id)?.type === "Solid", brief(cavity));
  await native.undo();

  t = await native.topology(box.id);
  const slab = await native.thicken(box.id, 3, 0, [top()]);
  check("thicken a face makes a new Solid", slab.changed.length === 0 &&
    boundsMatch(slab.created[0], [X, 0, 20], [X + 40, 30, 23]), fmt(slab.created[0]));
  await native.undo();

  // --- fillets: delete with and without healing, remove ---
  t = await native.topology(box.id);
  const uprights = t.edges!.filter((e) => e.kind === "line" && Math.abs(e.lengthMm - 20) < 1e-6).map((e) => e.id);
  await native.filletEdges(box.id, uprights.slice(0, 2), 4);
  t = await native.topology(box.id, "faces");
  const round = t.faces!.filter((f) => !f.planar).map((f) => f.id);
  const healed = await native.deleteFaces(box.id, [round[0]!]);
  check("delete_faces heals: a fillet is gone, still a Solid",
    changed(healed, box.id)?.type === "Solid" && changed(healed, box.id)?.faceCount === 7, brief(healed));
  await native.undo();
  const holed = await native.deleteFaces(box.id, [round[0]!], false);
  check("delete_faces without healing leaves an open Sheet",
    changed(holed, box.id)?.type === "Sheet" && changed(holed, box.id)?.faceCount === 7, brief(holed));
  await native.undo();
  const tooSmall = await failure(native.removeFillets([box.id], 2));
  check("remove_fillets below maxRadius finds nothing", /No fillets matched/.test(tooSmall?.message ?? ""),
    tooSmall?.message);
  const wrongSide = await failure(native.removeFillets([box.id], undefined, "concave"));
  check("remove_fillets concave finds nothing on outer edges", /No fillets matched/.test(wrongSide?.message ?? ""));
  const sharp = await native.removeFillets([box.id], 5, "convex");
  check("remove_fillets restores the box", changed(sharp, box.id)?.faceCount === 6 &&
    changed(sharp, box.id)?.type === "Solid", brief(sharp));
  await native.undo();
  await native.undo(); // the fillet

  // --- cut ---
  const blade = (await native.createPolyline([[X + 10, 5, 20], [X + 10, 25, 20]])).created[0]!;
  const short = await failure(native.cut([box.id], { curveIds: [blade.id] }));
  check("cut with a curve that stops short fails with a hint", /extend: true/.test(short?.message ?? ""),
    short?.message);
  const halves = await native.cut([box.id], { curveIds: [blade.id] }, true);
  const pieces = [...halves.created, ...halves.changed];
  check("cut with an extended line makes two Solids", pieces.length === 2 && halves.removedIds.length === 0 &&
    pieces.some((b) => boundsMatch(b, [X, 0, 0], [X + 10, 30, 20])) &&
    pieces.some((b) => boundsMatch(b, [X + 10, 0, 0], [X + 40, 30, 20])), brief(halves));
  await native.undo();
  const wedge = await native.cut([box.id], { curveIds: [blade.id] }, true, [1, 0, 1]);
  check("cut along a direction tilts the cut",
    [...wedge.created, ...wedge.changed].some((b) => boundsMatch(b, [X, 0, 10], [X + 10, 30, 20])),
    JSON.stringify([...wedge.created, ...wedge.changed].map((b) => b.boundsMm)));
  await native.undo();
  const knife = (await native.createBox([X + 25, 10, 5], [5, 5, 5])).created[0]!;
  const knifeFace = faceBy(await native.topology(knife.id, "faces"), [-1, 0, 0]);
  const sliced = await native.cut([box.id], { id: knife.id, faceIds: [knifeFace] });
  check("cut with a face of another body uses its whole plane",
    [...sliced.created, ...sliced.changed].some((b) => boundsMatch(b, [X, 0, 0], [X + 25, 30, 20])) &&
      [...sliced.created, ...sliced.changed].some((b) => boundsMatch(b, [X + 25, 0, 0], [X + 40, 30, 20])) &&
      !sliced.changed.some((b) => b.id === knife.id), brief(sliced));
  await native.undo();
  t = await native.topology(box.id);
  const own = await failure(native.cut([box.id], { id: box.id, faceIds: [top()] }));
  check("cut rejects the target's own faces", /own faces/.test(own?.message ?? ""), own?.message);

  // --- unjoin / join ---
  const lid = await native.unjoinFaces(box.id, [top()]);
  check("unjoin a face: a Sheet of its own, the body opens", lid.created.length === 1 &&
    lid.created[0]?.type === "Sheet" && changed(lid, box.id)?.type === "Sheet" &&
    changed(lid, box.id)?.faceCount === 5, brief(lid));
  const closed = await native.join([box.id, lid.created[0]!.id]);
  check("join Sheets that close a volume gives a Solid", changed(closed, box.id)?.type === "Solid" &&
    changed(closed, box.id)?.faceCount === 6 && closed.removedIds.length === 1, brief(closed));
  await native.undo();
  await native.undo();
  const apart = await native.unjoin([box.id]);
  check("unjoin a Solid: one Sheet per face", apart.created.length === 5 &&
    apart.created.every((b) => b.type === "Sheet" && b.faceCount === 1) && changed(apart, box.id)?.faceCount === 1,
    brief(apart));
  await native.undo();
  const mixed = await failure(native.join([box.id, blade.id]));
  check("join rejects a mix of curves and bodies", /either curves or Sheets/.test(mixed?.message ?? ""),
    mixed?.message);
  const elbow = (await native.createPolyline([[X, 100, 0], [X + 40, 100, 0], [X + 40, 130, 0]])).created[0]!;
  const segments = await native.unjoin([elbow.id]);
  check("unjoin a curve: one curve per segment", segments.created.length === 1 &&
    segments.created[0]?.type === "Wire" && changed(segments, elbow.id) !== undefined, brief(segments));
  await native.undo();

  // --- patch ---
  t = await native.topology(box.id);
  await native.deleteFaces(box.id, [top()], false);
  const capped = await native.patch({ id: box.id });
  check("patch caps every hole of a Sheet", changed(capped, box.id)?.type === "Solid" &&
    changed(capped, box.id)?.faceCount === 6, brief(capped));
  await native.undo();
  t = await native.topology(box.id);
  const rim = t.edges!.filter((e) => e.faceIds.length === 1).map((e) => e.id);
  const filled = await native.patch({ id: box.id, edgeIds: rim });
  check("patch fills one hole by its edges", rim.length === 4 && changed(filled, box.id)?.type === "Solid",
    brief(filled));
  await native.undo();
  await native.undo(); // the deleted face
  const ring = (await native.createCircle([X + 100, 0, 0], 10)).created[0]!;
  const membrane = await native.patch({ curveIds: [ring.id] });
  check("patch a closed curve makes a Sheet and keeps the curve", membrane.created.length === 1 &&
    membrane.created[0]?.type === "Sheet" && membrane.removedIds.length === 0 &&
    boundsMatch(membrane.created[0], [X + 90, -10, 0], [X + 110, 10, 0]), brief(membrane));
  await native.undo();
  const openCurve = await failure(native.patch({ curveIds: [elbow.id] }));
  check("patch rejects an open curve", /not closed/.test(openCurve?.message ?? ""), openCurve?.message);
  const ringRegion = (await native.listRegions()).find((r) =>
    Math.abs(r.boundsMm.min[0]! - (X + 90)) < 0.01 && Math.abs(r.boundsMm.max[0]! - (X + 110)) < 0.01);
  const fromRegion = await native.patch({ regionIds: [ringRegion!.id] });
  check("patch a region makes a Sheet", fromRegion.created.length === 1 &&
    fromRegion.created[0]?.type === "Sheet", brief(fromRegion));
  await native.undo();

  // A through hole in a Solid: patching its rim gives a separate Sheet.
  const drill = (await native.createCylinder([X + 20, 15, -5], 5, 30)).created[0]!;
  await native.boolean("difference", [box.id], [drill.id]);
  t = await native.topology(box.id);
  const mouth = t.edges!.filter((e) => e.kind === "circle" && Math.abs(e.midMm[2]! - 20) < 1e-6).map((e) => e.id);
  const plug = await native.patch({ id: box.id, edgeIds: mouth });
  check("patch edges of a Solid makes a separate Sheet", plug.created.length === 1 &&
    plug.created[0]?.type === "Sheet" && boundsMatch(plug.created[0], [X + 15, 10, 20], [X + 25, 20, 20]),
    brief(plug) + " " + fmt(plug.created[0]));
  await native.undo();
  await native.undo(); // the hole
  await native.undo(); // the drill

  // --- pipe ---
  const spine = (await native.createPolyline([[X, 200, 0], [X + 40, 200, 0]])).created[0]!;
  const rod = await native.pipe([spine.id], 6);
  check("pipe makes a rod of the given diameter", rod.created[0]?.type === "Solid" &&
    boundsMatch(rod.created[0], [X, 197, -3], [X + 40, 203, 3]) && rod.removedIds.length === 0, fmt(rod.created[0]));
  await native.undo();
  const tube = await native.pipe([spine.id], 6, 1);
  const rims = (await native.topology(tube.created[0]!.id, "edges")).edges!.map((e) => e.lengthMm);
  check("pipe with a wall: bore keeps the diameter, wall goes outside",
    rims.filter((l) => Math.abs(l - 2 * Math.PI * 3) < 0.01).length === 2 &&
      rims.filter((l) => Math.abs(l - 2 * Math.PI * 4) < 0.01).length === 2, JSON.stringify(rims));
  await native.undo();
  const notCurve = await failure(native.pipe([box.id], 6));
  check("pipe rejects a body that is not a curve", /not a curve/.test(notCurve?.message ?? ""), notCurve?.message);

  // --- thicken a Sheet ---
  const fence = (await native.extrudeProfile(elbow.id, 20)).created[0]!;
  const wall = await native.thicken(fence.id, 2, 1);
  check("thicken turns a Sheet into a Solid with the same id", changed(wall, fence.id)?.type === "Solid" &&
    wall.created.length === 0, brief(wall));
  await native.undo();
  const solidOnly = await failure(native.thicken(box.id, 2, 0));
  check("thicken without faces needs a Sheet", /not a Sheet/.test(solidOnly?.message ?? ""), solidOnly?.message);
}

// Face and edge tools: transform, offset, imprint, clean-up, sheets — drawn around x = 3000.
async function faceChecks(native: NativeSession): Promise<void> {
  const X = 3000;
  const box = (await native.createBox([X, 0, 0], [40, 30, 20])).created[0]!;
  let t = await native.topology(box.id);
  const top = () => faceBy(t, [0, 0, 1]);
  const frontTop = () => t.edges!.find((e) => e.midMm.join() === [X + 20, 0, 20].join())!.id;

  // --- move, rotate ---
  const lifted = await native.moveFaces(box.id, [top()], [0, 0, 5]);
  check("move_faces lifts the top", boundsMatch(changed(lifted, box.id), [X, 0, 0], [X + 40, 30, 25]),
    fmt(changed(lifted, box.id)));
  await native.undo();
  t = await native.topology(box.id);
  const tilted = await native.rotateFaces(box.id, [top()], [1, 0, 0], 10);
  const rise = 15 * Math.tan((10 * Math.PI) / 180);
  check("rotate_faces tilts the top about its own centre",
    boundsMatch(changed(tilted, box.id), [X, 0, 0], [X + 40, 30, 20 + rise]), fmt(changed(tilted, box.id)));
  await native.undo();
  t = await native.topology(box.id);
  const sloped = await native.moveEdges(box.id, [frontTop()], [0, 0, -5]);
  const slopedFaces = await native.topology(box.id, "faces");
  check("move_edges slopes the top, and the change is reported", changed(sloped, box.id) !== undefined &&
    slopedFaces.faceCount === 6 && !slopedFaces.faces!.some((f) => Math.abs(f.normal[2]! - 1) < 1e-6),
    brief(sloped));
  await native.undo();

  // --- offset: loops and edges draw on the surface ---
  t = await native.topology(box.id);
  const inset = await native.offset(box.id, { faceIds: [top()], loops: true }, 5);
  check("offset loops inward: an inset border on the face", changed(inset, box.id)?.faceCount === 7 &&
    boundsMatch(changed(inset, box.id), [X, 0, 0], [X + 40, 30, 20]), brief(inset));
  await native.undo();
  t = await native.topology(box.id);
  const outset = await native.offset(box.id, { faceIds: [top()], loops: true }, -5);
  check("offset loops outward: onto the neighbouring faces", changed(outset, box.id)?.faceCount === 10, brief(outset));
  await native.undo();
  t = await native.topology(box.id);
  const oneSide = await native.offset(box.id, { edgeIds: [frontTop()] }, 5);
  check("offset an edge: a new edge across one face", changed(oneSide, box.id)?.faceCount === 7, brief(oneSide));
  await native.undo();
  t = await native.topology(box.id);
  const twoSides = await native.offset(box.id, { edgeIds: [frontTop()] }, 5, { bothSides: true });
  check("offset an edge both ways", changed(twoSides, box.id)?.faceCount === 8, brief(twoSides));
  await native.undo();

  // --- imprint, complete, dissolve, join faces ---
  const scratch = (await native.createPolyline([[X + 10, 10, 20], [X + 30, 20, 20]])).created[0]!;
  const stubbed = await native.imprint(box.id, { curveIds: [scratch.id] });
  check("imprint without completion leaves an edge inside the face", changed(stubbed, box.id)?.faceCount === 6 &&
    changed(stubbed, box.id)?.edgeCount === 13 && stubbed.removedIds.length === 0, brief(stubbed));
  t = await native.topology(box.id);
  const stub = t.edges!.filter((e) => e.faceIds.length === 1).map((e) => e.id);
  const completed = await native.completeEdges(box.id, stub);
  check("complete_edges runs the edge to the boundary and splits the face", stub.length === 1 &&
    changed(completed, box.id)?.faceCount === 7, brief(completed));
  t = await native.topology(box.id);
  const tops = t.faces!.filter((f) => Math.abs(f.normal[2]! - 1) < 1e-6).map((f) => f.id);
  const dividing = t.edges!.filter((e) => e.faceIds.length === 2 && e.faceIds.every((f) => tops.includes(f))).map((e) => e.id);
  const merged = await native.joinFaces(box.id, tops);
  check("join faces merges the two halves", tops.length === 2 && changed(merged, box.id)?.faceCount === 6, brief(merged));
  await native.undo();
  const dissolved = await native.dissolveEdges(box.id, dividing);
  check("dissolve_edges removes the dividing edges", dividing.length > 0 && changed(dissolved, box.id)?.faceCount === 6,
    brief(dissolved));
  await native.undo();
  const cleaned = await native.dissolveEdges(box.id);
  check("dissolve_edges without ids removes all redundant edges", changed(cleaned, box.id)?.faceCount === 6 &&
    changed(cleaned, box.id)?.edgeCount === 12, brief(cleaned));
  await native.undo();
  await native.undo(); // complete
  await native.undo(); // imprint
  const split = await native.imprint(box.id, { curveIds: [scratch.id] }, "edge");
  check("imprint with complete: edge splits the face", changed(split, box.id)?.faceCount === 7, brief(split));
  await native.undo();
  const girdle = await native.imprint(box.id, { curveIds: [scratch.id] }, "boundary");
  check("imprint with complete: boundary goes around the body", changed(girdle, box.id)?.faceCount === 10, brief(girdle));
  await native.undo();
  const above = (await native.createPolyline([[X + 10, 10, 40], [X + 30, 20, 40]])).created[0]!;
  const dropped = await native.imprint(box.id, { curveIds: [above.id], direction: [0, 0, -1] }, "edge");
  check("imprint along a direction projects a curve from a distance", changed(dropped, box.id)?.faceCount === 7,
    brief(dropped));
  await native.undo();
  const post = (await native.createBox([X + 10, 10, 10], [20, 10, 20])).created[0]!;
  const crossed = await native.imprint(box.id, { toolIds: [post.id] });
  check("imprint with a body marks only the target", changed(crossed, box.id)?.faceCount === 7 &&
    changed(crossed, post.id) === undefined, brief(crossed));
  await native.undo();
  const marked = await native.imprint(box.id, { toolIds: [post.id], imprintTools: true });
  check("imprint with imprintTools marks the tool too", changed(marked, post.id) !== undefined, brief(marked));
  await native.undo();
  const selfImprint = await failure(native.imprint(box.id, { toolIds: [box.id] }));
  check("imprint rejects the body itself as a tool", /with itself/.test(selfImprint?.message ?? ""), selfImprint?.message);

  // --- match, duplicate ---
  t = await native.topology(box.id);
  const underside = faceBy(await native.topology(post.id, "faces"), [0, 0, -1]);
  const flush = await native.matchFaces(box.id, [top()], post.id, underside);
  check("match_faces brings the top onto the target face", boundsMatch(changed(flush, box.id), [X, 0, 0], [X + 40, 30, 10]),
    fmt(changed(flush, box.id)));
  await native.undo();
  const patchCopy = await native.duplicateFaces(box.id, [top(), faceBy(t, [1, 0, 0])]);
  check("duplicate_faces copies faces into a Sheet", patchCopy.created.length === 1 &&
    patchCopy.created[0]?.type === "Sheet" && patchCopy.created[0].faceCount === 2 && patchCopy.changed.length === 0,
    brief(patchCopy));
  await native.undo();
  const twin = await native.duplicateFaces(box.id, t.faces!.map((f) => f.id), true);
  check("duplicate_faces with solid copies a closed set as a Solid", twin.created[0]?.type === "Solid" &&
    twin.created[0].faceCount === 6, brief(twin));
  await native.undo();
  const open = await failure(native.duplicateFaces(box.id, [top()], true));
  check("duplicate_faces solid rejects an open set", /enclose a volume/.test(open?.message ?? ""), open?.message);

  // --- refillet ---
  const upright = t.edges!.find((e) => e.kind === "line" && Math.abs(e.lengthMm - 20) < 1e-6)!.id;
  await native.filletEdges(box.id, [upright], 4);
  const roundFace = async () => (await native.topology(box.id, "faces")).faces!.find((f) => !f.planar)!;
  const wider = await native.refillet(box.id, [(await roundFace()).id], { radiusMm: 6 });
  check("refillet sets the radius, and the change is reported", changed(wider, box.id) !== undefined &&
    (await roundFace()).radiusMm === 6, String((await roundFace()).radiusMm));
  await native.undo();
  await native.refillet(box.id, [(await roundFace()).id], { deltaMm: -2 });
  check("refillet by delta", (await roundFace()).radiusMm === 2, String((await roundFace()).radiusMm));
  await native.undo();
  await native.undo(); // the fillet

  // --- a cylinder: isoparam, scale, unwrap, untrim ---
  const can = (await native.createCylinder([X + 100, 0, 0], 10, 30)).created[0]!;
  const ct = await native.topology(can.id, "faces");
  const wall = ct.faces!.find((f) => !f.planar)!.id;
  const ring = await native.isoparam(can.id, wall, "v");
  check("isoparam v on a cylinder wall adds a ring", changed(ring, can.id)?.faceCount === 4, brief(ring));
  await native.undo();
  const staves = await native.isoparam(can.id, wall, "u", 0.5, 3);
  check("isoparam u with count 3 adds three lines", changed(staves, can.id)?.faceCount === 5, brief(staves));
  await native.undo();
  const fat = await native.scaleFaces(can.id, [wall], [2, 2, 1]);
  check("scale_faces doubles the radius about the axis",
    boundsMatch(changed(fat, can.id), [X + 80, -20, 0], [X + 120, 20, 30]), fmt(changed(fat, can.id)));
  await native.undo();
  const flat = await native.unwrapFaces(can.id, [wall]);
  const half = Math.PI * 10;
  check("unwrap_faces lays the wall flat at the origin", flat.changed.length === 0 &&
    boundsMatch(flat.created[0], [-half, -15, 0], [half, 15, 0], 0.01), fmt(flat.created[0]));
  await native.undo();
  const bare = await native.untrim(can.id, [faceBy(ct, [0, 0, 1])]);
  check("untrim detaches the face as its whole surface", changed(bare, can.id)?.type === "Sheet" &&
    changed(bare, can.id)?.faceCount === 1 && bare.created.length === 1 && bare.created[0]?.faceCount === 2, brief(bare));
  await native.undo();

  // --- sheets and curves: extend, reverse ---
  const path = (await native.createPolyline([[X + 200, 0, 0], [X + 240, 0, 0], [X + 240, 30, 0]])).created[0]!;
  const fence = (await native.extrudeProfile(path.id, 20)).created[0]!;
  const ft = await native.topology(fence.id);
  const upper = ft.edges!.filter((e) => e.midMm[2] === 20).map((e) => e.id);
  const taller = await native.extendSheet(fence.id, upper, 5);
  check("extend_sheet grows the Sheet past its edges",
    boundsMatch(changed(taller, fence.id), [X + 200, 0, 0], [X + 240, 30, 25]), fmt(changed(taller, fence.id)));
  await native.undo();
  const turned = await native.reverse([fence.id]);
  const turnedNormals = (await native.topology(fence.id, "faces")).faces!.map((f) => f.normal);
  check("reverse flips the normals of a Sheet, and the change is reported", changed(turned, fence.id) !== undefined &&
    ft.faces!.every((f) => turnedNormals.some((n) => n.every((v, i) => Math.abs(v + f.normal[i]!) < 1e-6))),
    JSON.stringify(turnedNormals));
  await native.undo();
  const startOf = async () => (await native.topology(path.id)).segments!.map((x) => x.startMm.join());
  const startsBefore = await startOf();
  await native.reverse([path.id]);
  const startsAfter = await startOf();
  check("reverse flips a curve", startsBefore.includes([X + 200, 0, 0].join()) &&
    !startsAfter.includes([X + 200, 0, 0].join()) && startsAfter.includes([X + 240, 30, 0].join()),
    JSON.stringify(startsAfter));
  await native.undo();
  const solidReverse = await failure(native.reverse([box.id]));
  check("reverse rejects a Solid", /either curves or Sheets/.test(solidReverse?.message ?? ""), solidReverse?.message);
}

// More curves: rectangle, polygon, spiral, text, slot, tangent arc and circle — drawn around x = 4000.
async function curveChecks(native: NativeSession): Promise<void> {
  const X = 4000;
  const wire = (result: MutationResult) => result.created.find((b) => b.type === "Wire");

  const rect = wire(await native.createRectangle({ originMm: [X, 0, 0], widthMm: 40, heightMm: 20 }));
  const rectTopo = await native.topology(rect!.id);
  check("rectangle from a corner: one closed curve of four lines", boundsMatch(rect, [X, 0, 0], [X + 40, 20, 0]) &&
    rectTopo.closed === true && rectTopo.segments?.length === 4, fmt(rect));
  const upright = wire(await native.createRectangle(
    { originMm: [X, 100, 0], widthMm: 40, heightMm: 20, centered: true, normal: [1, 0, 0] }));
  check("centred rectangle in the plane with normal +X", boundsMatch(upright, [X, 80, -10], [X, 120, 10]), fmt(upright));
  const slanted = wire(await native.createRectangle({ pointsMm: [[X, 200, 0], [X + 30, 200, 0], [X + 30, 210, 0]] }));
  check("rectangle through three points", boundsMatch(slanted, [X, 200, 0], [X + 30, 210, 0]), fmt(slanted));
  const parallel = await failure(native.createRectangle(
    { originMm: [X, 0, 0], widthMm: 1, heightMm: 1, normal: [0, 0, 1], xDirection: [0, 0, 2] }));
  check("rectangle rejects xDirection along the normal", /parallel to normal/.test(parallel?.message ?? ""), parallel?.message);

  const hexagon = wire(await native.createPolygon([X + 100, 0, 0], 10, 6));
  const half = 10 * Math.sin(Math.PI / 3);
  check("polygon: radius to the vertices", boundsMatch(hexagon, [X + 90, -half, 0], [X + 110, half, 0]) &&
    (await native.topology(hexagon!.id)).segments?.length === 6, fmt(hexagon));
  const acrossFlats = wire(await native.createPolygon([X + 100, 100, 0], 10, 6, [0, 0, 1], "side"));
  const corner = 10 / Math.cos(Math.PI / 6);
  check("polygon: radius to the sides", boundsMatch(acrossFlats, [X + 100 - corner, 90, 0], [X + 100 + corner, 110, 0]),
    fmt(acrossFlats));

  const helix = wire(await native.createSpiral([X + 200, 0, 0], [0, 0, 1], 30, 10, 3));
  check("spiral: three turns inside its cylinder", boundsMatch(helix, [X + 190, -10, 0], [X + 210, 10, 30], 0.5), fmt(helix));

  const depthBefore = (await native.state()).undoDepth;
  const word = await native.createText("AB", 10, [X + 300, 0, 0]);
  check("text: curves for each letter, one undo step", word.created.length >= 2 &&
    word.created.every((b) => b.type === "Wire") && word.undoDepth === depthBefore + 1 &&
    word.created.every((b) => b.boundsMm!.min[0]! >= X + 299 && b.boundsMm!.max[0]! < X + 330 &&
      b.boundsMm!.max[1]! < 15 && b.boundsMm!.max[2] === 0),
    JSON.stringify(word.created.map((b) => b.boundsMm)));
  const standing = await native.createText("A", 10, [X + 300, 100, 0], [0, -1, 0]);
  check("text in an upright plane", standing.created.every((b) =>
    Math.abs(b.boundsMm!.min[1]! - 100) < 1e-6 && Math.abs(b.boundsMm!.max[1]! - 100) < 1e-6) &&
    standing.created.some((b) => b.boundsMm!.max[2]! > 5), JSON.stringify(standing.created.map((b) => b.boundsMm)));

  const straight = wire(await native.createPolyline([[X + 400, 100, 0], [X + 440, 100, 0]]))!;
  const noPlane = await failure(native.createSlot([straight.id], 10));
  check("slot refuses a single straight line", /defines a plane/.test(noPlane?.message ?? ""), noPlane?.message);
  const spine = wire(await native.createPolyline([[X + 400, 0, 0], [X + 440, 0, 0], [X + 440, 30, 0]]))!;
  const slot = await native.createSlot([spine.id], 10);
  check("slot around a bent line", boundsMatch(wire(slot), [X + 395, -5, 0], [X + 445, 35, 0], 0.01) &&
    slot.removedIds.length === 0 && (await native.topology(wire(slot)!.id)).closed === true, fmt(wire(slot)));

  const lastSegment = (await native.topology(spine.id)).segments!.find((x) => x.endMm.join() === [X + 440, 30, 0].join())!;
  const bend = await native.createTangentArc({ id: spine.id, segmentId: lastSegment.id }, "end", [X + 450, 40, 0]);
  check("tangent arc leaves the end of the curve", boundsMatch(wire(bend), [X + 440, 30, 0], [X + 450, 40, 0]),
    fmt(wire(bend)));

  const legA = wire(await native.createPolyline([[X + 500, 0, 0], [X + 540, 0, 0]]))!;
  const legB = wire(await native.createPolyline([[X + 500, 0, 0], [X + 500, 40, 0]]))!;
  const segmentOf = async (id: number) => ({ id, segmentId: (await native.topology(id)).segments![0]!.id });
  const nested = await native.createTangentCircle(await segmentOf(legA.id), await segmentOf(legB.id), 5, [X + 510, 10, 0]);
  check("tangent circle sits in the corner of two lines", boundsMatch(wire(nested), [X + 500, 0, 0], [X + 510, 10, 0]),
    fmt(wire(nested)));

  const through = wire(await native.createCircleThrough([[X + 600, 0, 0], [X + 620, 0, 0], [X + 610, 10, 0]]));
  check("circle through three points", boundsMatch(through, [X + 600, -10, 0], [X + 620, 10, 0]), fmt(through));
  const across = wire(await native.createCircleThrough([[X + 700, 0, 0], [X + 720, 0, 0]]));
  check("circle on a diameter", boundsMatch(across, [X + 700, -10, 0], [X + 720, 10, 0]), fmt(across));
  const tiltedDiameter = await failure(native.createCircleThrough([[X, 0, 0], [X, 0, 10]]));
  check("circle on a diameter needs a perpendicular normal", /perpendicular/.test(tiltedDiameter?.message ?? ""),
    tiltedDiameter?.message);

  const hull: Vec3[] = [[X + 800, 0, 0], [X + 810, 10, 0], [X + 820, 0, 0]];
  const pulled = wire(await native.createSpline(hull, false, undefined, true));
  check("spline by control points stays inside its polygon", pulled!.boundsMm!.max[1]! < 9 &&
    pulled!.boundsMm!.min[0] === X + 800 && pulled!.boundsMm!.max[0] === X + 820, fmt(pulled));
}

// Editing curves: corners, vertices and control points, trim, cut, bridge, offsets — drawn around x = 5000.
async function curveEditChecks(native: NativeSession): Promise<void> {
  const X = 5000;
  const wire = (result: MutationResult) => result.created.find((b) => b.type === "Wire");
  const near = (a: number[], b: number[], tolerance = 1e-3) => a.every((v, i) => Math.abs(v - b[i]!) < tolerance);
  const vertexAt = async (id: number, at: Vec3) =>
    (await native.topology(id)).vertices!.find((v) => near(v.positionMm, at))!.id;
  const shape = async (id: number) => {
    const t = await native.topology(id);
    return {
      kinds: t.segments!.map((x) => x.kind),
      lengths: t.segments!.map((x) => x.lengthMm),
      vertices: t.vertices!.map((v) => v.positionMm),
      cvs: t.controlPoints!.length,
    };
  };

  // --- corners and vertices of a polyline ---
  const zig = wire(await native.createPolyline([[X, 0, 0], [X + 40, 0, 0], [X + 40, 30, 0], [X + 80, 30, 0]]))!;
  const corner = await vertexAt(zig.id, [X + 40, 0, 0]);
  const tail = await vertexAt(zig.id, [X + 80, 30, 0]);

  await native.filletCurve(zig.id, 5, [corner]);
  let now = await shape(zig.id);
  check("fillet a vertex of a curve", now.kinds.filter((k) => k === "circle").length === 1 &&
    now.lengths.some((l) => Math.abs(l - (Math.PI * 5) / 2) < 1e-3), JSON.stringify(now.lengths));
  await native.undo();
  await native.filletCurve(zig.id, -5, [corner]);
  now = await shape(zig.id);
  check("a negative radius chamfers the vertex", now.kinds.every((k) => k === "line") &&
    now.lengths.some((l) => Math.abs(l - 5 * Math.SQRT2) < 1e-3), JSON.stringify(now.lengths));
  await native.undo();
  await native.filletCurve(zig.id, 5);
  now = await shape(zig.id);
  check("fillet without vertices rounds every corner", now.kinds.filter((k) => k === "circle").length === 2,
    JSON.stringify(now.kinds));
  await native.undo();
  await native.offsetVertices(zig.id, [corner], 5);
  now = await shape(zig.id);
  check("offset a vertex adds a vertex on each side", now.vertices.length === 6 &&
    now.vertices.some((v) => near(v, [X + 35, 0, 0])) && now.vertices.some((v) => near(v, [X + 40, 5, 0])),
    JSON.stringify(now.vertices));
  await native.undo();
  await native.convertVertices(zig.id, [corner]);
  now = await shape(zig.id);
  check("convert a corner vertex into a smooth one", now.kinds.includes("curve") && now.kinds.length === 2,
    JSON.stringify(now.kinds));
  await native.undo();
  const longer = await native.extendCurve(zig.id, [tail], 10);
  check("extend a curve past its end", boundsMatch(changed(longer, zig.id), [X, 0, 0], [X + 90, 30, 0]),
    fmt(changed(longer, zig.id)));
  await native.undo();
  await native.subdivideCurves([zig.id]);
  check("subdivide adds a control point per segment", (await shape(zig.id)).cvs === 3);
  await native.undo();
  await native.raiseDegree([zig.id]);
  check("raise_degree turns the lines into splines", (await shape(zig.id)).kinds.every((k) => k === "curve"));
  await native.undo();
  await native.rebuildCurves([zig.id], { pointCount: 6 });
  now = await shape(zig.id);
  check("rebuild with a point count makes one spline", now.kinds.join() === "curve", JSON.stringify(now.kinds));
  await native.undo();
  await native.rebuildCurves([zig.id], { degree: 3, spans: 4 });
  now = await shape(zig.id);
  check("rebuild with degree and spans keeps the corners", now.kinds.length === 3 && now.cvs > 3, JSON.stringify(now.cvs));
  await native.undo();

  await native.moveControlPoints(zig.id, { vertexIds: [corner] }, [0, 5, 0]);
  check("move a vertex of a curve", (await shape(zig.id)).vertices.some((v) => near(v, [X + 40, 5, 0])));
  await native.undo();
  await native.rotateControlPoints(zig.id, { vertexIds: [tail] }, [0, 0, 1], 90, [X + 40, 30, 0]);
  now = await shape(zig.id);
  check("rotate a vertex about a pivot", now.vertices.some((v) => near(v, [X + 40, 70, 0], 0.01)), JSON.stringify(now.vertices));
  await native.undo();
  await native.scaleControlPoints(zig.id, { vertexIds: [tail] }, [2, 2, 2], [X + 40, 30, 0]);
  now = await shape(zig.id);
  check("scale a vertex about a pivot", now.vertices.some((v) => near(v, [X + 120, 30, 0], 0.01)), JSON.stringify(now.vertices));
  await native.undo();

  const parallel = await native.offsetCurves([zig.id], 5);
  check("offset a curve: a parallel copy, the curve stays", parallel.removedIds.length === 0 &&
    boundsMatch(wire(parallel), [X, 5, 0], [X + 80, 35, 0]), fmt(wire(parallel)));
  await native.undo();
  const flanks = await native.offsetCurves([zig.id], 5, true);
  check("offset a curve both ways", flanks.created.filter((b) => b.type === "Wire").length === 2, brief(flanks));
  await native.undo();

  // --- crossing lines: cut and trim ---
  const across = wire(await native.createPolyline([[X, 100, 0], [X + 60, 100, 0]]))!;
  const upright = wire(await native.createPolyline([[X + 30, 80, 0], [X + 30, 120, 0]]))!;
  const halves = await native.cut([across.id], { curveIds: [upright.id] });
  const pieces = [...halves.created, ...halves.changed];
  check("cut a curve with a curve", pieces.length === 2 &&
    pieces.some((b) => boundsMatch(b, [X, 100, 0], [X + 30, 100, 0])) &&
    pieces.some((b) => boundsMatch(b, [X + 30, 100, 0], [X + 60, 100, 0])), brief(halves));
  await native.undo();
  const trimmed = await native.trimCurve(across.id, [X + 45, 100, 0]);
  const rest = [...trimmed.changed, ...trimmed.created].filter((b) => b.type === "Wire" && b.id !== upright.id);
  check("trim removes the piece beyond the crossing", rest.length === 1 &&
    boundsMatch(rest[0], [X, 100, 0], [X + 30, 100, 0]), brief(trimmed) + " " + fmt(rest[0]));
  await native.undo();
  const wrongCutter = await failure(native.cut([across.id], { id: upright.id, faceIds: ["x"] }));
  check("curves are cut with curves only", /pass curveIds/.test(wrongCutter?.message ?? ""), wrongCutter?.message);

  // --- splines: control points, bridge, align ---
  const s1 = wire(await native.createSpline([[X, 200, 0], [X + 20, 210, 0], [X + 40, 200, 0], [X + 60, 210, 0]]))!;
  const s2 = wire(await native.createSpline([[X + 100, 200, 0], [X + 120, 190, 0], [X + 140, 200, 0]]))!;
  const cvsBefore = (await native.topology(s1.id)).controlPoints!;
  const cv = cvsBefore[cvsBefore.length - 1]!;
  await native.moveControlPoints(s1.id, { controlPointIds: [cv.id] }, [0, 5, 0]);
  let cvsNow = (await native.topology(s1.id)).controlPoints!;
  check("move a control point", near(cvsNow.find((c) => c.id === cv.id)!.positionMm,
    [cv.positionMm[0]!, cv.positionMm[1]! + 5, cv.positionMm[2]!], 0.01), JSON.stringify(cvsNow));
  await native.undo();
  await native.slideControlPoints(s1.id, { controlPointIds: [cv.id] }, 3);
  cvsNow = (await native.topology(s1.id)).controlPoints!;
  const slid = cvsNow.find((c) => c.id === cv.id)!.positionMm;
  check("slide a control point along the control polygon",
    Math.abs(Math.hypot(...slid.map((v, i) => v - cv.positionMm[i]!)) - 3) < 0.01, JSON.stringify(slid));
  await native.undo();
  await native.deleteControlPoints(s1.id, { controlPointIds: [cv.id] });
  check("delete a control point", (await native.topology(s1.id)).controlPoints!.length === cvsBefore.length - 1);
  await native.undo();

  const end1 = await vertexAt(s1.id, [X + 60, 210, 0]);
  const start2 = await vertexAt(s2.id, [X + 100, 200, 0]);
  const link = await native.bridge({ id: s1.id, vertexId: end1 }, { id: s2.id, vertexId: start2 });
  check("bridge two curve ends with a new curve", wire(link) !== undefined &&
    Math.abs(wire(link)!.boundsMm!.min[0]! - (X + 60)) < 0.01 && Math.abs(wire(link)!.boundsMm!.max[0]! - (X + 100)) < 0.01,
    fmt(wire(link)));
  await native.undo();
  await native.alignVertex(s2.id, start2, s1.id, end1, "G1");
  check("align brings one curve end onto another", (await shape(s2.id)).vertices.some((v) => near(v, [X + 60, 210, 0], 0.01)));
  await native.undo();

  // --- bodies: curves from edges, bridge between edges, deform onto a face ---
  const box = (await native.createBox([X + 200, 0, 0], [40, 30, 20])).created[0]!;
  const bt = await native.topology(box.id);
  const rim = await native.curvesFromEdges(box.id, bt.edges!.filter((e) => e.midMm[2] === 20).map((e) => e.id));
  check("curves_from_edges copies an edge loop as one closed curve", rim.created.length === 1 &&
    boundsMatch(wire(rim), [X + 200, 0, 20], [X + 240, 30, 20]) && (await native.topology(wire(rim)!.id)).closed === true,
    brief(rim));
  await native.undo();
  const other = (await native.createBox([X + 260, 0, 0], [40, 30, 20])).created[0]!;
  const ot = await native.topology(other.id);
  const edgeAt = (t: BodyTopology, mid: Vec3) => t.edges!.find((e) => near(e.midMm, mid))!.id;
  const span = await native.bridge(
    { id: box.id, edgeId: edgeAt(bt, [X + 240, 15, 20]) },
    { id: other.id, edgeId: edgeAt(ot, [X + 260, 15, 20]) },
    "G1",
  );
  check("bridge two body edges", wire(span) !== undefined && Math.abs(wire(span)!.boundsMm!.min[0]! - (X + 240)) < 0.01 &&
    Math.abs(wire(span)!.boundsMm!.max[0]! - (X + 260)) < 0.01, fmt(wire(span)));
  await native.undo();
  const unlike = await failure(native.bridge({ id: s1.id, vertexId: end1 }, { id: box.id, edgeId: edgeAt(bt, [X + 240, 15, 20]) }));
  check("bridge rejects a vertex with an edge", /not one of each/.test(unlike?.message ?? ""), unlike?.message);

  const can = (await native.createCylinder([X + 400, 0, 0], 10, 30)).created[0]!;
  const wall = (await native.topology(can.id, "faces")).faces!.find((f) => !f.planar)!.id;
  const mark = wire(await native.createPolyline([[X + 205, 5, 20], [X + 235, 25, 20]]))!;
  const wrapped = await native.deformCurves([mark.id], { id: box.id, faceId: faceBy(bt, [0, 0, 1]) }, { id: can.id, faceId: wall });
  const onWall = [...wrapped.created, ...wrapped.changed].find((b) => b.type === "Wire");
  check("deform wraps a curve from one face onto another", onWall !== undefined &&
    onWall.boundsMm!.min[0]! >= X + 389.5 && onWall.boundsMm!.max[0]! <= X + 410.5, brief(wrapped) + " " + fmt(onWall));
  await native.undo();

  // --- regions and redundant vertices ---
  await native.createCircle([X + 500, 0, 0], 10);
  const disc = (await native.listRegions()).find((r) =>
    Math.abs(r.boundsMm.min[0]! - (X + 490)) < 0.01 && Math.abs(r.boundsMm.max[0]! - (X + 510)) < 0.01)!;
  const halo = await native.offsetRegions([disc.id], 2);
  check("offset a region: a curve around its outline", boundsMatch(wire(halo), [X + 488, -12, 0], [X + 512, 12, 0], 0.01),
    brief(halo) + " " + fmt(wire(halo)));
  await native.undo();
  const straight = wire(await native.createPolyline([[X + 600, 0, 0], [X + 620, 0, 0], [X + 640, 0, 0]]))!;
  await native.dissolveEdges(straight.id);
  check("dissolve on a curve removes a redundant vertex", (await shape(straight.id)).kinds.length === 1);
  await native.undo();
}

// Projection: curves onto bodies, intersections, outlines, flattening — drawn around x = 6000.
async function projectionChecks(native: NativeSession): Promise<void> {
  const X = 6000;
  const wires = (result: MutationResult) => result.created.filter((b) => b.type === "Wire");
  const box = (await native.createBox([X, 0, 0], [40, 30, 20])).created[0]!;
  const post = (await native.createCylinder([X + 20, 15, -10], 8, 40)).created[0]!;

  const crossing = await native.project({ bodyIds: [box.id, post.id] });
  check("project two bodies: the lines where they cross", wires(crossing).length === 2 && crossing.changed.length === 0 &&
    wires(crossing).some((b) => boundsMatch(b, [X + 12, 7, 20], [X + 28, 23, 20])) &&
    wires(crossing).some((b) => boundsMatch(b, [X + 12, 7, 0], [X + 28, 23, 0])), brief(crossing));
  await native.undo();
  const apart = (await native.createBox([X, 100, 0], [10, 10, 10])).created[0]!;
  const noCrossing = await failure(native.project({ bodyIds: [box.id, apart.id] }));
  check("project bodies that do not cross is refused", /must cross/.test(noCrossing?.message ?? ""), noCrossing?.message);

  const above = (await native.createPolyline([[X + 5, 5, 40], [X + 35, 25, 40]])).created[0]!;
  const dropped = await native.project({ curveIds: [above.id], targetId: box.id });
  check("project a curve onto a body along the surface normals", wires(dropped).length === 1 &&
    boundsMatch(wires(dropped)[0], [X + 5, 5, 20], [X + 35, 25, 20]) && dropped.changed.length === 0, brief(dropped));
  await native.undo();
  const slanted = await native.project({ curveIds: [above.id], targetId: box.id, direction: [1, 0, -1] });
  check("project a curve along a direction", wires(slanted).length === 1 &&
    boundsMatch(wires(slanted)[0], [X + 25, 5, 20], [X + 40, 15, 20], 0.01), fmt(wires(slanted)[0]));
  await native.undo();

  const plan = (await native.createSpline([[X + 100, 0, 0], [X + 120, 10, 0], [X + 140, 0, 0]])).created[0]!;
  const elevation = (await native.createSpline([[X + 100, -20, 0], [X + 120, -20, 15], [X + 140, -20, 0]])).created[0]!;
  const combined = await native.project({ curveIds: [plan.id, elevation.id] });
  const space = wires(combined)[0];
  check("project two curves into one curve in space", space !== undefined &&
    Math.abs(space.boundsMm!.min[0]! - (X + 100)) < 0.01 && Math.abs(space.boundsMm!.max[0]! - (X + 140)) < 0.01 &&
    space.boundsMm!.max[1]! > 5 && space.boundsMm!.max[2]! > 5, fmt(space));
  await native.undo();

  const silhouette = await native.createOutline([post.id]);
  check("create_outline: the outline on the body", wires(silhouette).length === 1 &&
    Math.abs(wires(silhouette)[0]!.boundsMm!.min[0]! - (X + 12)) < 0.01 &&
    Math.abs(wires(silhouette)[0]!.boundsMm!.max[1]! - 23) < 0.01 && silhouette.changed.length === 0, brief(silhouette));
  await native.undo();
  const footprint = await native.createOutline([post.id], true);
  check("create_outline flat: projected onto the construction plane",
    boundsMatch(wires(footprint)[0], [X + 12, 7, 0], [X + 28, 23, 0], 0.01), fmt(wires(footprint)[0]));
  await native.undo();

  const wavy = (await native.createSpline([[X + 200, 0, 0], [X + 220, 10, 15], [X + 240, 0, 30]])).created[0]!;
  const depth = (await native.state()).undoDepth;
  const shadow = await native.duplicateAndProject({ curveIds: [wavy.id] }, [0, 0, 0], [0, 0, 1]);
  check("duplicate_and_project flattens a copy, one undo step", wires(shadow).length === 1 &&
    shadow.changed.length === 0 && shadow.undoDepth === depth + 1 &&
    wires(shadow)[0]!.boundsMm!.min[2] === 0 && wires(shadow)[0]!.boundsMm!.max[2] === 0 &&
    Math.abs(wires(shadow)[0]!.boundsMm!.max[0]! - (X + 240)) < 0.01, fmt(wires(shadow)[0]));
  await native.undo();
  const sideways = await native.duplicateAndProject({ curveIds: [wavy.id] }, [X + 250, 0, 0], [1, 0, 0]);
  check("duplicate_and_project onto another plane", wires(sideways)[0]!.boundsMm!.min[0] === X + 250 &&
    wires(sideways)[0]!.boundsMm!.max[0] === X + 250 && Math.abs(wires(sideways)[0]!.boundsMm!.max[2]! - 30) < 0.01,
    fmt(wires(sideways)[0]));
  await native.undo();
  const bt = await native.topology(box.id);
  const topEdges = bt.edges!.filter((e) => e.midMm[2] === 20).map((e) => e.id);
  const floor = await native.duplicateAndProject({ id: box.id, edgeIds: topEdges }, [0, 0, -5], [0, 0, 1]);
  check("duplicate_and_project takes edges of a body", wires(floor).length === 1 &&
    boundsMatch(wires(floor)[0], [X, 0, -5], [X + 40, 30, -5]) && floor.changed.length === 0, brief(floor));
  await native.undo();
}

// Surfaces: control points, degree, rebuild, deform, bridge, constrained surface — drawn around x = 7000.
async function surfaceChecks(native: NativeSession): Promise<void> {
  const X = 7000;
  const box = (await native.createBox([X, 0, 0], [40, 30, 20])).created[0]!;
  let t = await native.topology(box.id);
  const top = () => faceBy(t, [0, 0, 1]);
  check("a body of planes has no surface control points", t.controlPoints === undefined);

  const raised = await native.raiseDegreeFaces(box.id, [top()]);
  t = await native.topology(box.id);
  check("raise_degree on a face gives it control points", changed(raised, box.id) !== undefined &&
    t.controlPoints?.length === 4, JSON.stringify(t.controlPoints));
  const corner = t.controlPoints!.find((c) => Math.abs(c.positionMm[0]! - (X + 40)) < 0.01 && Math.abs(c.positionMm[1]!) < 0.01)!;
  const lifted = await native.moveControlPoints(box.id, { controlPointIds: [corner.id] }, [0, 0, 5]);
  check("move a surface control point", Math.abs(changed(lifted, box.id)!.boundsMm!.max[2]! - 25) < 0.01,
    fmt(changed(lifted, box.id)));
  await native.undo();
  const pushed = await native.slideControlPoints(box.id, { controlPointIds: [corner.id] }, 3, "normal");
  check("slide a surface control point along the normal", Math.abs(changed(pushed, box.id)!.boundsMm!.max[2]! - 23) < 0.01,
    fmt(changed(pushed, box.id)));
  await native.undo();
  const noVertices = await failure(native.moveControlPoints(box.id, { vertexIds: ["1"] }, [0, 0, 1]));
  check("vertices are refused on a body", /not a curve/.test(noVertices?.message ?? ""), noVertices?.message);
  const refit = await native.rebuildFace(box.id, top(), 0.01);
  check("rebuild a face within a tolerance", changed(refit, box.id)?.type === "Solid", brief(refit));
  await native.undo();
  const revealed = await native.removeNominalSurface(box.id, [top()]);
  check("remove_nominal_surface runs on a spline face", revealed.removedIds.length === 0 &&
    (await native.state()).bodies.some((b) => b.id === box.id), brief(revealed));
  await native.undo();
  await native.undo(); // raise degree
  t = await native.topology(box.id);

  // --- deform a body from a flat face onto a cylinder wall ---
  const boss = (await native.createBox([X + 10, 10, 20], [10, 5, 3])).created[0]!;
  const can = (await native.createCylinder([X + 100, 0, 0], 10, 30)).created[0]!;
  const wall = (await native.topology(can.id, "faces")).faces!.find((f) => !f.planar)!.id;
  const wrapped = await native.deformBodies([boss.id], { id: box.id, faceId: top() }, { id: can.id, faceId: wall });
  const bent = changed(wrapped, boss.id);
  check("deform wraps a body onto another face", bent !== undefined && bent.boundsMm!.min[0]! > X + 80 &&
    bent.boundsMm!.max[0]! < X + 105, fmt(bent));
  await native.undo();
  const copyWrapped = await native.deformBodies([boss.id], { id: box.id, faceId: top() }, { id: can.id, faceId: wall }, true);
  check("deform with keepOriginals leaves the body and adds the wrapped one", copyWrapped.created.length === 1 &&
    changed(copyWrapped, boss.id) === undefined, brief(copyWrapped));
  await native.undo();

  // --- bridge surface between a floor and a wall ---
  const sheetOf = async (points: Vec3[]) => {
    const outline = (await native.createPolyline(points, true)).created[0]!;
    const sheet = (await native.patch({ curveIds: [outline.id] })).created[0]!;
    return { id: sheet.id, faceId: (await native.topology(sheet.id, "faces")).faces![0]!.id };
  };
  const floor = await sheetOf([[X + 200, 0, 0], [X + 240, 0, 0], [X + 240, 30, 0], [X + 200, 30, 0]]);
  const upright = await sheetOf([[X + 250, 0, 10], [X + 250, 30, 10], [X + 250, 30, 40], [X + 250, 0, 40]]);
  const blended = await native.bridgeSurface(
    { ...floor, nearMm: [X + 230, 15, 0] }, { ...upright, nearMm: [X + 250, 15, 20] }, 15);
  check("bridge_surface blends two Sheets into one", changed(blended, floor.id)?.type === "Sheet" &&
    changed(blended, floor.id)?.faceCount === 3 && blended.removedIds.includes(upright.id), brief(blended));
  await native.undo();
  const level = await sheetOf([[X + 300, 0, 0], [X + 340, 0, 0], [X + 340, 30, 0], [X + 300, 30, 0]]);
  const coplanar = await failure(native.bridgeSurface(
    { ...floor, nearMm: [X + 240, 15, 0] }, { ...level, nearMm: [X + 300, 15, 0] }, 5));
  check("bridge_surface refuses coplanar Sheets with a hint", /meet at an angle/.test(coplanar?.message ?? ""),
    coplanar?.message);
  const same = await failure(native.bridgeSurface({ ...floor, nearMm: [0, 0, 0] }, { ...floor, nearMm: [0, 0, 0] }, 5));
  check("bridge_surface needs two Sheets", /two different Sheets/.test(same?.message ?? ""), same?.message);

  // --- a surface through points ---
  const cloud: Vec3[] = [[X + 400, 0, 0], [X + 440, 0, 5], [X + 440, 30, 0], [X + 400, 30, 5], [X + 420, 15, 8]];
  const skin = await native.constrainedSurface(cloud);
  const skinBody = skin.created[0];
  check("constrained_surface makes a Sheet over the points", skinBody?.type === "Sheet" &&
    skinBody.boundsMm!.min[0]! <= X + 400 && skinBody.boundsMm!.max[0]! >= X + 440 && skinBody.boundsMm!.max[2]! >= 8,
    fmt(skinBody));
  await native.undo();
  const uneven = await failure(native.constrainedSurface(cloud, [[0, 0, 1]]));
  check("constrained_surface wants one normal per point", /one normal per point/.test(uneven?.message ?? ""), uneven?.message);
}

// Instances and the array along a curve — drawn around x = 8000.
async function instanceChecks(native: NativeSession): Promise<void> {
  const X = 8000;
  const cube = (await native.createBox([X, 0, 0], [10, 10, 10])).created[0]!;
  const instancesBefore = (await native.listInstances()).length;
  const depth = (await native.state()).undoDepth;

  const linked = await native.createInstances([cube.id], [30, 0, 0]);
  const instance = linked.created[0];
  check("create_instances: a linked copy, shifted, one undo step", linked.created.length === 1 &&
    instance?.sourceId === cube.id && linked.undoDepth === depth + 1 && instance.boundsMm !== null &&
    instance.boundsMm.min.every((v, i) => Math.abs(v - [X + 30, 0, 0][i]!) < 1e-3) &&
    instance.boundsMm.max.every((v, i) => Math.abs(v - [X + 40, 10, 10][i]!) < 1e-3), JSON.stringify(instance));
  check("an instance is not a body", (await native.state()).bodies.filter((b) => b.boundsMm?.min[0] === X + 30).length === 0 &&
    (await native.listInstances()).length === instancesBefore + 1);
  const real = await native.realizeInstances([instance!.id]);
  check("realize_instances turns it into a body", real.created.length === 1 && real.created[0]?.type === "Solid" &&
    boundsMatch(real.created[0], [X + 30, 0, 0], [X + 40, 10, 10]) &&
    (await native.listInstances()).length === instancesBefore, fmt(real.created[0]));
  await native.undo();
  const gone = await native.deleteInstances([instance!.id]);
  check("delete_instances removes it", gone.removedIds.length === 1 && gone.instanceCount === instancesBefore,
    JSON.stringify(gone.removedIds));
  await native.undo();
  await native.undo(); // the instance
  check("undo removes the instance", (await native.listInstances()).length === instancesBefore);
  const unknown = await failure(native.realizeInstances([424242]));
  check("unknown instance id is refused", /Unknown instance id/.test(unknown?.message ?? ""), unknown?.message);
  const wire = (await native.createPolyline([[X, 50, 0], [X + 10, 50, 0], [X + 10, 60, 0]])).created[0]!;
  const curveLink = await native.createInstances([wire.id]);
  check("a curve can be instanced too", curveLink.created[0]?.sourceId === wire.id, JSON.stringify(curveLink.created));
  await native.undo();

  const row = await native.arrayRectangular([cube.id], [1, 0, 0], 3, 20, undefined, 1, 0, true);
  check("array_rectangular with instances makes instances, not bodies", row.created.length === 0 &&
    row.createdInstances?.length === 2 && row.createdInstances.every((i) => i.sourceId === cube.id) &&
    row.createdInstances.some((i) => Math.abs(i.boundsMm!.min[0]! - (X + 40)) < 1e-3), JSON.stringify(row.createdInstances));
  await native.undo();
  const ring = await native.arrayRadial([cube.id], [X + 50, 0, 0], [0, 0, 1], 4, 360, true);
  check("array_radial with instances", ring.created.length === 0 && ring.createdInstances?.length === 3,
    JSON.stringify(ring.createdInstances?.length));
  await native.undo();

  // --- along a curve ---
  const path = (await native.createSpline([[X, 100, 0], [X + 40, 120, 0], [X + 80, 100, 0], [X + 120, 120, 0]])).created[0]!;
  const strung = await native.arrayCurve([cube.id], path.id, 5, "parallel");
  check("array_curve: copies along the curve, original included in the count", strung.created.length === 4 &&
    strung.created.every((b) => b.type === "Solid") &&
    strung.created.some((b) => boundsMatch(b, [X + 120, 20, 0], [X + 130, 30, 10], 0.01)) && strung.removedIds.length === 0,
    JSON.stringify(strung.created.map((b) => b.boundsMm?.min)));
  await native.undo();
  const half = await native.arrayCurve([cube.id], path.id, 4, "transport", 0, 1, 0.5);
  check("array_curve over a part of the curve", half.created.length === 3 &&
    half.created.every((b) => b.boundsMm!.max[0]! < X + 90), JSON.stringify(half.created.map((b) => b.boundsMm?.max)));
  await native.undo();
  const beads = await native.arrayCurve([cube.id], path.id, 3, "normal", 0, 1, 1, true);
  check("array_curve with instances", beads.created.length === 0 && beads.createdInstances?.length === 2,
    JSON.stringify(beads.createdInstances?.length));
  await native.undo();
  const selfPath = await failure(native.arrayCurve([path.id], path.id, 3));
  check("array_curve refuses its own path as an item", /path curve/.test(selfPath?.message ?? ""), selfPath?.message);
}

// Groups, visibility, isolation, locking, materials, selection of faces — drawn around x = 9000.
async function sceneChecks(native: NativeSession): Promise<void> {
  const X = 9000;
  const a = (await native.createBox([X, 0, 0], [10, 10, 10], "mcp-smoke-a")).created[0]!;
  const b = (await native.createBox([X + 20, 0, 0], [10, 10, 10], "mcp-smoke-b")).created[0]!;
  const c = (await native.createBox([X + 40, 0, 0], [10, 10, 10], "mcp-smoke-c")).created[0]!;
  const body = async (id: number) => (await native.state()).bodies.find((x) => x.id === id)!;

  // --- groups ---
  const groupsBefore = (await native.listGroups()).groups.length;
  const grouped = await native.groupBodies([a.id, b.id], "mcp-smoke-group");
  const group = grouped.created[0];
  check("group_bodies makes a named group under the scene", grouped.created.length === 1 &&
    group?.name === "mcp-smoke-group" && group.parentId === 0 &&
    group.bodyIds.join() === [a.id, b.id].sort((x, y) => x - y).join(), JSON.stringify(group));
  const joined = await native.moveToGroup([c.id], group!.id);
  check("move_to_group adds a body to the group",
    joined.groups.find((g) => g.id === group!.id)?.bodyIds.includes(c.id) === true &&
      joined.groups.find((g) => g.id === 0)?.bodyIds.includes(c.id) === false, JSON.stringify(joined.groups.map((g) => g.bodyIds)));
  const left = await native.moveToGroup([a.id], 0);
  check("move_to_group 0 returns a body to the scene",
    left.groups.find((g) => g.id === 0)?.bodyIds.includes(a.id) === true &&
      left.groups.find((g) => g.id === group!.id)?.bodyIds.includes(a.id) === false);
  await native.undo();
  await native.undo();
  const dissolved = await native.ungroup([group!.id]);
  check("ungroup dissolves the group and keeps its bodies", dissolved.removedIds.join() === String(group!.id) &&
    dissolved.groups.find((g) => g.id === 0)?.bodyIds.includes(a.id) === true &&
    (await native.state()).bodies.some((x) => x.id === b.id), JSON.stringify(dissolved.removedIds));
  await native.undo();
  await native.undo(); // the group
  check("undo removes the group", (await native.listGroups()).groups.length === groupsBefore);
  const scene = await failure(native.ungroup([0]));
  check("the scene itself cannot be ungrouped", /Unknown group id/.test(scene?.message ?? ""), scene?.message);
  const nowhere = await failure(native.moveToGroup([a.id], 424242));
  check("an unknown group is refused", /Unknown group id/.test(nowhere?.message ?? ""), nowhere?.message);

  // --- visibility, isolation, locking ---
  const hidden = await native.setVisibility([a.id], false);
  check("set_visibility hides a body", changed(hidden, a.id)?.visible === false, brief(hidden));
  const shown = await native.setVisibility([a.id], true);
  check("set_visibility shows it again", changed(shown, a.id)?.visible === true);
  await native.undo();
  check("undo of showing hides it again", (await body(a.id)).visible === false);
  const all = await native.unhideAll();
  check("unhide_all shows everything", changed(all, a.id)?.visible === true && (await body(b.id)).visible);
  await native.undo();
  await native.undo();

  const alone = await native.isolate([a.id]);
  check("isolate leaves only the given bodies visible", changed(alone, b.id)?.visible === false &&
    changed(alone, c.id)?.visible === false && (await body(a.id)).visible === true, brief(alone));
  const together = await native.unisolate();
  check("unisolate brings the others back", changed(together, b.id)?.visible === true && (await body(c.id)).visible);
  const nothing = await failure(native.unisolate());
  check("unisolate with nothing isolated is refused", /Nothing is isolated/.test(nothing?.message ?? ""), nothing?.message);
  await native.undo();
  await native.undo();

  const locked = await native.setLocked([a.id], true);
  check("set_locked locks a body", changed(locked, a.id)?.locked === true);
  const free = await native.unlockAll();
  check("unlock_all unlocks it", changed(free, a.id)?.locked === false);
  await native.undo();
  await native.undo();

  // --- materials ---
  const red = await native.createMaterial({ name: "mcp-smoke-red", color: "#cc2200", roughness: 0.4, metalness: 0.1, opacity: 1 });
  check("create_material adds a material", red.name === "mcp-smoke-red" && red.color === "#cc2200" &&
    Math.abs(red.roughness! - 0.4) < 1e-6, JSON.stringify(red));
  const painted = await native.setMaterial([a.id], red.id);
  check("set_material gives it to a body", changed(painted, a.id)?.materialId === red.id && (await body(b.id)).materialId === null);
  const bare = await native.removeMaterial([a.id]);
  check("remove_material takes it off", changed(bare, a.id)?.materialId === null && bare.undoDepth === painted.undoDepth + 1,
    brief(bare));
  const noSuch = await failure(native.setMaterial([a.id], 424242));
  check("unknown material id is refused", /Unknown material id/.test(noSuch?.message ?? ""), noSuch?.message);
  await native.undo();
  await native.undo();
  await native.undo();
  check("undo removes the material", !(await native.listMaterials()).some((m) => m.name === "mcp-smoke-red"));

  // --- selection of faces and edges ---
  const t = await native.topology(a.id);
  const topFace = faceBy(t, [0, 0, 1]);
  const anEdge = t.edges![0]!.id;
  const picked = await native.selectTopology(a.id, [topFace], [anEdge]);
  check("select_topology selects a face and an edge", picked.faces.length === 1 && picked.faces[0]?.id === a.id &&
    picked.faces[0].faceId === topFace && picked.edges[0]?.edgeId === anEdge && picked.bodyIds.length === 0,
    JSON.stringify(picked));
  const stale = await failure(native.selectTopology(a.id, ["nope"]));
  check("a stale face id leaves the selection as it was", /Stale or unknown face/.test(stale?.message ?? "") &&
    (await native.getSelectionDetail()).faces.length === 1, stale?.message);
  await native.selectBodies([b.id]);
  const whole = await native.getSelectionDetail();
  check("the selection reports whole bodies too", whole.bodyIds.join() === String(b.id) && whole.faces.length === 0,
    JSON.stringify(whole));
  await native.selectBodies([]);
}

// Check, open edges, measurements, continuity, section view — drawn around x = 10000.
async function measureChecks(native: NativeSession): Promise<void> {
  const X = 10000;
  const box = (await native.createBox([X, 0, 0], [40, 30, 20])).created[0]!;
  const rod = (await native.createCylinder([X + 100, 0, 0], 10, 30)).created[0]!;
  let t = await native.topology(box.id);

  const sound = await native.checkBodies([box.id, rod.id]);
  check("check_bodies finds a box and a cylinder valid", sound.length === 2 && sound.every((b) => b.valid && b.faultCodes.length === 0),
    JSON.stringify(sound));
  check("a Solid has no boundary edges", (await native.findBoundaryEdges(box.id)).count === 0);
  await native.deleteFaces(box.id, [faceBy(t, [0, 0, 1])], false);
  const rim = await native.findBoundaryEdges(box.id, true);
  const rimSelected = await native.getSelectionDetail();
  check("find_boundary_edges finds the rim of an opening and selects it", rim.count === 4 && rim.type === "Sheet" &&
    rimSelected.edges.length === 4 && rimSelected.edges.every((e) => rim.edgeIds.includes(e.edgeId)), JSON.stringify(rim));
  await native.selectBodies([]);
  await native.undo();
  const notShell = await failure(native.findBoundaryEdges((await native.createPolyline([[X, 200, 0], [X + 10, 200, 0]])).created[0]!.id));
  check("find_boundary_edges refuses a curve", /not a Solid or Sheet/.test(notShell?.message ?? ""), notShell?.message);

  // --- measurements kept in the document ---
  const measuresBefore = (await native.listMeasurements()).length;
  const diagonal = await native.addDistanceMeasurement(
    { id: box.id, pointMm: [X, 0, 20] }, { id: box.id, pointMm: [X + 40, 30, 20] }, "mcp-smoke-diagonal");
  const straight = diagonal.created[0];
  check("add_measurement: the straight distance between two vertices", straight?.kind === "distance" &&
    straight.name === "mcp-smoke-diagonal" && Math.abs(straight.valueMm! - 50) < 1e-3 &&
    straight.bodyIds.join() === String(box.id) && straight.axis === undefined, JSON.stringify(straight));
  const between = await native.addDistanceMeasurement(
    { id: box.id, pointMm: [X + 40, 15, 20] }, { id: rod.id, pointMm: [X + 100, 0, 30] });
  check("a measurement between two bodies: an edge middle and a circle centre",
    Math.abs(between.created[0]!.valueMm! - Math.hypot(60, 15, 10)) < 1e-3 &&
      between.created[0]!.bodyIds.length === 2, JSON.stringify(between.created[0]));
  const rt = await native.topology(rod.id, "edges");
  const topCircle = rt.edges!.find((e) => e.kind === "circle" && e.midMm[2] === 30)!.id;
  const radius = await native.addRadiusMeasurement(rod.id, topCircle);
  check("add_measurement: the radius of a circular edge", radius.created[0]?.kind === "radius" &&
    Math.abs(radius.created[0].valueMm! - 10) < 1e-6, JSON.stringify(radius.created[0]));
  check("list_measurements lists them", (await native.listMeasurements()).length === measuresBefore + 3);
  const dropped = await native.deleteMeasurements([straight!.id]);
  check("delete_measurements removes one", dropped.removedIds.join() === String(straight!.id) &&
    dropped.measurementCount === measuresBefore + 2);
  await native.undo();
  const nowhere = await failure(native.addDistanceMeasurement(
    { id: box.id, pointMm: [X + 7, 3, 20] }, { id: box.id, pointMm: [X + 40, 30, 20] }));
  check("a point that is not a landmark is refused with a hint", /no measurable point/.test(nowhere?.message ?? ""),
    nowhere?.message);
  const straightEdge = t.edges!.find((e) => e.kind === "line")!.id;
  const notRound = await failure(native.addRadiusMeasurement(box.id, straightEdge));
  check("a radius needs a circular edge", /not circular/.test(notRound?.message ?? ""), notRound?.message);
  const ghost = await failure(native.deleteMeasurements([424242]));
  check("unknown measurement id is refused", /Unknown measurement id/.test(ghost?.message ?? ""), ghost?.message);
  for (let i = 0; i < 3; i += 1) await native.undo();
  check("undo removes the measurements", (await native.listMeasurements()).length === measuresBefore);

  // --- continuity ---
  const upright = t.edges!.find((e) => e.kind === "line" && Math.abs(e.lengthMm - 20) < 1e-6)!.id;
  await native.filletEdges(box.id, [upright], 4);
  t = await native.topology(box.id);
  const round = t.faces!.find((f) => !f.planar)!.id;
  const seam = t.edges!.find((e) => e.kind === "line" && e.faceIds.includes(round))!.id;
  const corner = t.edges!.find((e) => e.kind === "line" && !e.faceIds.includes(round) && Math.abs(e.lengthMm - 20) < 1e-6)!.id;
  const depthBefore = (await native.state()).undoDepth;
  const smooth = await native.measureContinuity(box.id, [seam, corner]);
  check("measure_continuity: a fillet meets its neighbour tangent, a corner does not",
    smooth[0]?.continuity === "G1" && Math.abs(smooth[0].angleDeg!) < 0.01 &&
      smooth[1]?.continuity === "G0" && Math.abs(smooth[1].angleDeg! - 90) < 0.01 &&
      (await native.state()).undoDepth === depthBefore, JSON.stringify(smooth));
  await native.undo();

  // --- section view ---
  const cutaway = await native.setSectionView([X + 20, 0, 0], [1, 0, 0]);
  const plain = await native.clearSectionView();
  check("section view switches on and off without touching the history", cutaway.active === true &&
    plain.active === false && (await native.state()).undoDepth === depthBefore - 1);
}

main().catch((err) => {
  console.error("SMOKE ERROR:", (err as Error).message);
  process.exit(1);
});
