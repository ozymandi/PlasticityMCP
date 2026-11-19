/** Surfaces: blends between sheets, a surface through points, degree, rebuild, deform. */

import { withHint } from "./core.js";
import { MM, toMeters } from "./math.js";
import { ProjectionTools } from "./projection.js";
import { commandFunction } from "./snippets.js";
import { deformArgs } from "./curve-edit.js";
import { PICK_FACES } from "./solids.js";
import { BLEND_SHAPE_CODES, BLEND_TRIM_CODES, BlendTrim, LOFT_TANGENCY_CODES, LoftTangency } from "./enums.js";
import { BlendShape, DeformOptions, FaceRef, LoftEnd, MutationResult, ProfileRef, Vec3 } from "./types.js";

// Native codes, read from the running 26.1.3 app.
const SURFACE_OPTIMIZATION = { performance: 24870, smoothness: 24871 };
const REBUILD_FACE_REFIT = 0;
const CHANGE_EDGE_PROJECT = 25723;

export class SurfaceTools extends ProjectionTools {
  /**
   * Blend two Sheets into one with a transition surface `widthMm` wide between a face of each.
   * `near` is a point on each face near where the transition should start. The first Sheet
   * keeps its id.
   */
  bridgeSurface(
    first: FaceRef & { nearMm: Vec3 },
    second: FaceRef & { nearMm: Vec3 },
    widthMm: number,
    shape: BlendShape = "g2",
    softness = 1,
    options: { trimWalls?: boolean; trimBlend?: BlendTrim } = {},
  ): Promise<MutationResult> {
    if (first.id === second.id) {
      return Promise.reject(new Error("Bridge surface joins two different Sheets"));
    }
    const setup = `
        const face = (ref) => pick(typed(ref.id, 'Sheet').high.faces, [ref.faceId], 'face')[0];
        factory.shape = args.shape;
        factory.width = args.width;
        factory.softness = args.softness;
        if (args.trimWalls !== undefined) factory.trimWalls = args.trimWalls;
        if (args.trimBlend !== undefined) factory.trimBlend = args.trimBlend;
        factory.push(face(args.first), false, new Vector3(...args.first.near));
        factory.push(face(args.second), false, new Vector3(...args.second.near));`;
    const end = (ref: FaceRef & { nearMm: Vec3 }) => ({ id: ref.id, faceId: ref.faceId, near: toMeters(ref.nearMm) });
    return withHint(
      this.mutate(
        commandFunction("BridgeSurfaceCommand", ["Vector3"], setup),
        ["BridgeSurfaceFactory", "Vector3"],
        [{ first: end(first), second: end(second), width: widthMm * MM, shape: BLEND_SHAPE_CODES[shape], softness,
          trimWalls: options.trimWalls, trimBlend: options.trimBlend && BLEND_TRIM_CODES[options.trimBlend] }],
      ),
      "PK_FACE_make_blend",
      "The two surfaces must meet at an angle when extended (parallel or coplanar faces cannot be bridged), the width must be larger than the gap between them, and the blend must land on both Sheets — a wall that starts high above the floor's extension or a gap much larger than the width fails; extend the Sheets or raise the width.",
    );
  }

  /**
   * A Sheet through the given points (at least four). `normals`, one per point, say which way
   * the surface faces there; without them it is fitted freely. The Sheet reaches somewhat
   * beyond the points.
   */
  constrainedSurface(
    pointsMm: Vec3[],
    normals?: Vec3[],
    toleranceMm = 0.01,
    optimize: "performance" | "smoothness" = "performance",
  ): Promise<MutationResult> {
    if (normals && normals.length !== pointsMm.length) {
      return Promise.reject(new Error("Pass one normal per point"));
    }
    const setup = `
        factory.points = args.points.map((point) => new Vector3(...point));
        if (args.normals) factory.normals = args.normals.map((normal) => new Vector3(...normal).normalize());
        factory.tolerance = args.tolerance;
        factory.optimize = args.optimize;`;
    return this.mutate(
      commandFunction("ConstrainedSurfaceCommand", ["Vector3"], setup),
      ["ConstrainedSurfaceFactory", "Vector3"],
      [{
        points: pointsMm.map(toMeters),
        normals: normals ?? null,
        tolerance: toleranceMm * MM,
        optimize: SURFACE_OPTIMIZATION[optimize],
      }],
    );
  }

