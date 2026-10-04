/** Editing curves: trim, cut, bridge, rebuild, vertices and control points, offsets, deform. */

import { withHint } from "./core.js";
import { MM, toMeters } from "./math.js";
import { ProfileTools } from "./profiles.js";
import { commandFunction } from "./snippets.js";
import {
  Continuity,
  CurvePoints,
  CurveRebuild,
  ExtensionShape,
  FaceRef,
  GapFill,
  MutationResult,
  SlideDirection,
  Vec3,
} from "./types.js";

// Native codes, read from the running 26.1.3 app.
export const GAP_FILL_CODES: Record<GapFill, number> = { round: 21220, linear: 21221, natural: 21222 };

export const EXTENSION_SHAPE_CODES: Record<ExtensionShape, number> = {
  linear: 22750,
  soft: 22751,
  reflective: 22752,
  natural: 22753,
};

const SLIDE_DIRECTIONS: Record<SlideDirection, string> = {
  forward: "posU",
  backward: "negU",
  normal: "normal",
};

const CURVES = `factory.curves = args.ids.map((id) => typed(id, 'Wire'));`;

// Setup lines shared by the vertex tools: `args.id` is the curve, `args.vertexIds` its vertices.
const PICK_VERTICES = `const view = typed(args.id, 'Wire');
        factory.vertices = pick(view.vertices, args.vertexIds, 'vertex');`;

// Vertices and control points of one curve, as the point factories take them; `points` holds
// them all, for a default pivot.
const PICK_POINTS = `const view = typed(args.id, 'Wire');
        const cvs = args.controlPointIds ? pick(view.cvs, args.controlPointIds, 'control point') : [];
        const vertices = args.vertexIds ? pick(view.vertices, args.vertexIds, 'vertex') : [];
        if (cvs.length > 0) factory.cvs = cvs;
        if (vertices.length > 0) factory.vertices = vertices;
        const points = [...cvs, ...vertices];`;

const POINTS_PIVOT = `
        const pivot = args.pivot ?? ['x', 'y', 'z'].map((k) => points.reduce((sum, p) => sum + p.position[k], 0) / points.length);
        factory.pivot.fromArray(pivot);`;

const pointArgs = (id: number, points: CurvePoints) => ({
  id,
  controlPointIds: points.controlPointIds?.length ? points.controlPointIds : null,
  vertexIds: points.vertexIds?.length ? points.vertexIds : null,
});

export class CurveEditTools extends ProfileTools {
  /**
   * Remove one piece of a curve: the piece nearest to `nearMm`. Pieces end at the corners of
   * the curve and where other curves cross it.
   */
  trimCurve(id: number, nearMm: Vec3): Promise<MutationResult> {
    const setup = `
        const view = typed(args.id, 'Wire');
        let best = null;
        for (const info of editor.fragments.read.modelId2info.values()) {
          const ancestor = editor.geo.geometryModel.get(info.ancestorViewId);
          if (ancestor?.view !== view && editor.db.lookupStableId(info.ancestorViewId) !== args.id) continue;
          const fragment = editor.geo.geometryModel.get(info.fragmentViewId);
          for (const segment of Array.from(fragment?.view?.segments ?? [])) {
            const middle = editor.db.lookupTopologyItem(segment).GetPointAndTangent(0.5).position;
            const distance = Math.hypot(middle.x - args.near[0], middle.y - args.near[1], middle.z - args.near[2]);
            if (!best || distance < best.distance) best = { segment, distance };
          }
        }
        if (!best) throw new Error('Curve ' + args.id + ' has no pieces to trim');
        factory.segments = [best.segment];`;
    return this.mutate(commandFunction("TrimCommand", [], setup), ["TrimFactory"], [{ id, near: toMeters(nearMm) }]);
  }

  /** Cut curves where the cutter curves cross them. One piece keeps the id, the others are new. */
  protected cutCurves(targetIds: number[], cutterIds: number[]): Promise<MutationResult> {
    const setup = `
        factory.targets = args.targetIds.map((id) => typed(id, 'Wire'));
        factory.curves = args.cutterIds.map((id) => typed(id, 'Wire'));`;
    return withHint(
      this.mutate(
        commandFunction("CutCurveCommand", [], setup),
        ["MultiCurveCutFactory"],
        [{ targetIds, cutterIds }],
      ),
      /Operation has no effect|PK_ERROR/,
      "The cutter curves must cross the curves to cut.",
    );
  }

