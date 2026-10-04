import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  BODY_IDS_SCHEMA,
  BodyId,
  BodyIds,
  native,
  ok,
  type ToolFamily,
  TOPOLOGY_IDS_SCHEMA,
  TopologyIds,
  VEC3_SCHEMA,
  Vec3Mm,
} from "./shared.js";

/** Editing curves — and the surface side of the same commands: control points, degree, rebuild, deform. */

const PositiveFactor = z.number().positive();

const ContinuityLevel = z.enum(["G0", "G1", "G2", "G3"]);

const somePoints = (a: { vertexIds?: string[]; controlPointIds?: string[] }) =>
  a.vertexIds !== undefined || a.controlPointIds !== undefined;
const SOME_POINTS_MESSAGE = "pass vertexIds, controlPointIds or both";

const points = { id: BodyId, vertexIds: TopologyIds.optional(), controlPointIds: TopologyIds.optional() };

const TrimCurvesArgs = z.object({
  id: BodyId,
  near: Vec3Mm,
});

const CurveIdsArgs = z.object({
  ids: BodyIds,
});

const RaiseDegreeArgs = z
  .object({
    ids: BodyIds.optional(),
    id: BodyId.optional(),
    faceIds: TopologyIds.optional(),
    u: z.number().int().min(0).max(5).optional().default(1),
    v: z.number().int().min(0).max(5).optional().default(1),
  })
  .refine((a) => (a.ids === undefined) !== (a.id === undefined), "pass either ids (curves), or id with faceIds")
  .refine((a) => (a.id === undefined) === (a.faceIds === undefined), "id and faceIds go together")
  .refine((a) => a.id === undefined || a.u + a.v > 0, "u or v must be positive");

const RebuildArgs = z
  .object({
    ids: BodyIds.optional(),
    id: BodyId.optional(),
    faceId: z.string().min(1).optional(),
    tolerance: z.number().positive().optional(),
    pointCount: z.number().int().min(2).max(10000).optional(),
    degree: z.number().int().min(1).max(15).optional(),
    spans: z.number().int().min(1).max(10000).optional(),
    keepCorners: z.boolean().optional().default(true),
  })
  .refine((a) => (a.ids === undefined) !== (a.id === undefined), "pass either ids (curves), or id with faceId")
  .refine((a) => (a.id === undefined) === (a.faceId === undefined), "id and faceId go together")
  .refine(
    (a) => [a.tolerance, a.pointCount, a.degree].filter((v) => v !== undefined).length === 1,
    "pass exactly one of tolerance, pointCount, or degree with spans",
  )
  .refine((a) => (a.degree === undefined) === (a.spans === undefined), "degree and spans go together")
  .refine((a) => a.id === undefined || a.tolerance !== undefined, "a face is rebuilt by tolerance");

const ConvertVerticesArgs = z.object({
  id: BodyId,
  vertexIds: TopologyIds,
});

const AlignVerticesArgs = z.object({
  id: BodyId,
  vertexId: z.string().min(1),
  targetId: BodyId,
  targetVertexId: z.string().min(1),
  continuity: z.enum(["G0", "G1", "G2"]).optional().default("G1"),
});

const BridgeEnd = z
  .object({ id: BodyId, vertexId: z.string().min(1).optional(), edgeId: z.string().min(1).optional() })
  .refine((a) => (a.vertexId === undefined) !== (a.edgeId === undefined), "pass either vertexId or edgeId");

const BridgeArgs = z.object({
  first: BridgeEnd,
  second: BridgeEnd,
  continuity: ContinuityLevel.optional().default("G2"),
  endContinuity: ContinuityLevel.optional(),
});

const MoveControlPointsArgs = z
  .object({ ...points, delta: Vec3Mm.refine((d) => Math.hypot(...d) > 0, "delta must be non-zero") })
  .refine(somePoints, SOME_POINTS_MESSAGE);

const RotateControlPointsArgs = z
  .object({
    ...points,
    axis: Vec3Mm.refine((a) => Math.hypot(...a) > 0, "axis must be non-zero"),
    angle: z.number().refine((a) => a !== 0, "angle must be non-zero"),
    pivot: Vec3Mm.optional(),
  })
  .refine(somePoints, SOME_POINTS_MESSAGE);

const ScaleControlPointsArgs = z
  .object({
    ...points,
    factor: z.union([PositiveFactor, z.tuple([PositiveFactor, PositiveFactor, PositiveFactor])]),
    pivot: Vec3Mm.optional(),
  })
  .refine(somePoints, SOME_POINTS_MESSAGE);

