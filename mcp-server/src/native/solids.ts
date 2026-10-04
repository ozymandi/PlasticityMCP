/** Topology, boolean, fillet / chamfer, face extrusion. */

import { MM } from "./math.js";
import { ProfileTools } from "./profiles.js";
import { FIND_VIEW, commandFunction } from "./snippets.js";
import { BodyTopology, BooleanOperation, MutationResult } from "./types.js";

// Native operation codes, read from the running 26.1.3 app.
export const BOOLEAN_CODES: Record<BooleanOperation, number> = {
  intersection: 15901,
  difference: 15902,
  union: 15903,
};

// Runs with `this` = editor. Faces and edges of one Solid / Sheet, or the segments, vertices
// and control points of one curve, in millimetres.
export const READ_TOPOLOGY = `function (args) {
  ${FIND_VIEW}
  const round = (n) => Math.round(n * 1e9) / 1e9 + 0;
  const mm = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e6 + 0);
  const dir = (v) => [v.x, v.y, v.z].map(round);
  const len = (n) => Math.round(n * 1e9) / 1e6;
  const item = findItem(args.id);
  const view = item.view;
  const type = view?.constructor?.name ?? 'Unknown';
  if (type === 'Wire') {
    // A curve: segments between vertices, plus the control points of its splines.
    const byEntity = new Map();
    const modelEdges = item.model.GetEdges();
    for (let i = 0; i < modelEdges.Size(); i += 1) byEntity.set(modelEdges.Get(i).Id(), modelEdges.Get(i));
    const segments = [];
    const segmentIds = view.segments?.versionIds ?? [];
    for (let i = 0; i < segmentIds.length; i += 1) {
      const edge = byEntity.get(view.segments.get(i)?.entityId);
      if (!edge) continue;
      segments.push({
        id: String(segmentIds[i]),
        kind: edge.IsLine() ? 'line' : edge.IsCircle() ? 'circle' : 'curve',
        lengthMm: len(edge.FindLength().length),
        startMm: mm(edge.GetPointAndTangent(0).position),
        midMm: mm(edge.GetPointAndTangent(0.5).position),
        endMm: mm(edge.GetPointAndTangent(1).position),
      });
    }
    const micron = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e6) / 1e3 + 0);
    const points = (collection) => {
      const out = [];
      const ids = collection?.versionIds ?? collection?.ids ?? [];
      for (let i = 0; i < ids.length; i += 1) {
        const point = collection.get(i);
        // View positions are single precision; a micron is as fine as they are reliable.
        if (point?.position) out.push({ id: String(ids[i]), positionMm: micron(point.position) });
      }
      return out;
    };
    return {
      id: args.id,
      type,
      faceCount: 0,
      edgeCount: 0,
      closed: Boolean(item.model.IsClosed()),
      segments,
      vertices: points(view.vertices),
      controlPoints: points(view.cvs),
    };
  }
  if (type !== 'Solid' && type !== 'Sheet') {
    throw new Error('Body ' + args.id + ' is a ' + type + ' and has no topology to read');
  }
  const idsByEntity = (views) => {
    const map = new Map();
    const versionIds = views?.versionIds ?? [];
    for (let i = 0; i < versionIds.length; i += 1) {
      const v = views.get(i);
      if (v) map.set(v.entityId, String(versionIds[i]));
    }
    return map;
  };
  const faceIds = idsByEntity(view.high.faces);
  const edgeIds = idsByEntity(view.high.edges);
  const adjacent = (collection, ids) => {
    const out = [];
    for (let i = 0; i < (collection?.Size?.() ?? 0); i += 1) {
      const id = ids.get(collection.Get(i).Id());
      if (id) out.push(id);
    }
    return out;
  };
  const result = { id: args.id, type, faceCount: faceIds.size, edgeCount: edgeIds.size };

  if (args.include !== 'edges') {
    const faces = [];
    const modelFaces = item.model.GetFaces();
    for (let i = 0; i < modelFaces.Size(); i += 1) {
      const face = modelFaces.Get(i);
      const id = faceIds.get(face.Id());
      if (!id) continue;
      const midpoint = face.FindMidpoint();
      const radius = face.GetRadius();
      faces.push({
        id,
        surface: face.GetSurface()?.surface?.constructor?.name ?? 'Unknown',
        planar: Boolean(face.IsPlanar()),
        centerMm: mm(midpoint.position),
        normal: dir(midpoint.normal),
        ...(Number.isFinite(radius) && radius > 0 ? { radiusMm: len(radius) } : {}),
        edgeIds: adjacent(face.GetEdges(), edgeIds),
      });
    }
    result.faces = faces;
  }

  if (args.include !== 'faces') {
    const edges = [];
    const modelEdges = item.model.GetEdges();
    for (let i = 0; i < modelEdges.Size(); i += 1) {
      const edge = modelEdges.Get(i);
      const id = edgeIds.get(edge.Id());
      if (!id) continue;
      const circle = Boolean(edge.IsCircle());
      let radiusMm;
      if (circle) {
        try {
          const curve = edge.GetCurve();
          const radius = (curve?.curve ?? curve)?.GetInfo?.()?.radius;
          if (Number.isFinite(radius) && radius > 0) radiusMm = len(radius);
        } catch {}
      }
      edges.push({
        id,
        kind: edge.IsLine() ? 'line' : circle ? 'circle' : 'curve',
        lengthMm: len(edge.FindLength().length),
        startMm: mm(edge.GetPointAndTangent(0).position),
        midMm: mm(edge.GetPointAndTangent(0.5).position),
        endMm: mm(edge.GetPointAndTangent(1).position),
        ...(radiusMm === undefined ? {} : { radiusMm }),
        faceIds: adjacent(edge.GetFaces(), faceIds),
      });
    }
    result.edges = edges;
  }
  return result;
}`;

