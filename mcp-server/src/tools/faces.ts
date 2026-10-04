import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  BODY_IDS_SCHEMA,
  BodyId,
  BodyIds,
  Direction,
  native,
  ok,
  RegionIds,
  type ToolFamily,
  TOPOLOGY_IDS_SCHEMA,
  TopologyIds,
  VEC3_SCHEMA,
  Vec3Mm,
} from "./shared.js";

/** Faces and edges of one body, and Sheets: transform, offset, match, imprint, clean-up. */

const PositiveFactor = z.number().positive();

const nonZero = (what: string) => z.number().refine((d) => d !== 0, `${what} must be non-zero`);

const MoveFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  delta: Vec3Mm.refine((d) => Math.hypot(...d) > 0, "delta must be non-zero"),
});

const RotateFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  axis: Vec3Mm.refine((a) => Math.hypot(...a) > 0, "axis must be non-zero"),
  angle: nonZero("angle"),
  pivot: Vec3Mm.optional(),
});

const ScaleFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  factor: z.union([PositiveFactor, z.tuple([PositiveFactor, PositiveFactor, PositiveFactor])]),
  pivot: Vec3Mm.optional(),
});

const MoveEdgesArgs = z.object({
  id: BodyId,
  edgeIds: TopologyIds,
  delta: Vec3Mm.refine((d) => Math.hypot(...d) > 0, "delta must be non-zero"),
});

const OffsetArgs = z
  .object({
    id: BodyId.optional(),
    faceIds: TopologyIds.optional(),
    edgeIds: TopologyIds.optional(),
    vertexIds: TopologyIds.optional(),
    curveIds: BodyIds.optional(),
    regionIds: RegionIds.optional(),
    loops: z.boolean().optional().default(false),
    distance: nonZero("distance"),
    bothSides: z.boolean().optional().default(false),
    gapFill: z.enum(["round", "linear", "natural"]).optional().default("round"),
  })
  .refine(
    (a) => [a.faceIds, a.edgeIds, a.vertexIds, a.curveIds, a.regionIds].filter((v) => v !== undefined).length === 1,
    "pass exactly one of faceIds, edgeIds, vertexIds, curveIds or regionIds",
  )
  .refine(
    (a) => (a.id !== undefined) === (a.curveIds === undefined && a.regionIds === undefined),
    "id goes with faceIds, edgeIds and vertexIds; curveIds and regionIds stand alone",
  )
  .refine((a) => !a.loops || a.faceIds !== undefined, "loops goes with faceIds");

const MatchFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  targetId: BodyId,
  targetFaceId: z.string().min(1),
});

const ExtendArgs = z
  .object({
    id: BodyId,
    edgeIds: TopologyIds.optional(),
    vertexIds: TopologyIds.optional(),
    distance: z.number().positive(),
    shape: z.enum(["linear", "soft", "reflective", "natural"]).optional(),
  })
  .refine(
    (a) => (a.edgeIds === undefined) !== (a.vertexIds === undefined),
    "pass edgeIds (a Sheet) or vertexIds (a curve)",
  );

const UntrimArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  keepEdges: z.boolean().optional().default(false),
});

const ReverseArgs = z.object({
  ids: BodyIds,
});

const UnwrapFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
});

const IsoparamArgs = z.object({
  id: BodyId,
  faceId: z.string().min(1),
  direction: z.enum(["u", "v"]),
  param: z.number().gt(0).lt(1).optional().default(0.5),
  count: z.number().int().min(1).max(50).optional().default(1),
});

const CompleteEdgesArgs = z.object({
  id: BodyId,
  edgeIds: TopologyIds,
});

const ImprintArgs = z
  .object({
    id: BodyId,
    curveIds: BodyIds.optional(),
    toolIds: BodyIds.optional(),
    complete: z.enum(["none", "edge", "boundary"]).optional().default("none"),
    direction: Direction.optional(),
    imprintTools: z.boolean().optional().default(false),
  })
  .refine((a) => (a.curveIds === undefined) !== (a.toolIds === undefined), "pass either curveIds or toolIds")
  .refine((a) => a.direction === undefined || a.curveIds !== undefined, "direction goes with curveIds")
  .refine((a) => !a.imprintTools || a.toolIds !== undefined, "imprintTools goes with toolIds");

const DissolveEdgesArgs = z.object({
  id: BodyId,
  edgeIds: TopologyIds.optional(),
});

const RefilletArgs = z
  .object({
    id: BodyId,
    faceIds: TopologyIds,
    radius: z.number().positive().optional(),
    delta: nonZero("delta").optional(),
  })
  .refine((a) => (a.radius === undefined) !== (a.delta === undefined), "pass either radius or delta");

const DuplicateFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  solid: z.boolean().optional().default(false),
});

const IDS_NOTE =
  "Face and edge ids come from get_body_topology of the same body, read after its last change.";

const FACTOR_SCHEMA = {
  anyOf: [{ type: "number" }, { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 }],
};

const tools: Tool[] = [
  {
    name: "move_faces",
    description:
      "Move faces of one body by `delta` millimetres; the neighbouring faces are extended or " +
      "trimmed to follow, so the body stays closed. Moving a flat face within its own plane " +
      "changes nothing — move it along its normal, or move a round face (a hole, a boss) " +
      "sideways to relocate it. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds", "delta"],
      properties: { id: { type: "number" }, faceIds: TOPOLOGY_IDS_SCHEMA, delta: VEC3_SCHEMA },
    },
  },
  {
    name: "rotate_faces",
    description:
      "Rotate faces of one body by `angle` degrees (right-hand rule) around `axis` through " +
      "`pivot`; the neighbours follow. `pivot` defaults to the centre of the faces. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds", "axis", "angle"],
      properties: {
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        axis: { ...VEC3_SCHEMA, description: "Rotation axis direction [x, y, z]" },
        angle: { type: "number", description: "Degrees" },
        pivot: VEC3_SCHEMA,
      },
    },
  },
  {
    name: "scale_faces",
    description:
      "Scale faces of one body relative to `pivot`: `factor` is one number or [x, y, z]. " +
      "`pivot` defaults to the centre of the faces — for a cylindrical face a point on its " +
      "axis, so factor 2 doubles the radius of a hole or boss in place. A flat face scaled in " +
      "its own plane does not change. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds", "factor"],
      properties: {
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        factor: FACTOR_SCHEMA,
        pivot: VEC3_SCHEMA,
      },
    },
  },
  {
    name: "move_edges",
    description:
      "Move edges of one body by `delta` millimetres; the faces that meet at them tilt to " +
      "follow (lowering one top edge of a box slopes its top). " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "edgeIds", "delta"],
      properties: { id: { type: "number" }, edgeIds: TOPOLOGY_IDS_SCHEMA, delta: VEC3_SCHEMA },
    },
  },
  {
    name: "offset",
    description:
      "Offset by `distance` millimetres; what is offset depends on what is passed. On a body " +
      "`id`: `faceIds` — the faces move along their normals (positive outward) and the " +
      "neighbours follow; on a round face this changes its radius. `faceIds` + `loops: true` " +
      "— the outline of the faces is offset on the surface: positive inward, an inset border; " +
      "negative outward onto the neighbouring faces. `edgeIds` — each edge is copied across " +
      "one of its two faces; the sign picks the face. Loops and edges only draw new edges and " +
      "split faces, nothing moves. On a curve `id`: `vertexIds` — new vertices are inserted " +
      "on both sides of each vertex, `distance` away along the curve. Without `id`: " +
      "`curveIds` — a parallel copy of each planar curve (the sign picks the side; the curve " +
      "stays); `regionIds` — a new curve around the outline of the regions (positive " +
      "outward). `bothSides` offsets both ways at once (loops, edges, curves) and `gapFill` " +
      "(round / linear / natural) shapes the corners (loops, edges, curves, regions). " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["distance"],
      properties: {
        id: { type: "number", description: "Body (faceIds, edgeIds) or curve (vertexIds)" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        edgeIds: TOPOLOGY_IDS_SCHEMA,
        vertexIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Vertices of curve `id`" },
        curveIds: { ...BODY_IDS_SCHEMA, description: "Planar curves to copy in parallel" },
        regionIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Region ids from list_regions" },
        loops: { type: "boolean", default: false, description: "With faceIds: offset their outline" },
        distance: { type: "number" },
        bothSides: { type: "boolean", default: false },
        gapFill: { type: "string", enum: ["round", "linear", "natural"], default: "round" },
      },
    },
  },
  {
    name: "match_faces",
    description:
      "Replace the surface of faces of one body with the surface of `targetFaceId` of body " +
      "`targetId` (the same body or another): the faces move onto that surface and the " +
      "neighbours follow. Makes a face flush with a reference face. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds", "targetId", "targetFaceId"],
      properties: {
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        targetId: { type: "number" },
        targetFaceId: { type: "string" },
      },
    },
  },
  {
    name: "extend",
    description:
      "Extend by `distance` millimetres: a Sheet past its boundary edges (`edgeIds` — edges " +
      "with one adjacent face), or a curve past its free ends (`vertexIds` — the end vertices " +
      "of an open curve). `shape`: `linear` continues straight along the tangent, `natural` " +
      "continues the curvature, `soft` blends smoothly, `reflective` mirrors the curvature; " +
      "by default linear for a Sheet and natural for a curve. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "distance"],
      properties: {
        id: { type: "number" },
        edgeIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Boundary edges of a Sheet" },
        vertexIds: { ...TOPOLOGY_IDS_SCHEMA, description: "End vertices of a curve" },
        distance: { type: "number" },
        shape: { type: "string", enum: ["linear", "soft", "reflective", "natural"] },
      },
    },
  },
  {
    name: "untrim",
    description:
      "Restore faces to their whole underlying surface, without the cuts and holes that " +
      "trimmed them. Each face leaves its body: the untrimmed face keeps the body's id as a " +
      "Sheet and the rest of the body becomes separate Sheets (in `created`). `keepEdges` " +
      "imprints the old outline on the restored surface. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds"],
      properties: {
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        keepEdges: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "reverse",
    description:
      "Flip direction: of curves (start and end swap — matters for sweeps and lofts), or of " +
      "Sheets (their normals turn over — matters for thicken and offset). Curves or Sheets, " +
      "not a mix. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: BODY_IDS_SCHEMA },
    },
  },
  {
    name: "unwrap_faces",
    description:
      "Flatten faces of one body into a planar Sheet — the development of a cylinder or cone " +
      "wall, for example. The new Sheet is placed at the world origin in the XY plane and " +
      "returned in `created`; the body stays as it is. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds"],
      properties: { id: { type: "number" }, faceIds: TOPOLOGY_IDS_SCHEMA },
    },
  },
  {
    name: "isoparam",
    description:
      "Add edges on one face along an isoparametric direction of its surface, splitting the " +
      "face. `direction` is `u` or `v` — which way each runs depends on the surface (on a " +
      "cylinder wall `u` gives lines along the axis, `v` gives rings), so check the result " +
      "with get_body_topology. `param` (between 0 and 1, default 0.5) places a single edge; " +
      "with `count` above 1 the edges are spread evenly. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceId", "direction"],
      properties: {
        id: { type: "number" },
        faceId: { type: "string" },
        direction: { type: "string", enum: ["u", "v"] },
        param: { type: "number", default: 0.5 },
        count: { type: "number", default: 1 },
      },
    },
  },
  {
    name: "complete_edges",
    description:
      "Extend edges that end inside a face (left by imprint without completion) until they " +
      "reach the boundary of the face, so that the face is split. Edges that are already " +
      "complete are left alone. Clears the selection in the window. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "edgeIds"],
      properties: { id: { type: "number" }, edgeIds: TOPOLOGY_IDS_SCHEMA },
    },
  },
  {
    name: "imprint",
    description:
      "Add edges to body `id` without changing its shape — to split faces for the face tools. " +
      "`curveIds`: the curves are projected onto the body, along the surface normals or along " +
      "`direction` when given. `toolIds`: edges appear where those bodies cross the target; " +
      "`imprintTools: true` marks the tools too. `complete` says how far the new edges run: " +
      "`none` exactly as projected (they may end inside a face and split nothing), `edge` on " +
      "to the next edges so the faces are split, `boundary` (curves only) on around the " +
      "whole body. The curves and tools stay. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number" },
        curveIds: { ...BODY_IDS_SCHEMA, description: "Curves to project onto the body" },
        toolIds: { ...BODY_IDS_SCHEMA, description: "Bodies that cross the target" },
        complete: { type: "string", enum: ["none", "edge", "boundary"], default: "none" },
        direction: { ...VEC3_SCHEMA, description: "Curves only: projection direction [x, y, z]" },
        imprintTools: { type: "boolean", default: false, description: "Bodies only" },
      },
    },
  },
  {
    name: "dissolve_edges",
    description:
      "Remove edges of one body and merge the faces they separate — the reverse of imprint. " +
      "With `edgeIds` only those edges; they must lie between faces of one surface. Without " +
      "`edgeIds` every redundant edge of the body is removed — or, when `id` is a curve, its " +
      "redundant vertices (the ones in the middle of a straight run); the selection in the " +
      "window is then cleared. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "number" }, edgeIds: TOPOLOGY_IDS_SCHEMA },
    },
  },
  {
    name: "refillet",
    description:
      "Change the radius of existing fillets of one body, given their faces: `radius` sets it " +
      "in millimetres, `delta` adds to it (negative reduces). Pass one of the two. Fillet " +
      "faces are the non-planar faces with `radiusMm` in get_body_topology. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds"],
      properties: {
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        radius: { type: "number" },
        delta: { type: "number" },
      },
    },
  },
  {
    name: "duplicate_faces",
    description:
      "Copy faces of one body into a new Sheet (in `created`); the body stays as it is. With " +
      "`solid: true` the copy is a Solid — the faces must then enclose a volume, for example " +
      "all faces of a boss together with what closes it. " +
      IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds"],
      properties: {
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        solid: { type: "boolean", default: false },
      },
    },
  },
];

