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
  BOX_SCHEMA,
  BoxMm,
} from "./shared.js";

/** Topology and the operations on Solids and Sheets: boolean, cut, faces, edges, patch, join. */

const GetBodyTopologyArgs = z.object({
  id: BodyId,
  include: z.enum(["faces", "edges", "all"]).optional().default("all"),
  box: BoxMm.optional(),
  kinds: z.array(z.enum(["line", "circle", "curve"])).min(1).optional(),
});

const BooleanArgs = z.object({
  operation: z.enum(["union", "difference", "intersection"]),
  targetIds: BodyIds,
  toolIds: BodyIds,
  keepTools: z.boolean().optional().default(false),
});

const oneCornerKind = (a: { edgeIds?: string[]; vertexIds?: string[] }) =>
  a.edgeIds === undefined || a.vertexIds === undefined;
const ONE_CORNER_KIND_MESSAGE = "pass edgeIds (a body) or vertexIds (a curve), not both";

const FilletArgs = z
  .object({
    id: BodyId,
    edgeIds: TopologyIds.optional(),
    vertexIds: TopologyIds.optional(),
    radius: z.number().positive(),
    shape: z.enum(["round", "conic", "g2"]).optional(),
    rho: z.number().gt(0).lt(1).optional(),
  })
  .refine(oneCornerKind, ONE_CORNER_KIND_MESSAGE)
  .refine((a) => (a.shape === undefined && a.rho === undefined) || a.edgeIds !== undefined, "shape and rho apply to edges of a Solid / Sheet");

const ChamferArgs = z
  .object({
    id: BodyId,
    edgeIds: TopologyIds.optional(),
    vertexIds: TopologyIds.optional(),
    distance: z.number().positive(),
    distance2: z.number().positive().optional(),
  })
  .refine(oneCornerKind, ONE_CORNER_KIND_MESSAGE)
  .refine((a) => a.distance2 === undefined || a.edgeIds !== undefined, "distance2 applies to edges of a Solid / Sheet");

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
    continuity: z.enum(["G0", "G1", "G2"]).optional(),
    topology: z.enum(["multiple", "minimal", "single"]).optional(),
    smoothness: z.enum(["sharp", "smooth"]).optional(),
    fill: z.enum(["smooth", "preferPlane", "planeOnly", "nonSmooth"]).optional(),
    guideIds: BodyIds.optional(),
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
  sides: z.number().int().min(3).optional(),
  twist: z.number().optional(),
});

const RemoveFilletsArgs = z.object({
  ids: BodyIds,
  maxRadius: z.number().positive().optional(),
  convexity: z.enum(["any", "convex", "concave"]).optional().default("any"),
});