  /** Add a control point in the middle of every segment; lines become editable splines. */
  subdivideCurves(ids: number[]): Promise<MutationResult> {
    return this.mutate(
      commandFunction("SubdivideCurveCommand", [], CURVES, true),
      ["SubdivideCurveFactory", "SubdivideCurveCommand"],
      [{ ids }],
    );
  }

  /** Raise the degree of curves by one: more control points, same shape. */
  raiseDegree(ids: number[]): Promise<MutationResult> {
    return this.mutate(
      commandFunction("RaiseDegreeCurveCommand", [], CURVES, true),
      ["RaiseDegreeCurveFactory", "RaiseDegreeCurveCommand"],
      [{ ids }],
    );
  }

  /**
   * Refit curves as clean splines: within a tolerance, with a number of points, or with a
   * degree and a number of spans. `keepCorners` keeps sharp corners sharp.
   */
  rebuildCurves(ids: number[], how: CurveRebuild, keepCorners = true): Promise<MutationResult> {
    const settings =
      "toleranceMm" in how
        ? { method: 0, tolerance: how.toleranceMm * MM }
        : "pointCount" in how
          ? { method: 1, pointCount: how.pointCount }
          : { method: 2, degree: how.degree, spans: how.spans };
    const setup = `
        ${CURVES}
        factory.keepCorners = args.keepCorners;
        Object.assign(factory, args.settings);`;
    return this.mutate(
      commandFunction("RebuildCurveCommand", [], setup),
      ["RebuildCurveFactory"],
      [{ ids, keepCorners, settings }],
    );
  }

  /** Turn corner vertices of a curve into smooth ones: the segments around them become one spline. */
  convertVertices(id: number, vertexIds: string[]): Promise<MutationResult> {
    return this.mutate(
      commandFunction("ConvertVertexCommand", [], PICK_VERTICES),
      ["ConvertVertexFactory"],
      [{ id, vertexIds }],
    );
  }

  /**
   * Bring the end vertex of one curve onto a vertex of another, with the given continuity
   * there. The first curve moves.
   */
  alignVertex(
    id: number,
    vertexId: string,
    targetId: number,
    targetVertexId: string,
    continuity: Continuity = "G1",
  ): Promise<MutationResult> {
    const setup = `
        factory.moving = pick(typed(args.id, 'Wire').vertices, [args.vertexId], 'vertex')[0];
        factory.target = pick(typed(args.targetId, 'Wire').vertices, [args.targetVertexId], 'vertex')[0];
        factory.continuity = ContinuityType[args.continuity];`;
    return this.mutate(
      commandFunction("AlignVertexCommand", ["ContinuityType"], setup, true),
      ["AlignVertexFactory", "AlignVertexCommand", "ContinuityType"],
      [{ id, vertexId, targetId, targetVertexId, continuity }],
    );
  }

  /**
   * A new curve between two curve vertices, or between the nearest ends of two body edges,
   * leaving each with the given continuity.
   */
  bridge(
    first: { id: number; vertexId: string } | { id: number; edgeId: string },
    second: { id: number; vertexId: string } | { id: number; edgeId: string },
    startContinuity: Continuity = "G2",
    endContinuity: Continuity = startContinuity,
  ): Promise<MutationResult> {
    const values = [{ first, second, startContinuity, endContinuity }];
    const continuity = `
        factory.startCurvature = ContinuityType[args.startContinuity];
        factory.endCurvature = ContinuityType[args.endContinuity];`;
    if ("vertexId" in first && "vertexId" in second) {
      const setup = `
        const vertex = (ref) => pick(typed(ref.id, 'Wire').vertices, [ref.vertexId], 'vertex')[0];
        factory.vertex1 = vertex(args.first);
        factory.vertex2 = vertex(args.second);${continuity}`;
      return this.mutate(
        commandFunction("BridgeVertexCommand", ["ContinuityType"], setup),
        ["BridgeVertexFactory", "ContinuityType"],
        values,
      );
    }
    if ("edgeId" in first && "edgeId" in second) {
      const setup = `
        const edge = (ref) => pick(typed(ref.id, 'Solid', 'Sheet').high.edges, [ref.edgeId], 'edge')[0];
        factory.edge1 = edge(args.first);
        factory.edge2 = edge(args.second);
        factory.pickClosestVertices();${continuity}`;
      return this.mutate(
        commandFunction("BridgeEdgeCommand", ["ContinuityType"], setup),
        ["BridgeEdgeFactory", "ContinuityType"],
        values,
      );
    }
    return Promise.reject(new Error("Bridge takes two curve vertices or two body edges, not one of each"));
  }

