import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  BODY_IDS_SCHEMA,
  BodyId,
  BodyIds,
  Direction,
  native,
  ok,
  type ToolFamily,
  TOPOLOGY_IDS_SCHEMA,
  TopologyIds,
  VEC3_SCHEMA,
  Vec3Mm,
} from "./shared.js";

/** Checking and measuring: validity, open edges, measurements kept in the document, continuity, section view. */

const CheckBodiesArgs = z.object({
  ids: BodyIds,
});

const FindBoundaryEdgesArgs = z.object({
  id: BodyId,
  select: z.boolean().optional().default(false),
});

const MeasurementEnd = z.object({ id: BodyId, point: Vec3Mm });

const AddMeasurementArgs = z
  .object({
    from: MeasurementEnd.optional(),
    to: MeasurementEnd.optional(),
    id: BodyId.optional(),
    edgeId: z.string().min(1).optional(),
    name: z.string().trim().min(1).optional(),
  })
  .refine((a) => (a.from === undefined) !== (a.id === undefined), "pass either from and to, or id with edgeId")
  .refine((a) => (a.from === undefined) === (a.to === undefined), "from and to go together")
  .refine((a) => (a.id === undefined) === (a.edgeId === undefined), "id and edgeId go together");

const DeleteMeasurementsArgs = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

const MeasureContinuityArgs = z.object({
  id: BodyId,
  edgeIds: TopologyIds,
});

const SetSectionViewArgs = z.object({
  origin: Vec3Mm,
  normal: Direction,
});

const NO_ARGS = { type: "object" as const, properties: {} };

const END_SCHEMA = {
  type: "object",
  required: ["id", "point"],
  properties: {
    id: { type: "number", description: "Body the point belongs to" },
    point: { ...VEC3_SCHEMA, description: "A vertex, an edge end / quarter / middle, a circle centre or a face centre [x, y, z]" },
  },
};

const tools: Tool[] = [
  {
    name: "check_bodies",
    description:
      "Check bodies with Plasticity's geometry kernel: for each, `valid` and the list of " +
      "`faultCodes` (empty for a sound body). Run it after risky operations — booleans, " +
      "deleted faces, imports — before relying on a body.",
    inputSchema: { type: "object", required: ["ids"], properties: { ids: BODY_IDS_SCHEMA } },
  },
  {
    name: "find_boundary_edges",
    description:
      "Find the open edges of a Solid / Sheet — the edges that belong to one face only, i.e. " +
      "the rim of every opening — with their ids (for patch, extend, bridge). A sound Solid " +
      "has none, so this shows why a body is still a Sheet. `select: true` also selects them " +
      "in the window.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "number" }, select: { type: "boolean", default: false } },
    },
  },
  {
    name: "add_measurement",
    description:
      "Add a measurement to the document: it is drawn in the window, listed in the Outliner " +
      "and follows the geometry. Either a straight distance between two points (`from`, `to`: " +
      "each a body `id` and a `point` of it that Plasticity can attach to — a vertex, the " +
      "end, quarter or middle of an edge, the centre of a circle or of a face; take them from " +
      "get_body_topology), or the radius of a circular edge (`id` + `edgeId`). Returns the " +
      "measurement with its value in millimetres. For a number only, no measurement is " +
      "needed: distances follow from the coordinates in get_body_topology. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        from: END_SCHEMA,
        to: END_SCHEMA,
        id: { type: "number", description: "Body with the circular edge" },
        edgeId: { type: "string", description: "A circular edge, for a radius" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "list_measurements",
    description:
      "List the measurements kept in the document: id, kind (distance / radius), name, the " +
      "bodies they are attached to, the value in millimetres and the measured points. A " +
      "distance made by hand along an axis also reports that `axis`.",
    inputSchema: NO_ARGS,
  },
  {
    name: "delete_measurements",
    description: "Delete measurements by id. Clears the selection in the window. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: { type: "array", items: { type: "number" }, minItems: 1 } },
    },
  },
  {
    name: "measure_continuity",
    description:
      "Measure how smoothly the two faces along each edge meet: `gapMm` (largest distance " +
      "between them), `angleDeg` (largest angle between their normals) and `curvatureChange` " +
      "(largest relative jump of curvature), and the `continuity` that follows — G0 touching, " +
      "G1 tangent, G2 curvature-continuous, or none. A sharp corner is G0 with its angle; a " +
      "fillet meets its neighbours G1. Nothing in the document changes. Edge ids come from " +
      "get_body_topology.",
    inputSchema: {
      type: "object",
      required: ["id", "edgeIds"],
      properties: { id: { type: "number" }, edgeIds: TOPOLOGY_IDS_SCHEMA },
    },
  },
  {
    name: "set_section_view",
    description:
      "Cut the view with a plane to look inside: everything on the side of the plane that " +
      "`normal` points to is left out of the picture; `origin` is a point on the plane. The " +
      "model itself is not changed — follow with screenshot to see the section. This is a " +
      "display state of the window: it is not an undo step and stays until " +
      "clear_section_view.",
    inputSchema: {
      type: "object",
      required: ["origin", "normal"],
      properties: {
        origin: VEC3_SCHEMA,
        normal: { ...VEC3_SCHEMA, description: "Direction of the side that is cut away [x, y, z]" },
      },
    },
  },
  {
    name: "clear_section_view",
    description: "Remove the section view set by set_section_view; the whole model is shown again.",
    inputSchema: NO_ARGS,
  },
];

const handlers: ToolFamily["handlers"] = {
  check_bodies: async (rawArgs) => {
    const args = CheckBodiesArgs.parse(rawArgs ?? {});
    const bodies = await native.checkBodies(args.ids);
    return ok({ allValid: bodies.every((b) => b.valid), bodies });
  },

  find_boundary_edges: async (rawArgs) => {
    const args = FindBoundaryEdgesArgs.parse(rawArgs ?? {});
    return ok(await native.findBoundaryEdges(args.id, args.select));
  },

  add_measurement: async (rawArgs) => {
    const args = AddMeasurementArgs.parse(rawArgs ?? {});
    if (args.id !== undefined) return ok(await native.addRadiusMeasurement(args.id, args.edgeId!, args.name));
    return ok(
      await native.addDistanceMeasurement(
        { id: args.from!.id, pointMm: args.from!.point },
        { id: args.to!.id, pointMm: args.to!.point },
        args.name,
      ),
    );
  },

  list_measurements: async () => {
    const measurements = await native.listMeasurements();
    return ok({ count: measurements.length, measurements });
  },

  delete_measurements: async (rawArgs) => {
    const args = DeleteMeasurementsArgs.parse(rawArgs ?? {});
    return ok(await native.deleteMeasurements(args.ids));
  },

  measure_continuity: async (rawArgs) => {
    const args = MeasureContinuityArgs.parse(rawArgs ?? {});
    return ok({ id: args.id, edges: await native.measureContinuity(args.id, args.edgeIds) });
  },

  set_section_view: async (rawArgs) => {
    const args = SetSectionViewArgs.parse(rawArgs ?? {});
    return ok(await native.setSectionView(args.origin, args.normal));
  },

  clear_section_view: async () => ok(await native.clearSectionView()),
};

export const measure: ToolFamily = { tools, handlers };