  /** Show the hidden spans of control points of faces, so that a rebuild can remove them. */
  removeNominalSurface(id: number, faceIds: string[]): Promise<MutationResult> {
    const setup = `
        ${PICK_FACES}
        factory.shell = view;`;
    return this.mutate(
      commandFunction("RemoveNominalSurfaceCommand", [], setup),
      ["RemoveNominalSurfaceFactory"],
      [{ id, faceIds }],
    );
  }

  /** Raise the degree of the surfaces of faces: more control points, same shape. */
  raiseDegreeFaces(id: number, faceIds: string[], u = 1, v = 1): Promise<MutationResult> {
    const setup = `
        ${PICK_FACES}
        factory.deltaUDegree = args.u;
        factory.deltaVDegree = args.v;`;
    return this.mutate(
      commandFunction("RaiseDegreeFaceCommand", [], setup, true),
      ["RaiseDegreeFaceFactory", "RaiseDegreeFaceCommand"],
      [{ id, faceIds, u, v }],
    );
  }

  /** Refit the surface of one face as a clean spline surface within `toleranceMm`. */
  rebuildFace(id: number, faceId: string, toleranceMm: number): Promise<MutationResult> {
    // The other method, explicit degree and spans, needs the Studio edition.
    const setup = `
        const view = typed(args.id, 'Solid', 'Sheet');
        factory.shell = view;
        factory.face = pick(view.high.faces, [args.faceId], 'face')[0];
        factory.method = args.method;
        factory.tolerance = args.tolerance;
        factory.changeEdgeMethod = args.edges;`;
    return this.mutate(
      commandFunction("RebuildFaceCommand", [], setup),
      ["RebuildFaceFactory"],
      [{ id, faceId, tolerance: toleranceMm * MM, method: REBUILD_FACE_REFIT, edges: CHANGE_EDGE_PROJECT }],
    );
  }

  /**
   * Wrap whole bodies from one face onto another: a body that sits on (or near) the `source`
   * face is carried over to the `target` face and bent to follow it. With `keepOriginals` the
   * wrapped bodies are new and the originals stay.
   */
  deformBodies(
    ids: number[],
    source: FaceRef,
    target: FaceRef,
    keepOriginals = false,
    options: DeformOptions = {},
  ): Promise<MutationResult> {
    const setup = `
        const face = (ref) => pick(typed(ref.id, 'Solid', 'Sheet').high.faces, [ref.faceId], 'face')[0];
        factory.faces = args.ids.flatMap((id) => {
          const faces = typed(id, 'Solid', 'Sheet').high.faces;
          return Array.from({ length: faces.length }, (_, i) => faces.get(i));
        });
        factory.sourceFace = face(args.source);
        factory.targetFace = face(args.target);
        factory.keepTools = args.keepOriginals;
        for (const key of ['scaleU', 'scaleV', 'scaleNormal', 'offsetU', 'offsetV', 'offsetNormal', 'flipUV', 'flipNormal', 'mirror']) {
          if (args.options?.[key] !== undefined) factory[key] = args.options[key];
        }`;
    return this.mutate(
      commandFunction("DeformFaceCommand", [], setup, true),
      ["DeformFaceFactory", "DeformFaceCommand"],
      [{ ids, source, target, keepOriginals, options: deformArgs(options) }],
    );
  }

