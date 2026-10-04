/** Faces and edges of one body, and Sheets: transform, offset, match, imprint, clean-up. */

import { withHint } from "./core.js";
import { EXTENSION_SHAPE_CODES, GAP_FILL_CODES } from "./curve-edit.js";
import { MM, toMeters } from "./math.js";
import {
  BUSY_GUARD,
  FIND_TYPED,
  FIND_VIEW,
  PICK_TOPOLOGY,
  STUCK_CHECK,
  commandFunction,
} from "./snippets.js";
import { PICK_FACES, SolidTools, describeTypes } from "./solids.js";
import {
  ExtensionShape,
  ImprintCompletion,
  ImprintSource,
  MutationResult,
  OffsetOptions,
  OffsetTarget,
  Vec3,
} from "./types.js";

// Completion of imprinted edges: the curve and the body imprints use different code families.
export const CURVE_COMPLETION_CODES: Record<ImprintCompletion, number> = {
  none: 25340,
  edge: 25341,
  boundary: 25343,
};
export const BODY_COMPLETION_CODES = { none: 22780, edge: 22781 };
export const PROJECTION_METHOD = { normal: 26520, vector: 26521 };

// Setup line shared by the edge tools: `args.id` is the body, `args.edgeIds` its edges.
const PICK_EDGES = `const view = typed(args.id, 'Solid', 'Sheet');
        factory.shell = view;
        factory.edges = pick(view.high.edges, args.edgeIds, 'edge');`;

// PICK_FACES plus the pivot: `args.pivot`, or the centre of the box around the faces' edges —
// for a planar face its middle, for a cylindrical one a point on its axis.
const FACES_WITH_PIVOT = `${PICK_FACES}
        let pivot = args.pivot;
        if (!pivot) {
          const wanted = new Set(pick(view.high.faces, args.faceIds, 'face').map((face) => face.entityId));
          const min = [Infinity, Infinity, Infinity];
          const max = [-Infinity, -Infinity, -Infinity];
          const modelFaces = findItem(args.id).model.GetFaces();
          for (let i = 0; i < modelFaces.Size(); i += 1) {
            const face = modelFaces.Get(i);
            if (!wanted.has(face.Id())) continue;
            const edges = face.GetEdges();
            for (let j = 0; j < edges.Size(); j += 1) {
              for (const at of [0, 0.25, 0.5, 0.75]) {
                const p = edges.Get(j).GetPointAndTangent(at).position;
                [p.x, p.y, p.z].forEach((value, k) => {
                  min[k] = Math.min(min[k], value);
                  max[k] = Math.max(max[k], value);
                });
              }
            }
          }
          pivot = min.map((value, k) => (value + max[k]) / 2);
          if (!pivot.every(Number.isFinite)) throw new Error('These faces have no edges to take a pivot from: pass pivot');
        }
        factory.pivot.fromArray(pivot);`;

export class FaceTools extends SolidTools {
  /** Move faces of one body by `deltaMm`; the neighbouring faces follow. */
  moveFaces(id: number, faceIds: string[], deltaMm: Vec3): Promise<MutationResult> {
    const setup = `
        ${PICK_FACES}
        factory.move.fromArray(args.delta);`;
    return this.mutate(
      commandFunction("MoveFaceCommand", [], setup),
      ["MultiMoveFaceFactory"],
      [{ id, faceIds, delta: toMeters(deltaMm) }],
    );
  }

  /**
   * Rotate faces of one body by `angleDeg` (right-hand rule) around `axis` through `pivotMm`.
   * Default pivot: the centre of the faces.
   */
  rotateFaces(
    id: number,
    faceIds: string[],
    axis: Vec3,
    angleDeg: number,
    pivotMm?: Vec3,
  ): Promise<MutationResult> {
    const setup = `
        ${FACES_WITH_PIVOT}
        factory.rotation.copy(
          new Quaternion().setFromAxisAngle(new Vector3(...args.axis).normalize(), args.radians),
        );`;
    return this.mutate(
      commandFunction("RotateFaceCommand", ["Vector3", "Quaternion"], setup),
      ["MultiRotateFaceFactory", "Vector3", "Quaternion"],
      [{ id, faceIds, axis, radians: (angleDeg * Math.PI) / 180, pivot: pivotMm ? toMeters(pivotMm) : null }],
    );
  }