const SlideArgs = z
  .object({
    ...points,
    distance: z.number().positive(),
    direction: z.enum(["forward", "backward", "forward_v", "backward_v", "normal"]).optional().default("forward"),
  })
  .refine(somePoints, SOME_POINTS_MESSAGE);

const DeleteControlPointsArgs = z.object(points).refine(somePoints, SOME_POINTS_MESSAGE);

const CurvesFromEdgesArgs = z.object({
  id: BodyId,
  edgeIds: TopologyIds,
});

const FaceRef = z.object({ id: BodyId, faceId: z.string().min(1) });

const DeformArgs = z
  .object({
    curveIds: BodyIds.optional(),
    ids: BodyIds.optional(),
    source: FaceRef,
    target: FaceRef,
    keepOriginals: z.boolean().optional().default(false),
  })
  .refine((a) => (a.curveIds === undefined) !== (a.ids === undefined), "pass either curveIds or ids (bodies)");

const CURVE_IDS_NOTE =
  "Vertex and control point ids come from get_body_topology of the curve, read after its last change.";

const POINTS_NOTE =
  "`id` is a curve (its `vertexIds` and `controlPointIds`) or a Solid / Sheet with spline faces " +
  "(the `controlPointIds` of its surfaces); the ids come from get_body_topology, read after " +
  "the last change.";

const POINT_PROPERTIES = {
  id: { type: "number", description: "Curve id, or the id of a body with spline faces" },
  vertexIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Vertex ids from get_body_topology of the curve" },
  controlPointIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Control point ids from get_body_topology" },
};

const FACE_REF_SCHEMA = {
  type: "object",
  required: ["id", "faceId"],
  properties: { id: { type: "number" }, faceId: { type: "string" } },
};

const BRIDGE_END_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "number", description: "Curve id (with vertexId) or body id (with edgeId)" },
    vertexId: { type: "string", description: "A vertex of the curve" },
    edgeId: { type: "string", description: "An edge of the body" },
  },
};

const FACTOR_SCHEMA = {
  anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 }],
};

