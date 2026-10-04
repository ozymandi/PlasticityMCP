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
} from "./shared.js";

/** Topology and the operations on Solids and Sheets: boolean, cut, faces, edges, patch, join. */

const GetBodyTopologyArgs = z.object({
  id: BodyId,
  include: z.enum(["faces", "edges", "all"]).optional().default("all"),
});

const BooleanArgs = z.object({
  operation: z.enum(["union", "difference", "intersection"]),
  targetIds: BodyIds,
  toolIds: BodyIds,
  keepTools: z.boolean().optional().default(false),
});

const FilletEdgesArgs = z.object({
  id: BodyId,
  edgeIds: TopologyIds,
  radius: z.number().positive(),
});

const ChamferEdgesArgs = z.object({
  id: BodyId,
  edgeIds: TopologyIds,
  distance: z.number().positive(),
});

const ExtrudeFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  distance: z.number().refine((d) => d !== 0, "distance must be non-zero"),
});

const nonZero = (what: string) => z.number().refine((d) => d !== 0, `${what} must be non-zero`);

const CutArgs = z
  .object({
    targetIds: BodyIds,
    curveIds: BodyIds.optional(),
    cutterId: BodyId.optional(),
    faceIds: TopologyIds.optional(),
    extend: z.boolean().optional().default(false),
    direction: Direction.optional(),
  })
  .refine(
    (a) => (a.curveIds === undefined) !== (a.cutterId === undefined),
    "pass either curveIds, or cutterId with faceIds",
  )
  .refine(
    (a) => (a.cutterId === undefined) === (a.faceIds === undefined),
    "cutterId and faceIds go together",
  );

const HollowArgs = z.object({
  id: BodyId,
  thickness: z.number().positive(),
  faceIds: TopologyIds.optional(),
  outward: z.boolean().optional().default(false),
});

const ThickenArgs = z
  .object({
    id: BodyId,
    faceIds: TopologyIds.optional(),
    front: z.number().nonnegative().optional().default(0),
    back: z.number().nonnegative().optional().default(0),
  })
  .refine((a) => a.front + a.back > 0, "front or back must be positive");

const OffsetFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  distance: nonZero("distance"),
});

const DraftFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  referenceFaceId: z.string().min(1),
  angle: nonZero("angle").refine((a) => Math.abs(a) < 90, "angle must be between -90 and 90"),
});

const DeleteFacesArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
  heal: z.boolean().optional().default(true),
});

const PatchArgs = z
  .object({
    curveIds: BodyIds.optional(),
    regionIds: RegionIds.optional(),
    id: BodyId.optional(),
    edgeIds: TopologyIds.optional(),
  })
  .refine(
    (a) => [a.curveIds, a.regionIds, a.id].filter((v) => v !== undefined).length === 1,
    "pass exactly one of curveIds, regionIds or id",
  )
  .refine((a) => a.edgeIds === undefined || a.id !== undefined, "edgeIds need the body id");

const PipeArgs = z.object({
  ids: BodyIds,
  diameter: z.number().positive(),
  wallThickness: z.number().nonnegative().optional().default(0),
});

const RemoveFilletsArgs = z.object({
  ids: BodyIds,
  maxRadius: z.number().positive().optional(),
  convexity: z.enum(["any", "convex", "concave"]).optional().default("any"),
});

const JoinArgs = z.object({
  ids: BodyIds.min(2),
});

const UnjoinArgs = z
  .object({
    ids: BodyIds.optional(),
    id: BodyId.optional(),
    faceIds: TopologyIds.optional(),
  })
  .refine((a) => (a.ids === undefined) !== (a.id === undefined), "pass either ids, or id with faceIds")
  .refine((a) => (a.id === undefined) === (a.faceIds === undefined), "id and faceIds go together");

const FACE_IDS_NOTE =
  "`faceIds` come from get_body_topology of the same body, read after its last change.";