  /**
   * Scale faces of one body by per-axis `factors` relative to `pivotMm` (default: the centre of
   * the faces). A flat face scaled in its own plane does not change: the plane stays the same.
   */
  scaleFaces(id: number, faceIds: string[], factors: Vec3, pivotMm?: Vec3): Promise<MutationResult> {
    const setup = `
        ${FACES_WITH_PIVOT}
        factory.scale.fromArray(args.factors);`;
    return this.mutate(
      commandFunction("ScaleFaceCommand", [], setup),
      ["MultiPlanarizingBasicScaleFaceFactory"],
      [{ id, faceIds, factors, pivot: pivotMm ? toMeters(pivotMm) : null }],
    );
  }

  /** Move edges of one body by `deltaMm`; the faces around them tilt to follow. */
  moveEdges(id: number, edgeIds: string[], deltaMm: Vec3): Promise<MutationResult> {
    const setup = `
        ${PICK_EDGES}
        factory.move.fromArray(args.delta);`;
    return this.mutate(
      commandFunction("MoveEdgeCommand", [], setup, true),
      ["MoveEdgeFactory", "MoveEdgeCommand"],
      [{ id, edgeIds, delta: toMeters(deltaMm) }],
    );
  }

  /**
   * Offset by `distanceMm`. Faces move along their normals and the neighbours follow. With
   * `loops` the outline of the faces is offset instead, and edges are offset across a face:
   * both leave new edges on the surface and move nothing.
   */
  offset(
    id: number,
    target: OffsetTarget,
    distanceMm: number,
    { bothSides = false, gapFill = "round" }: OffsetOptions = {},
  ): Promise<MutationResult> {
    const values = [{ id, ...target, distance: distanceMm * MM, bothSides, gapFill: GAP_FILL_CODES[gapFill] }];
    const onSurface = `
        factory.distance = args.distance;
        factory.lockDistances = args.bothSides;
        factory.gapFill = args.gapFill;`;
    if ("edgeIds" in target) {
      return this.mutate(
        commandFunction("OffsetEdgeCommand", [], `\n        ${PICK_EDGES}${onSurface}`),
        ["OffsetEdgeFactory"],
        values,
      );
    }
    if (target.loops) {
      return this.mutate(
        commandFunction("OffsetFaceLoopCommand", [], `\n        ${PICK_FACES}${onSurface}`),
        ["OffsetFaceLoopFactory"],
        values,
      );
    }
    const setup = `
        ${PICK_FACES}
        factory.distance = args.distance;`;
    return this.mutate(commandFunction("OffsetFaceCommand", [], setup), ["OffsetFaceFactory"], values);
  }

  /** Replace the surface of faces of one body with the surface of a face of any body. */
  matchFaces(id: number, faceIds: string[], targetId: number, targetFaceId: string): Promise<MutationResult> {
    const setup = `
        ${PICK_FACES}
        factory.replacement = pick(typed(args.targetId, 'Solid', 'Sheet').high.faces, [args.targetFaceId], 'face')[0];`;
    return this.mutate(
      commandFunction("MatchFaceCommand", [], setup),
      ["MatchFaceFactory"],
      [{ id, faceIds, targetId, targetFaceId }],
    );
  }

  /** Extend a Sheet past its boundary edges by `distanceMm`. */
  extendSheet(
    id: number,
    edgeIds: string[],
    distanceMm: number,
    shape: ExtensionShape = "linear",
  ): Promise<MutationResult> {
    const setup = `
        const view = typed(args.id, 'Sheet');
        factory.edges = pick(view.high.edges, args.edgeIds, 'edge');
        factory.distance = args.distance;
        factory.shape = args.shape;`;
    return this.mutate(
      commandFunction("ExtendSheetCommand", [], setup),
      ["ExtendSheetFactory"],
      [{ id, edgeIds, distance: distanceMm * MM, shape: EXTENSION_SHAPE_CODES[shape] }],
    );
  }

  /**
   * Restore faces to their whole underlying surface. Each face leaves the body as a Sheet of
   * its own; `keepEdges` imprints the old outline on it.
   */
  untrim(id: number, faceIds: string[], keepEdges = false): Promise<MutationResult> {
    const setup = `
        ${PICK_FACES}
        factory.keepEdges = args.keepEdges;`;
    return this.mutate(
      commandFunction("UntrimCommand", [], setup),
      ["UntrimFactory"],
      [{ id, faceIds, keepEdges }],
    );
  }