const tools: Tool[] = [
  {
    name: "trim_curves",
    description:
      "Remove one piece of curve `id`: the piece nearest to point `near`. Pieces end at the " +
      "corners of the curve and where other curves cross it, so this cuts away an overhang " +
      "past a crossing, or one side of a polyline. The other curves are not changed. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "near"],
      properties: { id: { type: "number" }, near: VEC3_SCHEMA },
    },
  },
  {
    name: "subdivide_curves",
    description:
      "Add a control point in the middle of every segment of the curves. Straight segments " +
      "become splines that can then be shaped with the control point tools; the shape itself " +
      "does not change. Undoable.",
    inputSchema: { type: "object", required: ["ids"], properties: { ids: BODY_IDS_SCHEMA } },
  },
  {
    name: "raise_degree",
    description:
      "Raise the degree: more control points, same shape — finer control for the control " +
      "point tools. With `ids`: curves, each segment by one degree. With `id` + `faceIds`: the " +
      "surfaces of those faces, by `u` and `v` degrees (default 1 each); a flat or round face " +
      "becomes a spline face whose control points then appear in get_body_topology. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { ...BODY_IDS_SCHEMA, description: "Curves" },
        id: { type: "number", description: "Body whose faces are raised" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        u: { type: "number", default: 1 },
        v: { type: "number", default: 1 },
      },
    },
  },
  {
    name: "rebuild",
    description:
      "Refit as clean splines. Curves (`ids`): pass one of `tolerance` (millimetres — stay " +
      "that close to the original), `pointCount` (one spline with that many points; the " +
      "shape is approximated), or `degree` with `spans`; `keepCorners` (default true) keeps " +
      "sharp corners sharp. One face (`id` + `faceId`): its surface is refitted within " +
      "`tolerance` — the only method for faces in this edition of Plasticity. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { ...BODY_IDS_SCHEMA, description: "Curves" },
        id: { type: "number", description: "Body whose face is rebuilt" },
        faceId: { type: "string" },
        tolerance: { type: "number" },
        pointCount: { type: "number" },
        degree: { type: "number" },
        spans: { type: "number" },
        keepCorners: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "convert_vertices",
    description:
      "Turn corner vertices of a curve into smooth ones: the segments that meet there become " +
      "one spline through the corner region, shaped by control points. End vertices cannot be " +
      "converted. " +
      CURVE_IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "vertexIds"],
      properties: { id: { type: "number" }, vertexIds: TOPOLOGY_IDS_SCHEMA },
    },
  },
  {
    name: "align_vertices",
    description:
      "Bring end vertex `vertexId` of curve `id` onto vertex `targetVertexId` of curve " +
      "`targetId`, with `continuity` there: G0 touching, G1 tangent (default), G2 curvature. " +
      "The first curve is reshaped near that end; the target stays. " +
      CURVE_IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "vertexId", "targetId", "targetVertexId"],
      properties: {
        id: { type: "number" },
        vertexId: { type: "string" },
        targetId: { type: "number" },
        targetVertexId: { type: "string" },
        continuity: { type: "string", enum: ["G0", "G1", "G2"], default: "G1" },
      },
    },
  },
  {
    name: "bridge",
    description:
      "Create a smooth connecting curve between two ends: either two curve vertices " +
      "(`{ id, vertexId }` each), or two body edges (`{ id, edgeId }` each — the bridge joins " +
      "their nearest ends). `continuity` is how smoothly the bridge leaves the first end: G0 " +
      "touching, G1 tangent, G2 curvature (default), G3; `endContinuity` sets the second end " +
      "separately. The bridge is a new curve in `created`; join it to the others with join. " +
      "Undoable.",
    inputSchema: {
      type: "object",
      required: ["first", "second"],
      properties: {
        first: BRIDGE_END_SCHEMA,
        second: BRIDGE_END_SCHEMA,
        continuity: { type: "string", enum: ["G0", "G1", "G2", "G3"], default: "G2" },
        endContinuity: { type: "string", enum: ["G0", "G1", "G2", "G3"] },
      },
    },
  },
  {
    name: "move_control_points",
    description:
      "Move vertices and control points by `delta` millimetres; the curve segments or the " +
      "surface around them follow. " +
      POINTS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "delta"],
      properties: { ...POINT_PROPERTIES, delta: VEC3_SCHEMA },
    },
  },
  {
    name: "rotate_control_points",
    description:
      "Rotate vertices and control points by `angle` degrees (right-hand rule) around `axis` " +
      "through `pivot` (default: the centre of the points). " +
      POINTS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "axis", "angle"],
      properties: {
        ...POINT_PROPERTIES,
        axis: { ...VEC3_SCHEMA, description: "Rotation axis direction [x, y, z]" },
        angle: { type: "number", description: "Degrees" },
        pivot: VEC3_SCHEMA,
      },
    },
  },
  {
    name: "scale_control_points",
    description:
      "Scale vertices and control points relative to `pivot` (default: the centre of the " +
      "points): `factor` is one number or [x, y, z]. " +
      POINTS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "factor"],
      properties: { ...POINT_PROPERTIES, factor: FACTOR_SCHEMA, pivot: VEC3_SCHEMA },
    },
  },
  {
    name: "slide",
    description:
      "Slide control points by `distance` millimetres along the control polygon, keeping the " +
      "flow of the shape: `forward` / `backward` along a curve or along the U direction of a " +
      "surface, `forward_v` / `backward_v` along the V direction of a surface, `normal` " +
      "across. Splines only: a polyline has nothing to slide. " +
      POINTS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "distance"],
      properties: {
        ...POINT_PROPERTIES,
        distance: { type: "number" },
        direction: {
          type: "string",
          enum: ["forward", "backward", "forward_v", "backward_v", "normal"],
          default: "forward",
        },
      },
    },
  },
  {
    name: "delete_control_points",
    description:
      "Delete control points of a spline; the curve is refitted through the remaining ones. " +
      CURVE_IDS_NOTE +
      " Undoable.",
    inputSchema: { type: "object", required: ["id"], properties: POINT_PROPERTIES },
  },
  {
    name: "curves_from_edges",
    description:
      "Copy edges of one body as curves (in `created`): edges that touch come out as one " +
      "curve, so the edges around a face give its outline as a closed profile. The body stays " +
      "as it is. `edgeIds` come from get_body_topology of the body. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "edgeIds"],
      properties: { id: { type: "number" }, edgeIds: TOPOLOGY_IDS_SCHEMA },
    },
  },
  {
    name: "deform",
    description:
      "Wrap from one face onto another: curves (`curveIds`) or whole Solids / Sheets (`ids`) " +
      "that sit on or near the `source` face — typically a flat one — are carried over to " +
      "the `target` face and bent to follow it, keeping their place in the face's own " +
      "coordinates. Text, a pattern or an embossed detail made flat goes onto a cylinder wall " +
      "this way. What is wrapped is replaced by the result (in `changed`); with " +
      "`keepOriginals` the flat originals stay and the result is in `created`. Undoable.",
    inputSchema: {
      type: "object",
      required: ["source", "target"],
      properties: {
        curveIds: { ...BODY_IDS_SCHEMA, description: "Curves to wrap" },
        ids: { ...BODY_IDS_SCHEMA, description: "Solids / Sheets to wrap" },
        source: FACE_REF_SCHEMA,
        target: FACE_REF_SCHEMA,
        keepOriginals: { type: "boolean", default: false },
      },
    },
  },
];