const uniform = (factor: number | [number, number, number]): [number, number, number] =>
  typeof factor === "number" ? [factor, factor, factor] : factor;

const handlers: ToolFamily["handlers"] = {
  move_faces: async (rawArgs) => {
    const args = MoveFacesArgs.parse(rawArgs ?? {});
    return ok(await native.moveFaces(args.id, args.faceIds, args.delta));
  },

  rotate_faces: async (rawArgs) => {
    const args = RotateFacesArgs.parse(rawArgs ?? {});
    return ok(await native.rotateFaces(args.id, args.faceIds, args.axis, args.angle, args.pivot));
  },

  scale_faces: async (rawArgs) => {
    const args = ScaleFacesArgs.parse(rawArgs ?? {});
    return ok(await native.scaleFaces(args.id, args.faceIds, uniform(args.factor), args.pivot));
  },

  move_edges: async (rawArgs) => {
    const args = MoveEdgesArgs.parse(rawArgs ?? {});
    return ok(await native.moveEdges(args.id, args.edgeIds, args.delta));
  },

  offset: async (rawArgs) => {
    const args = OffsetArgs.parse(rawArgs ?? {});
    if (args.curveIds) {
      return ok(await native.offsetCurves(args.curveIds, args.distance, args.bothSides, args.gapFill));
    }
    if (args.regionIds) return ok(await native.offsetRegions(args.regionIds, args.distance, args.gapFill));
    if (args.vertexIds) return ok(await native.offsetVertices(args.id!, args.vertexIds, Math.abs(args.distance)));
    const target = args.edgeIds ? { edgeIds: args.edgeIds } : { faceIds: args.faceIds!, loops: args.loops };
    return ok(
      await native.offset(args.id!, target, args.distance, { bothSides: args.bothSides, gapFill: args.gapFill }),
    );
  },

  match_faces: async (rawArgs) => {
    const args = MatchFacesArgs.parse(rawArgs ?? {});
    return ok(await native.matchFaces(args.id, args.faceIds, args.targetId, args.targetFaceId));
  },

  extend: async (rawArgs) => {
    const args = ExtendArgs.parse(rawArgs ?? {});
    if (args.edgeIds) return ok(await native.extendSheet(args.id, args.edgeIds, args.distance, args.shape));
    return ok(await native.extendCurve(args.id, args.vertexIds!, args.distance, args.shape));
  },

  untrim: async (rawArgs) => {
    const args = UntrimArgs.parse(rawArgs ?? {});
    return ok(await native.untrim(args.id, args.faceIds, args.keepEdges));
  },

  reverse: async (rawArgs) => {
    const args = ReverseArgs.parse(rawArgs ?? {});
    return ok(await native.reverse(args.ids));
  },

  unwrap_faces: async (rawArgs) => {
    const args = UnwrapFacesArgs.parse(rawArgs ?? {});
    return ok(await native.unwrapFaces(args.id, args.faceIds));
  },

  isoparam: async (rawArgs) => {
    const args = IsoparamArgs.parse(rawArgs ?? {});
    return ok(await native.isoparam(args.id, args.faceId, args.direction, args.param, args.count));
  },

  complete_edges: async (rawArgs) => {
    const args = CompleteEdgesArgs.parse(rawArgs ?? {});
    return ok(await native.completeEdges(args.id, args.edgeIds));
  },

  imprint: async (rawArgs) => {
    const args = ImprintArgs.parse(rawArgs ?? {});
    const source = args.curveIds
      ? { curveIds: args.curveIds, direction: args.direction }
      : { toolIds: args.toolIds!, imprintTools: args.imprintTools };
    return ok(await native.imprint(args.id, source, args.complete));
  },

  dissolve_edges: async (rawArgs) => {
    const args = DissolveEdgesArgs.parse(rawArgs ?? {});
    return ok(await native.dissolveEdges(args.id, args.edgeIds));
  },

  refillet: async (rawArgs) => {
    const args = RefilletArgs.parse(rawArgs ?? {});
    const change = args.radius !== undefined ? { radiusMm: args.radius } : { deltaMm: args.delta! };
    return ok(await native.refillet(args.id, args.faceIds, change));
  },

  duplicate_faces: async (rawArgs) => {
    const args = DuplicateFacesArgs.parse(rawArgs ?? {});
    return ok(await native.duplicateFaces(args.id, args.faceIds, args.solid));
  },
};

export const faces: ToolFamily = { tools, handlers };