  /** Flip the direction of curves, or the normals of Sheets. */
  async reverse(ids: number[]): Promise<MutationResult> {
    const types = await this.typesOf(ids);
    if (types.every((type) => type === "Wire")) {
      return this.mutate(
        commandFunction("ReverseCurveCommand", [], `factory.curves = args.ids.map((id) => typed(id, 'Wire'));`, true),
        ["ReverseCurveFactory", "ReverseCurveCommand"],
        [{ ids }],
      );
    }
    if (types.every((type) => type === "Sheet")) {
      return this.mutate(
        commandFunction("ReverseSheetCommand", [], `factory.sheets = args.ids.map((id) => typed(id, 'Sheet'));`, true),
        ["ReverseSheetFactory", "ReverseSheetCommand"],
        [{ ids }],
      );
    }
    throw new Error(`Reverse takes either curves or Sheets, got: ${describeTypes(ids, types)}`);
  }

  /** Flatten faces into a new planar Sheet at the world origin; the body stays as it is. */
  unwrapFaces(id: number, faceIds: string[]): Promise<MutationResult> {
    return this.mutate(commandFunction("UnwrapFaceCommand", [], PICK_FACES), ["UnwrapFactory"], [{ id, faceIds }]);
  }

  /**
   * Add `count` edges along an isoparametric direction of one face. `param` (0..1) places a
   * single edge; several are spread evenly.
   */
  isoparam(
    id: number,
    faceId: string,
    direction: "u" | "v",
    param = 0.5,
    count = 1,
  ): Promise<MutationResult> {
    const setup = `
        const view = typed(args.id, 'Solid', 'Sheet');
        factory.shell = view;
        factory.face = pick(view.high.faces, [args.faceId], 'face')[0];
        factory.uOrV = args.u;
        factory.paramPoint = args.param;
        factory.count = args.count;`;
    return this.mutate(
      commandFunction("IsoparamCommand", [], setup),
      ["IsoparamFactory"],
      [{ id, faceId, u: direction === "u", param, count }],
    );
  }

  /** Extend edges that end inside a face until they reach its boundary, splitting the face. */
  completeEdges(id: number, edgeIds: string[]): Promise<MutationResult> {
    return this.nativeOnSelection("CompleteEdgeCommand", id, edgeIds);
  }

  /**
   * Add edges to a body without changing its shape: where curves project onto it, or where
   * other bodies cross it.
   */
  imprint(id: number, source: ImprintSource, completion: ImprintCompletion = "none"): Promise<MutationResult> {
    if ("curveIds" in source) {
      // Without a direction the curves drop onto the surface along its normals.
      const setup = `
        factory.target = typed(args.id, 'Solid', 'Sheet');
        factory.curves = args.curveIds.map((id) => typed(id, 'Wire'));
        factory.complete = args.complete;
        factory.method = args.method;
        if (args.direction) factory.direction = new Vector3(...args.direction).normalize();`;
      return this.mutate(
        commandFunction("ImprintCurveBodyCommand", ["Vector3"], setup),
        ["ImprintCurveBodyFactory", "Vector3"],
        [{
          id,
          curveIds: source.curveIds,
          direction: source.direction,
          complete: CURVE_COMPLETION_CODES[completion],
          method: source.direction ? PROJECTION_METHOD.vector : PROJECTION_METHOD.normal,
        }],
      );
    }
    if (completion === "boundary") {
      return Promise.reject(new Error("complete: boundary is for curves; bodies take none or edge"));
    }
    if (source.toolIds.includes(id)) {
      return Promise.reject(new Error("A body cannot be imprinted with itself"));
    }
    const setup = `
        factory.target = typed(args.id, 'Solid', 'Sheet');
        factory.tools = args.toolIds.map((id) => typed(id, 'Solid', 'Sheet'));
        factory.completeTarget = args.complete;
        factory.imprintTool = args.imprintTools;
        if (args.imprintTools) factory.completeTool = args.complete;`;
    return this.mutate(
      commandFunction("ImprintBodyBodyCommand", [], setup),
      ["ImprintBodyBodyFactory"],
      [{ id, toolIds: source.toolIds, imprintTools: source.imprintTools ?? false, complete: BODY_COMPLETION_CODES[completion] }],
    );
  }

