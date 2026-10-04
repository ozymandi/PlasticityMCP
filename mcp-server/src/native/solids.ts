/** Topology and the operations on Solids and Sheets: boolean, cut, faces, edges, patch, join. */

import { withHint } from "./core.js";
import { MM } from "./math.js";
import { ProfileTools } from "./profiles.js";
import { FIND_VIEW, commandFunction } from "./snippets.js";
import {
  BodyTopology,
  BooleanOperation,
  Cutter,
  FilletConvexity,
  MutationResult,
  PatchSource,
  Vec3,
} from "./types.js";

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

export const CONVEXITY_CODES: Record<FilletConvexity, number> = {
  any: 8600,
  convex: 8602,
  concave: 8603,
};

// Setup line shared by the face tools: `args.id` is the body, `args.faceIds` its faces.
const PICK_FACES = `const view = typed(args.id, 'Solid', 'Sheet');
        factory.faces = pick(view.high.faces, args.faceIds, 'face');`;

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

  /**
   * Cut Solids / Sheets into pieces. A curve cuts with the surface it sweeps along `direction`
   * (by default the normal of the curve's plane); `extend` lengthens a curve that stops short
   * of the body. Faces of another body cut with their whole surface. One piece keeps the id of
   * its target, the others are new; the cutters stay.
   */
  cut(targetIds: number[], cutter: Cutter, extend = false, direction?: Vec3): Promise<MutationResult> {
    const cutterBody = "id" in cutter ? cutter.id : undefined;
    if (cutterBody !== undefined && targetIds.includes(cutterBody)) {
      return Promise.reject(new Error("A body cannot be cut with its own faces"));
    }
    const setup = `
        factory.shells = args.targetIds.map((id) => typed(id, 'Solid', 'Sheet'));
        if (args.curveIds) {
          factory.curves = args.curveIds.map((id) => typed(id, 'Wire'));
          factory.shouldExtend = args.extend;
          if (args.direction) factory.direction = new Vector3(...args.direction).normalize();
        } else {
          factory.faces = pick(typed(args.id, 'Solid', 'Sheet').high.faces, args.faceIds, 'face');
        }`;
    return withHint(
      this.mutate(
        commandFunction("CutCommand", ["Vector3"], setup),
        ["MultiCutFactory", "Vector3"],
        [{ targetIds, ...cutter, extend, direction }],
      ),
      "Failed to cut body into sections",
      "The cutter does not divide the body: a curve has to cross it completely (extend: true lengthens it).",
    );
  }

  /**
   * Turn a Solid into a shell with walls of `thicknessMm`. With `faceIds` those faces are
   * removed and become the opening; without them the cavity is closed. The wall grows inward
   * from the existing faces, or outward with `outward`.
   */
  hollow(id: number, thicknessMm: number, faceIds?: string[], outward = false): Promise<MutationResult> {
    // The native sign convention: negative is inward.
    const thickness = (outward ? thicknessMm : -thicknessMm) * MM;
    if (faceIds) {
      const setup = `
        const view = typed(args.id, 'Solid');
        factory.faces = pick(view.high.faces, args.faceIds, 'face');
        factory.thickness = args.thickness;`;
      return this.mutate(
        commandFunction("HollowFacesCommand", [], setup),
        ["HollowFacesFactory"],
        [{ id, faceIds, thickness }],
      );
    }
    const setup = `
        factory.solids = [typed(args.id, 'Solid')];
        factory.thickness = args.thickness;`;
    return this.mutate(
      commandFunction("HollowSolidsCommand", [], setup),
      ["HollowSolidsFactory"],
      [{ id, thickness }],
    );
  }

  /**
   * Give thickness. A Sheet becomes a Solid and keeps its id. With `faceIds`, those faces of a
   * Solid or Sheet are thickened into a new Solid and the body stays as it is. `frontMm` goes
   * along the face normals, `backMm` against them.
   */
  thicken(id: number, frontMm: number, backMm: number, faceIds?: string[]): Promise<MutationResult> {
    const values = [{ id, faceIds, front: frontMm * MM, back: backMm * MM }];
    if (faceIds) {
      const setup = `
        ${PICK_FACES}
        factory.front = args.front;
        factory.back = args.back;`;
      return this.mutate(commandFunction("ThickenFaceCommand", [], setup), ["ThickenFaceFactory"], values);
    }
    const setup = `
        factory.sheets = [typed(args.id, 'Sheet')];
        factory.front = args.front;
        factory.back = args.back;`;
    return this.mutate(commandFunction("ThickenSheetCommand", [], setup), ["ThickenSheetFactory"], values);
  }

  /** Move faces of one body along their normals by `distanceMm`; neighbours follow. */
  offsetFaces(id: number, faceIds: string[], distanceMm: number): Promise<MutationResult> {
    const setup = `
        ${PICK_FACES}
        factory.distance = args.distance;`;
    return this.mutate(
      commandFunction("OffsetFaceCommand", [], setup),
      ["OffsetFaceFactory"],
      [{ id, faceIds, distance: distanceMm * MM }],
    );
  }

  /**
   * Tilt faces of one body by `angleDeg` (draft angle). The faces pivot where they meet the
   * plane of `referenceFaceId`, a planar face of the same body that itself stays in place.
   */
  draftFaces(
    id: number,
    faceIds: string[],
    referenceFaceId: string,
    angleDeg: number,
  ): Promise<MutationResult> {
    if (faceIds.includes(referenceFaceId)) {
      return Promise.reject(new Error("The reference face cannot be one of the drafted faces"));
    }
    const setup = `
        ${PICK_FACES}
        factory.reference = pick(view.high.faces, [args.referenceFaceId], 'face')[0];
        factory.degrees = args.degrees;`;
    return this.mutate(
      commandFunction("DraftFaceCommand", [], setup),
      ["DraftFaceFactory"],
      [{ id, faceIds, referenceFaceId, degrees: angleDeg }],
    );
  }

  /**
   * Remove faces of one body. With `heal` the neighbouring faces are extended to close the gap
   * (Plasticity's Dissolve) and a Solid stays a Solid; without it the faces are just taken out
   * (Delete Face) and a Solid becomes an open Sheet.
   */
  deleteFaces(id: number, faceIds: string[], heal = true): Promise<MutationResult> {
    if (!heal) {
      return this.mutate(
        commandFunction("DeleteFaceCommand", [], PICK_FACES, true),
        ["DeleteFaceFactory", "DeleteFaceCommand"],
        [{ id, faceIds }],
      );
    }
    return withHint(
      this.mutate(
        commandFunction("DissolveFaceCommand", [], PICK_FACES, true),
        ["DissolveFaceFactory", "DissolveFaceCommand"],
        [{ id, faceIds }],
      ),
      "PK_ERROR",
      "The neighbouring faces cannot close this gap; heal: false removes the faces and leaves a hole.",
    );
  }

  /**
   * Close with a surface. Closed curves and regions give new Sheets, one per loop. For a body,
   * `edgeIds` (a closed loop of edges) picks one hole; without them every hole of a Sheet is
   * capped. A Sheet that becomes watertight turns into a Solid.
   */
  patch(source: PatchSource): Promise<MutationResult> {
    if ("curveIds" in source) {
      const setup = `
        factory.curves = args.curveIds.map((id) => {
          const item = findItem(id);
          typed(id, 'Wire');
          if (!item.model?.IsClosed?.()) throw new Error('Curve ' + id + ' is not closed');
          return item.view;
        });`;
      return this.mutate(
        commandFunction("PatchHoleInCurveCommand", [], setup, true),
        ["PatchHoleInWireFactory", "PatchHoleInCurveCommand"],
        [source],
      );
    }
    if ("regionIds" in source) {
      return this.mutate(
        commandFunction("PatchRegionCommand", [], `factory.regions = pickRegions(args.regionIds);`, true),
        ["PatchRegionFactory", "PatchRegionCommand"],
        [source],
      );
    }
    if (!source.edgeIds) {
      return withHint(
        this.mutate(
          commandFunction("PatchHolesInSheetCommand", [], `factory.sheets = [typed(args.id, 'Sheet')];`, true),
          ["CapHolesInSheetFactory", "PatchHolesInSheetCommand"],
          [source],
        ),
        "LocalCheck",
        "The Sheet has no holes that can be capped.",
      );
    }
    // The edges of a hole in a Sheet are filled in place; edges of a Solid give a separate Sheet.
    return this.enqueue(() => this.call<string>(`function (args) {
        ${FIND_VIEW}
        return find(args.id).constructor.name;
      }`, [], [source])).then((type) => {
      if (type !== "Solid" && type !== "Sheet") {
        throw new Error(`Body ${source.id} is a ${type === "Wire" ? "curve" : type}, not a Solid or Sheet`);
      }
      const onSheet = type === "Sheet";
      const setup = onSheet
        ? `const view = typed(args.id, 'Sheet');
        factory.sheet = view;
        factory.edges = pick(view.high.edges, args.edgeIds, 'edge');`
        : `const view = typed(args.id, 'Solid');
        factory.edges = pick(view.high.edges, args.edgeIds, 'edge');`;
      return withHint(
        this.mutate(
          commandFunction(onSheet ? "PatchHoleInSheetCommand" : "PatchHoleInSolidCommand", [], setup, true),
          onSheet
            ? ["PatchHoleInSheetFactory", "PatchHoleInSheetCommand"]
            : ["PatchHoleInSolidFactory", "PatchHoleInSolidCommand"],
          [source],
        ),
        "fill_hole",
        "The edges must form one closed loop around an opening.",
      );
    });
  }

  /**
   * Round tubes along curves. `diameterMm` is the diameter of a solid rod; with
   * `wallThicknessMm` the rod becomes a tube: the bore keeps `diameterMm` and the wall is
   * added around it.
   */
  pipe(ids: number[], diameterMm: number, wallThicknessMm = 0): Promise<MutationResult> {
    const setup = `
        factory.spines = args.ids.map((id) => typed(id, 'Wire'));
        factory.diameter = args.diameter;
        factory.thickness = args.thickness;`;
    return this.mutate(
      commandFunction("PipeCommand", [], setup),
      ["PipeFactory"],
      [{ ids, diameter: diameterMm * MM, thickness: wallThicknessMm * MM }],
    );
  }

  /** Remove the fillets of Solids / Sheets, optionally only those up to `maxRadiusMm` or of one convexity. */
  removeFillets(
    ids: number[],
    maxRadiusMm?: number,
    convexity: FilletConvexity = "any",
  ): Promise<MutationResult> {
    // A radius of 0 means no limit.
    const setup = `
        factory.shells = args.ids.map((id) => typed(id, 'Solid', 'Sheet'));
        factory.radius = args.radius;
        factory.convexity = args.convexity;`;
    return withHint(
      this.mutate(
        commandFunction("RemoveFilletsFromShellCommand", [], setup),
        ["RemoveFilletsFromShellFactory"],
        [{ ids, radius: (maxRadiusMm ?? 0) * MM, convexity: CONVEXITY_CODES[convexity] }],
      ),
      "PK_FACE_delete_facesets",
      "No fillets matched (check maxRadius and convexity), or they cannot be removed.",
    );
  }

  /**
   * Join curves that touch end to end into one curve, or Sheets that share edges into one
   * Sheet — a Solid when they close a volume. The result keeps the first id.
   */
  async join(ids: number[]): Promise<MutationResult> {
    const types = await this.typesOf(ids);
    if (types.every((type) => type === "Wire")) return this.joinCurves(ids);
    if (types.every((type) => type === "Sheet")) return this.joinSheets(ids);
    throw new Error(`Join takes either curves or Sheets, got: ${describeTypes(ids, types)}`);
  }

  private joinSheets(ids: number[]): Promise<MutationResult> {
    return withHint(
      this.mutate(
        commandFunction("JoinSheetsCommand", [], `factory.sheets = args.ids.map((id) => typed(id, 'Sheet'));`),
        ["JoinSheetsFactory"],
        [{ ids }],
      ),
      "Operation has no effect",
      "Nothing was joined: the Sheets must share edges.",
    );
  }

  /**
   * Take apart: a curve into its segments, a Solid / Sheet into one Sheet per face. One piece
   * keeps the id, the others are new.
   */
  async unjoin(ids: number[]): Promise<MutationResult> {
    const types = await this.typesOf(ids);
    if (types.every((type) => type === "Wire")) {
      return this.mutate(
        commandFunction("UnjoinCurvesCommand", [], `factory.curves = args.ids.map((id) => typed(id, 'Wire'));`),
        ["UnjoinCurvesFactory"],
        [{ ids }],
      );
    }
    if (types.every((type) => type === "Solid" || type === "Sheet")) {
      return this.mutate(
        commandFunction(
          "UnjoinShellsCommand",
          [],
          `factory.shells = args.ids.map((id) => typed(id, 'Solid', 'Sheet'));`,
        ),
        ["UnjoinShellsFactory"],
        [{ ids }],
      );
    }
    throw new Error(`Unjoin takes either curves or Solids / Sheets, got: ${describeTypes(ids, types)}`);
  }

  /** Detach faces of one body: each becomes a Sheet of its own and the body is left open. */
  unjoinFaces(id: number, faceIds: string[]): Promise<MutationResult> {
    return this.mutate(
      commandFunction("UnjoinFacesCommand", [], PICK_FACES),
      ["UnjoinFacesFactory"],
      [{ id, faceIds }],
    );
  }

  private async typesOf(ids: number[]): Promise<string[]> {
    if (new Set(ids).size !== ids.length) throw new Error("Body ids must be distinct");
    const state = await this.state();
    return ids.map((id) => {
      const body = state.bodies.find((b) => b.id === id);
      if (!body) throw new Error(`Unknown body id: ${id}`);
      return body.type;
    });
  }
}

const describeTypes = (ids: number[], types: string[]): string =>
  ids.map((id, i) => `${id} (${types[i] === "Wire" ? "curve" : types[i]})`).join(", ");