export class SolidTools extends ProfileTools {
  /**
   * Faces and edges of a Solid / Sheet. Their ids are valid only until the body changes:
   * re-read after every operation on it.
   */
  topology(id: number, include: "faces" | "edges" | "all" = "all"): Promise<BodyTopology> {
    return this.enqueue(() => this.call<BodyTopology>(READ_TOPOLOGY, [], [{ id, include }]));
  }

  /** Boolean of `toolIds` against `targetIds`. Tools are consumed unless `keepTools`. */
  boolean(
    operation: BooleanOperation,
    targetIds: number[],
    toolIds: number[],
    keepTools = false,
  ): Promise<MutationResult> {
    if (targetIds.some((id) => toolIds.includes(id))) {
      return Promise.reject(new Error("A body cannot be both a target and a tool"));
    }
    const setup = `
        factory.targets = args.targetIds.map(find);
        factory.tools = args.toolIds.map(find);
        factory.operationType = args.code;
        factory.keepTools = args.keepTools;`;
    return this.mutate(
      commandFunction("BooleanCommand", [], setup),
      ["BooleanFactory"],
      [{ targetIds, toolIds, code: BOOLEAN_CODES[operation], keepTools }],
    );
  }

  /** Round the given edges of one body with `radiusMm`. */
  filletEdges(id: number, edgeIds: string[], radiusMm: number): Promise<MutationResult> {
    return this.blendEdges(id, edgeIds, radiusMm * MM);
  }

  /** Bevel the given edges of one body by `distanceMm`. */
  chamferEdges(id: number, edgeIds: string[], distanceMm: number): Promise<MutationResult> {
    // Same native factory as fillet: a negative distance makes a chamfer.
    return this.blendEdges(id, edgeIds, -distanceMm * MM);
  }

  private blendEdges(id: number, edgeIds: string[], distance: number): Promise<MutationResult> {
    const setup = `
        const view = find(args.id);
        factory.shell = view;
        factory.edges = pick(view.high?.edges, args.edgeIds, 'edge');
        factory.distance = args.distance;`;
    return this.mutate(
      commandFunction("FilletShellCommand", [], setup),
      ["FilletShellFactory"],
      [{ id, edgeIds, distance }],
    );
  }

  /**
   * Extrude faces of one body along their normals. On a Solid this is a push / pull: positive
   * `distanceMm` adds material outward, negative cuts into the body, and the body keeps its id.
   * On a Sheet the extrusion becomes a new Solid and the Sheet is left as it is.
   */
  extrudeFaces(id: number, faceIds: string[], distanceMm: number): Promise<MutationResult> {
    // `targets` turns the extrusion into a boolean against the body; without it the result is
    // a separate Solid. A Sheet cannot be a boolean target here (PK_ERROR_boolean_failure).
    const setup = `
        const view = find(args.id);
        factory.faces = pick(view.high?.faces, args.faceIds, 'face');
        if (view.constructor.name === 'Solid') factory.targets = [view];
        factory.distance1 = args.distance;`;
    return this.mutate(
      commandFunction("ExtrudeCommand", [], setup),
      ["ExtrudeFactory"],
      [{ id, faceIds, distance: distanceMm * MM }],
    );
  }
}