  /** Move vertices and control points of one curve by `deltaMm`. */
  moveControlPoints(id: number, points: CurvePoints, deltaMm: Vec3): Promise<MutationResult> {
    const setup = `
        ${PICK_POINTS}
        factory.move.fromArray(args.delta);`;
    return this.mutate(
      commandFunction("MoveControlPointCommand", [], setup),
      ["MultiMoveControlPointFactory"],
      [{ ...pointArgs(id, points), delta: toMeters(deltaMm) }],
    );
  }

  /** Rotate vertices and control points of one curve about `axis` through `pivotMm` (default: their centre). */
  rotateControlPoints(
    id: number,
    points: CurvePoints,
    axis: Vec3,
    angleDeg: number,
    pivotMm?: Vec3,
  ): Promise<MutationResult> {
    const setup = `
        ${PICK_POINTS}${POINTS_PIVOT}
        factory.rotation.copy(
          new Quaternion().setFromAxisAngle(new Vector3(...args.axis).normalize(), args.radians),
        );`;
    return this.mutate(
      commandFunction("RotateControlPointCommand", ["Vector3", "Quaternion"], setup),
      ["MultiRotateControlPointFactory", "Vector3", "Quaternion"],
      [{
        ...pointArgs(id, points),
        axis,
        radians: (angleDeg * Math.PI) / 180,
        pivot: pivotMm ? toMeters(pivotMm) : null,
      }],
    );
  }

  /** Scale vertices and control points of one curve about `pivotMm` (default: their centre). */
  scaleControlPoints(id: number, points: CurvePoints, factors: Vec3, pivotMm?: Vec3): Promise<MutationResult> {
    const setup = `
        ${PICK_POINTS}${POINTS_PIVOT}
        factory.scale.fromArray(args.factors);`;
    return this.mutate(
      commandFunction("ScaleControlPointCommand", [], setup),
      ["MultiScaleControlPointFactory"],
      [{ ...pointArgs(id, points), factors, pivot: pivotMm ? toMeters(pivotMm) : null }],
    );
  }

  /**
   * Slide control points of a spline along its control polygon (`forward` / `backward`) or
   * across it (`normal`) by `distanceMm`.
   */
  slideControlPoints(
    id: number,
    points: CurvePoints,
    distanceMm: number,
    direction: SlideDirection = "forward",
  ): Promise<MutationResult> {
    const setup = `
        ${PICK_POINTS}
        factory.direction = args.direction;
        factory.distance = args.distance;`;
    return this.mutate(
      commandFunction("MoveControlPointCommand", [], setup),
      ["MultiSlideControlPointFactory"],
      [{ ...pointArgs(id, points), direction: SLIDE_DIRECTIONS[direction], distance: distanceMm * MM }],
    );
  }

  /** Delete control points of a spline; the curve is refitted through what is left. */
  deleteControlPoints(id: number, points: CurvePoints): Promise<MutationResult> {
    const setup = `
        ${PICK_POINTS}
        factory.curve = view;`;
    return this.mutate(
      commandFunction("DeleteControlPointCommand", [], setup, true),
      ["DeleteControlPointFactory", "DeleteControlPointCommand"],
      [pointArgs(id, points)],
    );
  }

  /** Copy edges of one body as curves; edges that touch come out as one curve. */
  curvesFromEdges(id: number, edgeIds: string[]): Promise<MutationResult> {
    const setup = `factory.edges = pick(typed(args.id, 'Solid', 'Sheet').high.edges, args.edgeIds, 'edge');`;
    return this.mutate(
      commandFunction("CurveCommand", [], setup),
      ["CreateCurveFromEdgesFactory"],
      [{ id, edgeIds }],
    );
  }

  /**
   * Wrap curves that lie on (or near) one face onto another face, keeping their place in the
   * face's own coordinates. With `keepOriginals` the flat curves stay.
   */
  deformCurves(
    ids: number[],
    source: FaceRef,
    target: FaceRef,
    keepOriginals = false,
  ): Promise<MutationResult> {
    const setup = `
        const face = (ref) => pick(typed(ref.id, 'Solid', 'Sheet').high.faces, [ref.faceId], 'face')[0];
        ${CURVES}
        factory.sourceFace = face(args.source);
        factory.targetFace = face(args.target);
        factory.keepTools = args.keepOriginals;`;
    return this.mutate(
      commandFunction("DeformCurveCommand", [], setup, true),
      ["DeformCurveFactory", "DeformCurveCommand"],
      [{ ids, source, target, keepOriginals }],
    );
  }