  /**
   * Loft a Sheet between boundary edges of Sheets (`{ id, edgeId }`) and curves (ids), in the
   * given order. `tangency` (one value for the loft — the kernel takes no per-end value):
   * natural, free (native default) or clamped — continuing the face next to each edge.
   * `startMagnitude` / `endMagnitude` scale the tangent at the ends; a tight bend needs less
   * than 1. With `join` the loft is then joined to the source Sheets (the loft factory's own
   * join fails); a failed join keeps the loft and says why in `joinError`.
   */
  async loftEdges(
    ends: LoftEnd[],
    options: { tangency?: LoftTangency; startMagnitude?: number; endMagnitude?: number; join?: boolean } = {},
  ): Promise<MutationResult & { joinError?: string }> {
    if (ends.length < 2) throw new Error("A loft needs at least two ends");
    for (const m of [options.startMagnitude, options.endMagnitude]) {
      if (m !== undefined && !(m > 0)) throw new Error("Magnitudes must be positive");
    }
    const setup = `
        editor.selection.selected.removeAll();
        factory.profiles = args.ends.map((end) => typeof end === 'number'
          ? typed(end, 'Wire')
          : pick(typed(end.id, 'Sheet', 'Solid').high.edges, [end.edgeId], 'edge')[0]);
        if (args.curvature !== undefined) factory.curvature = args.curvature;
        if (args.startMagnitude !== undefined) factory.startMagnitude = args.startMagnitude;
        if (args.endMagnitude !== undefined) factory.endMagnitude = args.endMagnitude;
        factory.join = false;`;
    const loft = await withHint(
      this.mutate(
        commandFunction("LoftEdgeCommand", [], setup, true),
        ["CurveLoftFactory", "LoftEdgeCommand"],
        [{
          ends,
          curvature: options.tangency && LOFT_TANGENCY_CODES[options.tangency],
          startMagnitude: options.startMagnitude,
          endMagnitude: options.endMagnitude,
        }],
      ),
      /make_lofted_body.*21555|21555/,
      "The tangents are too long for this bend and the surface folds over itself: lower startMagnitude / endMagnitude (0.6 worked on a 90° elbow of 10 mm tubes).",
    );
    const sources = [...new Set(ends.filter((e): e is { id: number; edgeId: string } => typeof e !== "number").map((e) => e.id))];
    const loftId = loft.created[0]?.id;
    if (!options.join || loftId === undefined || sources.length === 0) return loft;
    try {
      const joined = await this.join([sources[0]!, loftId, ...sources.slice(1)]);
      return {
        created: loft.created.filter((b) => !joined.removedIds.includes(b.id)),
        changed: joined.changed,
        removedIds: joined.removedIds.filter((id) => id !== loftId),
        bodyCount: joined.bodyCount,
        undoDepth: joined.undoDepth,
        redoDepth: joined.redoDepth,
      };
    } catch (err) {
      return { ...loft, joinError: (err as Error).message };
    }
  }

  /**
   * Revolve an open profile and give the surface a wall `thicknessMm` thick, inside the
   * revolved surface so its outer size stays. Plasticity's revolve ignores its own thickness
   * field, so this is a revolve followed by a thicken (two undo steps).
   */
  async revolveShell(
    profile: ProfileRef,
    axisOriginMm: Vec3,
    axis: Vec3,
    angleDeg: number,
    thicknessMm: number,
  ): Promise<MutationResult> {
    if (!(thicknessMm > 0)) throw new Error("thickness must be positive");
    const revolved = await this.revolveProfile(profile, axisOriginMm, axis, angleDeg);
    const skin = revolved.created[0];
    if (!skin || skin.type !== "Sheet") {
      if (skin) await this.undo();
      throw new Error("thickness needs an open profile (a revolved Sheet); for a closed profile revolve it and use hollow");
    }
    // Wall inside the surface: against the normal where it points away from the axis. Bounds
    // cannot decide this — for spline faces they come from the control polygon.
    const face = (await this.topology(skin.id, "faces")).faces?.[0];
    let outward = true;
    if (face?.normal && face.centerMm) {
      const u = axis.map((v) => v / Math.hypot(...axis)) as Vec3;
      const rel = face.centerMm.map((v, i) => v - axisOriginMm[i]!) as Vec3;
      const along = rel[0] * u[0] + rel[1] * u[1] + rel[2] * u[2];
      const radial = rel.map((v, i) => v - along * u[i]!);
      outward = radial[0]! * face.normal[0]! + radial[1]! * face.normal[1]! + radial[2]! * face.normal[2]! >= 0;
    }
    const walled = outward
      ? await this.thicken(skin.id, 0, thicknessMm)
      : await this.thicken(skin.id, thicknessMm, 0);
    return {
      created: walled.changed.filter((b) => b.id === skin.id),
      changed: walled.changed.filter((b) => b.id !== skin.id),
      removedIds: walled.removedIds,
      bodyCount: walled.bodyCount,
      undoDepth: walled.undoDepth,
      redoDepth: walled.redoDepth,
    };
  }

}