const JoinArgs = z
  .object({
    ids: BodyIds.min(2).optional(),
    id: BodyId.optional(),
    faceIds: TopologyIds.min(2).optional(),
  })
  .refine((a) => (a.ids === undefined) !== (a.id === undefined), "pass either ids, or id with faceIds")
  .refine((a) => (a.id === undefined) === (a.faceIds === undefined), "id and faceIds go together");

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
      "curve ends) and its control points (id, position). A Solid / Sheet with spline faces " +
      "also lists `controlPoints` — the control points of its surfaces (none on planes, " +
      "cylinders and the like; raise_degree on a face creates them). Millimetres. IMPORTANT: these ids " +
      "are valid only until the body changes — re-read after every operation on it. `include` " +
      "limits the output for Solids and Sheets with many faces. A full listing of a detailed " +
      "body is very long (a hundred edges is tens of thousands of tokens), so on such a body " +
      "ask for a part of it: `box` ({min, max}) keeps only what lies inside the box — edges " +
      "and segments with their start, middle and end inside, faces by their centre, vertices " +
      "and control points by position; `kinds` keeps only edges / segments of those kinds. A " +
      "thin box picks the edges in one plane or along one line. With a filter the result has " +
      "`matched` counts; `faceCount` / `edgeCount` stay the totals of the body.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number" },
        include: { type: "string", enum: ["faces", "edges", "all"], default: "all" },
        box: BOX_SCHEMA,
        kinds: {
          type: "array",
          minItems: 1,
          items: { type: "string", enum: ["line", "circle", "curve"] },
          description: "Only edges / segments of these kinds",
        },
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
    name: "fillet",
    description:
      "Round corners with a constant `radius` in millimetres. On a Solid / Sheet: the edges " +
      "`edgeIds`. On a curve: the corner vertices `vertexIds`, or every corner of the curve " +
      "when neither list is given. The ids come from get_body_topology of the same body or " +
      "curve, read after its last change. On edges, `shape`: round (default, a circular " +
      "section), conic with `rho` between 0 and 1 (lower is flatter, higher is fuller), or g2 " +
      "(curvature-continuous: the seams with the neighbouring faces measure G2 — for moulded, " +
      "class-A looking edges; on many edges at once it can fail where round works, so blend " +
      "fewer edges per call). Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "radius"],
      properties: {
        id: { type: "number" },
        edgeIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Edges of a Solid / Sheet" },
        vertexIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Corner vertices of a curve" },
        radius: { type: "number" },
        shape: { type: "string", enum: ["round", "conic", "g2"] },
        rho: { type: "number", description: "Conic only, between 0 and 1" },
      },
    },
  },
  {
    name: "chamfer",
    description:
      "Bevel corners by `distance` in millimetres, measured along each side. On a Solid / " +
      "Sheet: the edges `edgeIds`. On a curve: the corner vertices `vertexIds`, or every " +
      "corner when neither list is given. The ids come from get_body_topology of the same " +
      "body or curve, read after its last change. On edges, `distance2` makes an asymmetric " +
      "chamfer: `distance` into one face and `distance2` into the other (which face gets " +
      "which follows the edge's direction — swap the values if it comes out reversed). Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "distance"],
      properties: {
        id: { type: "number" },
        edgeIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Edges of a Solid / Sheet" },
        vertexIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Corner vertices of a curve" },
        distance: { type: "number" },
        distance2: { type: "number", description: "Second distance for an asymmetric chamfer (edges only)" },
      },
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
      "cutters stay. Curves can be targets too: they are cut where the cutter curves " +
      "(`curveIds`) cross them — the way to split a curve at a point. Undoable.",
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
      "into a Solid. The curves stay. Options (not for capping all holes of a Sheet): " +
      "`continuity` G0 (flat, default) / G1 (tangent to the neighbouring faces, a dome) / G2 " +
      "(curvature-continuous), one value for the whole loop; `topology` multiple (default — a " +
      "cornered opening is split into triangles meeting in the middle) / minimal / single (one " +
      "face; with G1 / G2 only on a boundary without corners); `smoothness` sharp / smooth " +
      "(same limit as single); `fill` smooth / preferPlane / planeOnly / nonSmooth for curves, " +
      "regions and Solid edges; `guideIds` — curves the surface follows, for an opening in a " +
      "Sheet only, each ending exactly at boundary vertices. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        curveIds: { ...BODY_IDS_SCHEMA, description: "Closed curves" },
        regionIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Region ids from list_regions" },
        id: { type: "number" },
        edgeIds: { ...TOPOLOGY_IDS_SCHEMA, description: "Edges around one opening of body `id`" },
        continuity: { type: "string", enum: ["G0", "G1", "G2"] },
        topology: { type: "string", enum: ["multiple", "minimal", "single"] },
        smoothness: { type: "string", enum: ["sharp", "smooth"] },
        fill: { type: "string", enum: ["smooth", "preferPlane", "planeOnly", "nonSmooth"] },
        guideIds: { ...BODY_IDS_SCHEMA, description: "Guide curves ending at boundary vertices" },
      },
    },
  },
  {
    name: "pipe",
    description:
      "Round tubes along curves. `diameter` (millimetres) is the diameter of a solid rod. With " +
      "`wallThickness` the result is hollow: the bore keeps `diameter` and the wall is added " +
      "around it, so the outer diameter is diameter + 2 × wallThickness. One Solid per curve, " +
      "in `created`; the curves stay. `sides` (3 or more) makes a regular polygon section " +
      "of that diameter instead of a circle (a hexagonal bar), `twist` (degrees) turns the " +
      "section along the path. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids", "diameter"],
      properties: {
        ids: { ...BODY_IDS_SCHEMA, description: "Curves to run the tubes along" },
        diameter: { type: "number" },
        wallThickness: { type: "number", default: 0 },
        sides: { type: "number", description: "Polygon section with this many sides" },
        twist: { type: "number", description: "Degrees along the path" },
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
      "Join into one. With `ids`, bodies of one kind: curves that touch end to end become one " +
      "curve — needed to use several pieces (lines and arcs) as one sweep path; Sheets that " +
      "share edges become one Sheet, or a Solid when together they close a volume. The result " +
      "keeps the first id and is returned in `changed`; the others are in `removedIds`. With " +
      "`id` + `faceIds`: faces of one body that lie on the same surface are merged into one " +
      "face. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { ...BODY_IDS_SCHEMA, minItems: 2 },
        id: { type: "number" },
        faceIds: { ...TOPOLOGY_IDS_SCHEMA, minItems: 2 },
      },
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
    return ok(await native.topology(args.id, args.include, { boxMm: args.box, kinds: args.kinds }));
  },

  boolean: async (rawArgs) => {
    const args = BooleanArgs.parse(rawArgs ?? {});
    return ok(
      await native.boolean(args.operation, args.targetIds, args.toolIds, args.keepTools),
    );
  },

  fillet: async (rawArgs) => {
    const args = FilletArgs.parse(rawArgs ?? {});
    if (args.edgeIds) {
      return ok(await native.filletEdges(args.id, args.edgeIds, args.radius, { shape: args.shape, rho: args.rho }));
    }
    return ok(await native.filletCurve(args.id, args.radius, args.vertexIds));
  },

  chamfer: async (rawArgs) => {
    const args = ChamferArgs.parse(rawArgs ?? {});
    if (args.edgeIds) return ok(await native.chamferEdges(args.id, args.edgeIds, args.distance, args.distance2));
    // On a curve the native fillet with a negative radius is the chamfer.
    return ok(await native.filletCurve(args.id, -args.distance, args.vertexIds));
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
    const { continuity, topology, smoothness, fill, guideIds } = args;
    const options = { continuity, topology, smoothness, fill, guideIds };
    if (args.curveIds) return ok(await native.patch({ curveIds: args.curveIds }, options));
    if (args.regionIds) return ok(await native.patch({ regionIds: args.regionIds }, options));
    return ok(await native.patch({ id: args.id!, edgeIds: args.edgeIds }, options));
  },

  pipe: async (rawArgs) => {
    const args = PipeArgs.parse(rawArgs ?? {});
    return ok(await native.pipe(args.ids, args.diameter, args.wallThickness, { sides: args.sides, twistDeg: args.twist }));
  },

  remove_fillets: async (rawArgs) => {
    const args = RemoveFilletsArgs.parse(rawArgs ?? {});
    return ok(await native.removeFillets(args.ids, args.maxRadius, args.convexity));
  },

  join: async (rawArgs) => {
    const args = JoinArgs.parse(rawArgs ?? {});
    if (args.ids) return ok(await native.join(args.ids));
    return ok(await native.joinFaces(args.id!, args.faceIds!));
  },

  unjoin: async (rawArgs) => {
    const args = UnjoinArgs.parse(rawArgs ?? {});
    if (args.ids) return ok(await native.unjoin(args.ids));
    return ok(await native.unjoinFaces(args.id!, args.faceIds!));
  },
};

export const solids: ToolFamily = { tools, handlers };