const uniform = (factor: number | [number, number, number]): [number, number, number] =>
  typeof factor === "number" ? [factor, factor, factor] : factor;

const pointsOf = (args: { vertexIds?: string[]; controlPointIds?: string[] }) => ({
  vertexIds: args.vertexIds,
  controlPointIds: args.controlPointIds,
});

const handlers: ToolFamily["handlers"] = {
  trim_curves: async (rawArgs) => {
    const args = TrimCurvesArgs.parse(rawArgs ?? {});
    return ok(await native.trimCurve(args.id, args.near));
  },

  subdivide_curves: async (rawArgs) => {
    const args = CurveIdsArgs.parse(rawArgs ?? {});
    return ok(await native.subdivideCurves(args.ids));
  },

  raise_degree: async (rawArgs) => {
    const args = RaiseDegreeArgs.parse(rawArgs ?? {});
    if (args.ids) return ok(await native.raiseDegree(args.ids));
    return ok(await native.raiseDegreeFaces(args.id!, args.faceIds!, args.u, args.v));
  },

  rebuild: async (rawArgs) => {
    const args = RebuildArgs.parse(rawArgs ?? {});
    if (args.id !== undefined) return ok(await native.rebuildFace(args.id, args.faceId!, args.tolerance!));
    const how =
      args.tolerance !== undefined
        ? { toleranceMm: args.tolerance }
        : args.pointCount !== undefined
          ? { pointCount: args.pointCount }
          : { degree: args.degree!, spans: args.spans! };
    return ok(await native.rebuildCurves(args.ids!, how, args.keepCorners));
  },

  convert_vertices: async (rawArgs) => {
    const args = ConvertVerticesArgs.parse(rawArgs ?? {});
    return ok(await native.convertVertices(args.id, args.vertexIds));
  },

  align_vertices: async (rawArgs) => {
    const args = AlignVerticesArgs.parse(rawArgs ?? {});
    return ok(
      await native.alignVertex(args.id, args.vertexId, args.targetId, args.targetVertexId, args.continuity),
    );
  },

  bridge: async (rawArgs) => {
    const args = BridgeArgs.parse(rawArgs ?? {});
    const end = (e: { id: number; vertexId?: string; edgeId?: string }) =>
      e.vertexId !== undefined ? { id: e.id, vertexId: e.vertexId } : { id: e.id, edgeId: e.edgeId! };
    return ok(
      await native.bridge(end(args.first), end(args.second), args.continuity, args.endContinuity ?? args.continuity),
    );
  },

  move_control_points: async (rawArgs) => {
    const args = MoveControlPointsArgs.parse(rawArgs ?? {});
    return ok(await native.moveControlPoints(args.id, pointsOf(args), args.delta));
  },

  rotate_control_points: async (rawArgs) => {
    const args = RotateControlPointsArgs.parse(rawArgs ?? {});
    return ok(await native.rotateControlPoints(args.id, pointsOf(args), args.axis, args.angle, args.pivot));
  },

  scale_control_points: async (rawArgs) => {
    const args = ScaleControlPointsArgs.parse(rawArgs ?? {});
    return ok(await native.scaleControlPoints(args.id, pointsOf(args), uniform(args.factor), args.pivot));
  },

  slide: async (rawArgs) => {
    const args = SlideArgs.parse(rawArgs ?? {});
    return ok(await native.slideControlPoints(args.id, pointsOf(args), args.distance, args.direction));
  },

  delete_control_points: async (rawArgs) => {
    const args = DeleteControlPointsArgs.parse(rawArgs ?? {});
    return ok(await native.deleteControlPoints(args.id, pointsOf(args)));
  },

  curves_from_edges: async (rawArgs) => {
    const args = CurvesFromEdgesArgs.parse(rawArgs ?? {});
    return ok(await native.curvesFromEdges(args.id, args.edgeIds));
  },

  deform: async (rawArgs) => {
    const args = DeformArgs.parse(rawArgs ?? {});
    if (args.ids) return ok(await native.deformBodies(args.ids, args.source, args.target, args.keepOriginals));
    return ok(await native.deformCurves(args.curveIds!, args.source, args.target, args.keepOriginals));
  },
};

export const curveEdit: ToolFamily = { tools, handlers };
