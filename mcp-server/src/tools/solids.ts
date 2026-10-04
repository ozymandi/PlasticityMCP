import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BODY_IDS_SCHEMA, BodyId, BodyIds, native, ok, type ToolFamily } from "./shared.js";

/** Topology and operations on the faces and edges of a body. */

const TopologyIds = z.array(z.string().min(1)).min(1);

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

const TOPOLOGY_IDS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  description: "Face / edge ids from get_body_topology",
};

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
};

export const solids: ToolFamily = { tools, handlers };