  /**
   * Remove edges of one body and merge the faces they separate. Without `edgeIds` every
   * redundant edge of the body goes (Plasticity's Delete Redundant Topology); on a curve that
   * removes its redundant vertices.
   */
  dissolveEdges(id: number, edgeIds?: string[]): Promise<MutationResult> {
    if (!edgeIds) return this.nativeOnSelection("DeleteRedundantTopologyCommand", id);
    return withHint(
      this.mutate(
        commandFunction("DeleteEdgeCommand", [], PICK_EDGES, true),
        ["DeleteEdgeFactory", "DeleteEdgeCommand"],
        [{ id, edgeIds }],
      ),
      "PK_ERROR",
      "Only edges between faces of one surface can be dissolved.",
    );
  }

  /** Merge faces of one body that lie on the same surface into one face. */
  joinFaces(id: number, faceIds: string[]): Promise<MutationResult> {
    const setup = `
        ${PICK_FACES}
        factory.shell = view;`;
    return this.mutate(
      commandFunction("JoinFacesCommand", [], setup, true),
      ["JoinFacesFactory", "JoinFacesCommand"],
      [{ id, faceIds }],
    );
  }

  /** Change the radius of existing fillet faces: to `radiusMm`, or by `deltaMm`. */
  refillet(id: number, faceIds: string[], change: { radiusMm: number } | { deltaMm: number }): Promise<MutationResult> {
    // The factory's mode is 'delta' by default; any other value makes `distance` the radius.
    const setup = `
        ${PICK_FACES}
        factory.mode = args.mode;
        factory.distance = args.distance;`;
    const absolute = "radiusMm" in change;
    return this.mutate(
      commandFunction("RefilletFaceCommand", [], setup),
      ["RefilletFaceFactory"],
      [{ id, faceIds, mode: absolute ? "absolute" : "delta", distance: (absolute ? change.radiusMm : change.deltaMm) * MM }],
    );
  }

  /**
   * Copy faces of one body into a new Sheet, or with `solid` into a new Solid — the faces must
   * then enclose a volume. The body stays as it is.
   */
  duplicateFaces(id: number, faceIds: string[], solid = false): Promise<MutationResult> {
    if (!solid) {
      return this.mutate(
        commandFunction("CreateSolidFromFacesCommand", [], PICK_FACES),
        ["CreateSheetFromFacesFactory"],
        [{ id, faceIds }],
      );
    }
    const setup = `
        ${PICK_FACES}
        factory.shell = view;`;
    return withHint(
      this.mutate(
        commandFunction("CreateSolidFromFacesCommand", [], setup),
        ["CreateSolidFromFacesFactory"],
        [{ id, faceIds }],
      ),
      "dont_make_solid",
      "These faces do not enclose a volume; without solid: true they are copied as a Sheet.",
    );
  }

  /**
   * Run a native command as the UI would, on a selection made for it: the given edges, or the
   * whole body. For commands whose factory is not reachable. Leaves the selection empty.
   */
  private nativeOnSelection(commandName: string, id: number, edgeIds?: string[]): Promise<MutationResult> {
    return this.mutate(
      `async function (args) {
        ${BUSY_GUARD}
        ${FIND_VIEW}
        ${FIND_TYPED}
        ${PICK_TOPOLOGY}
        const view = args.edgeIds ? typed(args.id, 'Solid', 'Sheet') : find(args.id);
        const edges = args.edgeIds ? pick(view.high.edges, args.edgeIds, 'edge') : null;
        const selected = this.selection.selected;
        selected.removeAll();
        if (edges) for (const edge of edges) selected.addEdge(edge);
        else selected.add(view);
        let failure;
        let ran = false;
        const command = new this.commands.${commandName}(this);
        command.remember = false;
        const execute = command.execute.bind(command);
        command.execute = async function () {
          ran = true;
          try { return await execute(); }
          catch (error) { failure = error; throw error; }
        };
        // The command takes everything from the selection. Should it wait for more input
        // anyway, cancel it rather than leave the editor busy.
        let timer;
        const waiting = new Promise((resolve) => { timer = setTimeout(() => resolve('waiting'), 20000); });
        const outcome = await Promise.race([this.exec(command).then(() => 'done'), waiting]);
        clearTimeout(timer);
        if (outcome === 'waiting') this.executor.cancelActiveCommand();
        selected.removeAll();
        if (failure) throw failure;
        if (outcome === 'waiting') throw new Error('Plasticity waited for more input; the command was cancelled');
        ${STUCK_CHECK}
      }`,
      [],
      [{ id, edgeIds }],
    );
  }
}
