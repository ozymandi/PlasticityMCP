/** Surfaces: blends between sheets, a surface through points, degree, rebuild, deform. */

import { withHint } from "./core.js";
import { MM, toMeters } from "./math.js";
import { ProjectionTools } from "./projection.js";
import { commandFunction } from "./snippets.js";
import { PICK_FACES } from "./solids.js";
import { BlendShape, FaceRef, MutationResult, Vec3 } from "./types.js";

// Native codes, read from the running 26.1.3 app.
const BLEND_SHAPE_CODES: Record<BlendShape, number> = { g2: 22202, chamfer: 22203 };
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
  ): Promise<MutationResult> {
    if (first.id === second.id) {
      return Promise.reject(new Error("Bridge surface joins two different Sheets"));
    }
    const setup = `
        const face = (ref) => pick(typed(ref.id, 'Sheet').high.faces, [ref.faceId], 'face')[0];
        factory.shape = args.shape;
        factory.width = args.width;
        factory.softness = args.softness;
        factory.push(face(args.first), false, new Vector3(...args.first.near));
        factory.push(face(args.second), false, new Vector3(...args.second.near));`;
    const end = (ref: FaceRef & { nearMm: Vec3 }) => ({ id: ref.id, faceId: ref.faceId, near: toMeters(ref.nearMm) });
    return withHint(
      this.mutate(
        commandFunction("BridgeSurfaceCommand", ["Vector3"], setup),
        ["BridgeSurfaceFactory", "Vector3"],
        [{ first: end(first), second: end(second), width: widthMm * MM, shape: BLEND_SHAPE_CODES[shape], softness }],
      ),
      "PK_FACE_make_blend",
      "The two surfaces must meet at an angle when extended (parallel or coplanar faces cannot be bridged) and the width must fit between them.",
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
  deformBodies(ids: number[], source: FaceRef, target: FaceRef, keepOriginals = false): Promise<MutationResult> {
    const setup = `
        const face = (ref) => pick(typed(ref.id, 'Solid', 'Sheet').high.faces, [ref.faceId], 'face')[0];
        factory.faces = args.ids.flatMap((id) => {
          const faces = typed(id, 'Solid', 'Sheet').high.faces;
          return Array.from({ length: faces.length }, (_, i) => faces.get(i));
        });
        factory.sourceFace = face(args.source);
        factory.targetFace = face(args.target);
        factory.keepTools = args.keepOriginals;`;
    return this.mutate(
      commandFunction("DeformFaceCommand", [], setup, true),
      ["DeformFaceFactory", "DeformFaceCommand"],
      [{ ids, source, target, keepOriginals }],
    );
  }
}