  /** New curves parallel to planar curves at `distanceMm`; the sign picks the side. */
  offsetCurves(
    ids: number[],
    distanceMm: number,
    bothSides = false,
    gapFill: GapFill = "round",
  ): Promise<MutationResult> {
    const setup = `
        ${CURVES}
        factory.distance1 = args.distance;
        factory.lockDistances = args.bothSides;
        if (args.bothSides) factory.distance2 = args.distance;
        factory.gapFill = args.gapFill;`;
    return this.mutate(
      commandFunction("OffsetPlanarCurveCommand", [], setup),
      ["OffsetPlanarCurvesFactory"],
      [{ ids, distance: distanceMm * MM, bothSides, gapFill: GAP_FILL_CODES[gapFill] }],
    );
  }

  /** New curves along the outline of regions, offset by `distanceMm` (positive outward). */
  offsetRegions(regionIds: string[], distanceMm: number, gapFill: GapFill = "round"): Promise<MutationResult> {
    const setup = `
        const regions = pickRegions(args.regionIds);
        let sketch = null;
        for (const [, candidate] of editor.geo.geometryModel) {
          if (candidate.view?.constructor?.name !== 'SketchIsland') continue;
          const own = new Set();
          for (let i = 0; i < (candidate.view.regions?.length ?? 0); i += 1) {
            own.add(String(candidate.view.regions.get(i)?.versionId));
          }
          if (!args.regionIds.some((id) => own.has(String(id)))) continue;
          if (!args.regionIds.every((id) => own.has(String(id)))) {
            throw new Error('The regions must belong to one group of touching curves');
          }
          sketch = candidate.view;
        }
        factory.sketch = sketch;
        factory.regions = regions;
        factory.distance1 = args.distance;
        factory.gapFill = args.gapFill;`;
    return this.mutate(
      commandFunction("OffsetRegionCommand", [], setup),
      ["OffsetRegionFactory"],
      [{ regionIds, distance: distanceMm * MM, gapFill: GAP_FILL_CODES[gapFill] }],
    );
  }

  /** Insert new vertices on both sides of vertices of a curve, `distanceMm` away along it. */
  offsetVertices(id: number, vertexIds: string[], distanceMm: number): Promise<MutationResult> {
    const setup = `
        ${PICK_VERTICES}
        factory.distance = args.distance;`;
    return this.mutate(
      commandFunction("OffsetVertexCommand", [], setup),
      ["OffsetVertexFactory"],
      [{ id, vertexIds, distance: distanceMm * MM }],
    );
  }

  /**
   * Round the corners of a curve with `radiusMm`: the given vertices, or all of them. A
   * negative radius cuts the corner straight instead (a chamfer of that size along each side).
   */
  filletCurve(id: number, radiusMm: number, vertexIds?: string[]): Promise<MutationResult> {
    if (vertexIds) {
      const setup = `
        ${PICK_VERTICES}
        factory.radius = args.radius;`;
      return this.mutate(
        commandFunction("FilletVertexCommand", [], setup),
        ["FilletVertexFactory"],
        [{ id, vertexIds, radius: radiusMm * MM }],
      );
    }
    const setup = `
        factory.curves = [typed(args.id, 'Wire')];
        factory.radius = args.radius;`;
    return this.mutate(
      commandFunction("FilletCurveCommand", [], setup),
      ["FilletCurveFactory"],
      [{ id, radius: radiusMm * MM }],
    );
  }

  /** Lengthen a curve past its end vertices by `distanceMm`. */
  extendCurve(id: number, vertexIds: string[], distanceMm: number, shape?: ExtensionShape): Promise<MutationResult> {
    const setup = `
        ${PICK_VERTICES}
        factory.distance = args.distance;
        if (args.shape) factory.shape = args.shape;`;
    return withHint(
      this.mutate(
        commandFunction("ExtendCurveCommand", [], setup),
        ["MultiExtendVertexFactory"],
        [{ id, vertexIds, distance: distanceMm * MM, shape: shape ? EXTENSION_SHAPE_CODES[shape] : null }],
      ),
      "PK_ERROR",
      "Only the free end vertices of an open curve can be extended.",
    );
  }
}