const tools: Tool[] = [
  {
    name: "get_body_topology",
    description:
      "What one body is made of, with the ids that the editing tools take. For a Solid / Sheet: " +
      "faces (id, surface type, planar, centre, outward normal, radius if round, edge ids) and " +
      "edges (id, kind line / circle / curve, length, start / mid / end points, radius for " +
      "circles, adjacent face ids). For a curve: whether it is closed, its segments (id, kind, " +
      "length, start / mid / end), its vertices (id, position — where segments meet or the " +
      "curve ends) and its control points (id, position). Millimetres. IMPORTANT: these ids " +
      "are valid only until the body changes — re-read after every operation on it. `include` " +
      "limits the output for Solids and Sheets with many faces.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number" },
        include: { type: "string", enum: ["faces", "edges", "all"], default: "all" },
      },
    },
  },
  {
    name: "boolean",
    description:
      "Boolean operation on bodies: `union` merges tools into targets, `difference` subtracts " +
      "tools from targets, `intersection` keeps the common volume. Targets keep their ids and " +
      "come back in `changed`; tools are consumed (in `removedIds`) unless keepTools is true. " +
      "Undoable.",
    inputSchema: {
      type: "object",
      required: ["operation", "targetIds", "toolIds"],
      properties: {
        operation: { type: "string", enum: ["union", "difference", "intersection"] },
        targetIds: BODY_IDS_SCHEMA,
        toolIds: BODY_IDS_SCHEMA,
        keepTools: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "fillet_edges",
    description:
      "Round edges of one body with a constant `radius` in millimetres. `edgeIds` come from " +
      "get_body_topology of the same body, read after its last change. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "edgeIds", "radius"],
      properties: { id: { type: "number" }, edgeIds: TOPOLOGY_IDS_SCHEMA, radius: { type: "number" } },
    },
  },
  {
    name: "chamfer_edges",
    description:
      "Bevel edges of one body by `distance` in millimetres. `edgeIds` come from " +
      "get_body_topology of the same body, read after its last change. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "edgeIds", "distance"],
      properties: { id: { type: "number" }, edgeIds: TOPOLOGY_IDS_SCHEMA, distance: { type: "number" } },
    },
  },
  {
    name: "extrude_faces",
    description:
      "Extrude faces of one body along their normals by `distance` millimetres. On a Solid it " +
      "is a push / pull: positive adds material outward, negative cuts into the body, and the " +
      "body keeps its id. On a Sheet the extrusion becomes a new Solid (in `created`) and the " +
      "Sheet stays. `faceIds` come from get_body_topology of the same body, read after its " +
      "last change. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds", "distance"],
      properties: { id: { type: "number" }, faceIds: TOPOLOGY_IDS_SCHEMA, distance: { type: "number" } },
    },
  },
  {
    name: "cut",
    description:
      "Cut Solids / Sheets into pieces. Cutters are either curves (`curveIds`) or faces of " +
      "another body (`cutterId` + `faceIds`). A curve cuts with the surface it sweeps along " +
      "`direction` — by default the normal of the curve's plane — so a straight line plus a " +
      "`direction` cuts along any plane; `extend: true` lengthens a curve that stops short of " +
      "the body. A face cuts with its whole surface, however small the face is. One piece " +
      "keeps the id of its target (in `changed`), the other pieces are in `created`; the " +
      "cutters stay. Undoable.",
    inputSchema: {
      type: "object",
      required: ["targetIds"],
      properties: {
        targetIds: BODY_IDS_SCHEMA,
        curveIds: { ...BODY_IDS_SCHEMA, description: "Curves to cut with" },
        cutterId: { type: "number", description: "Body whose faces cut (not one of the targets)" },
        faceIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Faces of cutterId to cut with" },
        extend: { type: "boolean", default: false, description: "Curves only" },
        direction: { ...VEC3_SCHEMA, description: "Curves only: sweep direction [x, y, z]" },
      },
    },
  },
  {
    name: "hollow",
    description:
      "Turn a Solid into a shell with walls `thickness` millimetres thick. With `faceIds` " +
      "those faces are removed and become the opening (a box with its top face → an open " +
      "tray); without them the cavity is closed inside. The wall is built inward from the " +
      "existing faces, so the outer size stays; `outward: true` builds it outward instead. " +
      FACE_IDS_NOTE +
      " The body keeps its id. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "thickness"],
      properties: {
        id: { type: "number" },
        thickness: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        outward: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "thicken",
    description:
      "Give thickness in millimetres: `front` along the face normals, `back` against them. " +
      "Without `faceIds` the body must be a Sheet: it becomes a Solid and keeps its id. With " +
      "`faceIds` those faces of a Solid or Sheet are thickened into a new Solid (in `created`) " +
      "and the body stays as it is. " +
      FACE_IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        front: { type: "number", default: 0 },
        back: { type: "number", default: 0 },
      },
    },
  },
  {
    name: "offset_faces",
    description:
      "Move faces of one body along their normals by `distance` millimetres (positive outward, " +
      "negative inward); the neighbouring faces are extended or trimmed to follow. On a round " +
      "face this changes its radius. " +
      FACE_IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds", "distance"],
      properties: { id: { type: "number" }, faceIds: TOPOLOGY_IDS_SCHEMA, distance: { type: "number" } },
    },
  },
  {
    name: "draft_faces",
    description:
      "Tilt faces of one body by `angle` degrees — a draft angle for moulding. The faces pivot " +
      "where they meet the plane of `referenceFaceId`, a planar face of the same body that " +
      "stays as it is (typically the bottom). A positive angle leans the faces outward away " +
      "from the reference face. " +
      FACE_IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds", "referenceFaceId", "angle"],
      properties: {
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        referenceFaceId: { type: "string" },
        angle: { type: "number" },
      },
    },
  },
  {
    name: "delete_faces",
    description:
      "Remove faces of one body. By default (`heal: true`) the neighbouring faces are extended " +
      "to close the gap, so a Solid stays a Solid — the way to remove a fillet, a hole or a " +
      "boss by its faces. With `heal: false` the faces are just taken out and a Solid becomes " +
      "an open Sheet (close it again with patch). " +
      FACE_IDS_NOTE +
      " Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds"],
      properties: {
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
        heal: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "patch",
    description:
      "Close an opening with a surface. Pass exactly one of: `curveIds` — closed curves, each " +
      "becomes a new Sheet; `regionIds` — every boundary loop of the regions becomes a new " +
      "Sheet (holes are filled separately, not left open); `id` of a Sheet — all its holes are " +
      "capped; `id` + `edgeIds` — the closed loop of edges around one opening is filled, in " +
      "place on a Sheet, as a separate Sheet on a Solid. A Sheet that becomes watertight turns " +
      "into a Solid. The curves stay. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        curveIds: { ...BODY_IDS_SCHEMA, description: "Closed curves" },
        regionIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Region ids from list_regions" },
        id: { type: "number" },
        edgeIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Edges around one opening of body `id`" },
      },
    },
  },
  {
    name: "pipe",
    description:
      "Round tubes along curves. `diameter` (millimetres) is the diameter of a solid rod. With " +
      "`wallThickness` the result is hollow: the bore keeps `diameter` and the wall is added " +
      "around it, so the outer diameter is diameter + 2 × wallThickness. One Solid per curve, " +
      "in `created`; the curves stay. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids", "diameter"],
      properties: {
        ids: { ...BODY_IDS_SCHEMA, description: "Curves to run the tubes along" },
        diameter: { type: "number" },
        wallThickness: { type: "number", default: 0 },
      },
    },
  },
  {
    name: "remove_fillets",
    description:
      "Remove the fillets of Solids / Sheets and restore the sharp edges. `maxRadius` " +
      "(millimetres) keeps the fillets larger than it; `convexity` limits the removal to " +
      "`convex` fillets (rounded outer edges) or `concave` ones (rounded inner corners). Fails " +
      "when nothing matches. Bodies keep their ids. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: BODY_IDS_SCHEMA,
        maxRadius: { type: "number" },
        convexity: { type: "string", enum: ["any", "convex", "concave"], default: "any" },
      },
    },
  },
  {
    name: "join",
    description:
      "Join bodies of one kind into one. Curves that touch end to end become one curve — " +
      "needed to use several pieces (lines and arcs) as one sweep path. Sheets that share " +
      "edges become one Sheet, or a Solid when together they close a volume. The result keeps " +
      "the first id and is returned in `changed`; the others are in `removedIds`. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: { ...BODY_IDS_SCHEMA, minItems: 2 } },
    },
  },
  {
    name: "unjoin",
    description:
      "Take bodies apart. With `ids`: a curve is split into its segments, a Solid / Sheet into " +
      "one Sheet per face. With `id` + `faceIds`: only those faces are detached, each as a " +
      "Sheet of its own, and the rest of the body stays together as an open Sheet. One piece " +
      "keeps the original id (in `changed`), the others are in `created`. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        ids: BODY_IDS_SCHEMA,
        id: { type: "number" },
        faceIds: TOPOLOGY_IDS_SCHEMA,
      },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  get_body_topology: async (rawArgs) => {
    const args = GetBodyTopologyArgs.parse(rawArgs ?? {});
    return ok(await native.topology(args.id, args.include));
  },

  boolean: async (rawArgs) => {
    const args = BooleanArgs.parse(rawArgs ?? {});
    return ok(
      await native.boolean(args.operation, args.targetIds, args.toolIds, args.keepTools),
    );
  },

  fillet_edges: async (rawArgs) => {
    const args = FilletEdgesArgs.parse(rawArgs ?? {});
    return ok(await native.filletEdges(args.id, args.edgeIds, args.radius));
  },

  chamfer_edges: async (rawArgs) => {
    const args = ChamferEdgesArgs.parse(rawArgs ?? {});
    return ok(await native.chamferEdges(args.id, args.edgeIds, args.distance));
  },

  extrude_faces: async (rawArgs) => {
    const args = ExtrudeFacesArgs.parse(rawArgs ?? {});
    return ok(await native.extrudeFaces(args.id, args.faceIds, args.distance));
  },

  cut: async (rawArgs) => {
    const args = CutArgs.parse(rawArgs ?? {});
    const cutter = args.curveIds
      ? { curveIds: args.curveIds }
      : { id: args.cutterId!, faceIds: args.faceIds! };
    return ok(await native.cut(args.targetIds, cutter, args.extend, args.direction));
  },

  hollow: async (rawArgs) => {
    const args = HollowArgs.parse(rawArgs ?? {});
    return ok(await native.hollow(args.id, args.thickness, args.faceIds, args.outward));
  },

  thicken: async (rawArgs) => {
    const args = ThickenArgs.parse(rawArgs ?? {});
    return ok(await native.thicken(args.id, args.front, args.back, args.faceIds));
  },

  offset_faces: async (rawArgs) => {
    const args = OffsetFacesArgs.parse(rawArgs ?? {});
    return ok(await native.offsetFaces(args.id, args.faceIds, args.distance));
  },

  draft_faces: async (rawArgs) => {
    const args = DraftFacesArgs.parse(rawArgs ?? {});
    return ok(await native.draftFaces(args.id, args.faceIds, args.referenceFaceId, args.angle));
  },

  delete_faces: async (rawArgs) => {
    const args = DeleteFacesArgs.parse(rawArgs ?? {});
    return ok(await native.deleteFaces(args.id, args.faceIds, args.heal));
  },

  patch: async (rawArgs) => {
    const args = PatchArgs.parse(rawArgs ?? {});
    if (args.curveIds) return ok(await native.patch({ curveIds: args.curveIds }));
    if (args.regionIds) return ok(await native.patch({ regionIds: args.regionIds }));
    return ok(await native.patch({ id: args.id!, edgeIds: args.edgeIds }));
  },

  pipe: async (rawArgs) => {
    const args = PipeArgs.parse(rawArgs ?? {});
    return ok(await native.pipe(args.ids, args.diameter, args.wallThickness));
  },

  remove_fillets: async (rawArgs) => {
    const args = RemoveFilletsArgs.parse(rawArgs ?? {});
    return ok(await native.removeFillets(args.ids, args.maxRadius, args.convexity));
  },

  join: async (rawArgs) => {
    const args = JoinArgs.parse(rawArgs ?? {});
    return ok(await native.join(args.ids));
  },

  unjoin: async (rawArgs) => {
    const args = UnjoinArgs.parse(rawArgs ?? {});
    if (args.ids) return ok(await native.unjoin(args.ids));
    return ok(await native.unjoinFaces(args.id!, args.faceIds!));
  },
};

export const solids: ToolFamily = { tools, handlers };
