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

/** Projection: curves onto bodies, intersections, outlines, flattening onto a plane. */

const ProjectArgs = z
  .object({
    curveIds: BodyIds.optional(),
    targetId: BodyId.optional(),
    direction: Direction.optional(),
    bodyIds: BodyIds.min(2).optional(),
  })
  .refine((a) => (a.curveIds === undefined) !== (a.bodyIds === undefined), "pass either curveIds or bodyIds")
  .refine(
    (a) => a.bodyIds === undefined || (a.targetId === undefined && a.direction === undefined),
    "targetId and direction go with curveIds",
  )
  .refine(
    (a) => a.curveIds === undefined || a.targetId !== undefined || a.curveIds.length === 2,
    "without targetId pass exactly two curves",
  )
  .refine((a) => a.direction === undefined || a.targetId !== undefined, "direction needs targetId");

const CreateOutlineArgs = z
  .object({
    ids: BodyIds,
    flat: z.boolean().optional().default(false),
    planeOrigin: Vec3Mm.optional(),
    planeNormal: Direction.optional(),
  })
  .refine((a) => a.planeOrigin === undefined || a.planeNormal !== undefined, "planeOrigin goes with planeNormal");

const DuplicateAndProjectArgs = z
  .object({
    curveIds: BodyIds.optional(),
    id: BodyId.optional(),
    edgeIds: TopologyIds.optional(),
    planeOrigin: Vec3Mm.optional().default([0, 0, 0]),
    planeNormal: Direction.optional().default([0, 0, 1]),
  })
  .refine((a) => (a.curveIds === undefined) !== (a.id === undefined), "pass either curveIds, or id with edgeIds")
  .refine((a) => (a.id === undefined) === (a.edgeIds === undefined), "id and edgeIds go together");

const tools: Tool[] = [
  {
    name: "project",
    description:
      "Create curves by projection; what is projected stays as it is (to mark a body itself " +
      "use imprint). Three ways. `curveIds` + `targetId`: the curves are projected onto that " +
      "Solid / Sheet — along `direction` when given, otherwise onto the nearest surface along " +
      "its normals — and come back as curves lying on it. `bodyIds` (two or more): the lines " +
      "where the first body and the others cross. `curveIds` with exactly two planar curves " +
      "and no `targetId`: one curve in space that looks like the first curve from its side " +
      "and like the second from its side (a top view and a side view of the same path). The " +
      "new curves are in `created`. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        curveIds: { ...BODY_IDS_SCHEMA, description: "Curves to project" },
        targetId: { type: "number", description: "Solid / Sheet to project the curves onto" },
        direction: { ...VEC3_SCHEMA, description: "Projection direction [x, y, z]; needs targetId" },
        bodyIds: { ...BODY_IDS_SCHEMA, minItems: 2, description: "Bodies whose crossing lines are wanted" },
      },
    },
  },
  {
    name: "create_outline",
    description:
      "Create the outline (silhouette) of Solids / Sheets as curves, seen along the normal of " +
      "a plane. The plane is `planeNormal` with an optional `planeOrigin` (default the world " +
      "origin) — [0, 0, 1] gives a top view, [1, 0, 0] a side view; without them it is the " +
      "active construction plane of the Plasticity window (see set_construction_plane). By " +
      "default the curves lie in space on the bodies themselves; with `flat: true` they are " +
      "projected onto the plane — a flat profile of the part's footprint for " +
      "extrude_profile. The curves are in `created`; the bodies stay. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: BODY_IDS_SCHEMA,
        flat: { type: "boolean", default: false },
        planeOrigin: VEC3_SCHEMA,
        planeNormal: { ...VEC3_SCHEMA, description: "Viewing direction: the plane normal [x, y, z]" },
      },
    },
  },
  {
    name: "duplicate_and_project",
    description:
      "Copy curves (`curveIds`), or edges of one body (`id` + `edgeIds`), and flatten the " +
      "copies onto the plane through `planeOrigin` with normal `planeNormal` (default the " +
      "world XY plane): every point is moved onto the plane along its normal. The flat " +
      "copies are in `created`; the originals stay. Turns edges of a part or a curve in " +
      "space into a planar sketch. Edge ids come from get_body_topology. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        curveIds: { ...BODY_IDS_SCHEMA, description: "Curves to copy and flatten" },
        id: { type: "number", description: "Body whose edges are taken" },
        edgeIds: TOPOLOGY_IDS_SCHEMA,
        planeOrigin: VEC3_SCHEMA,
        planeNormal: { ...VEC3_SCHEMA, description: "Plane normal direction [x, y, z], default [0, 0, 1]" },
      },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  project: async (rawArgs) => {
    const args = ProjectArgs.parse(rawArgs ?? {});
    if (args.bodyIds) return ok(await native.project({ bodyIds: args.bodyIds }));
    return ok(
      await native.project({ curveIds: args.curveIds!, targetId: args.targetId, direction: args.direction }),
    );
  },

  create_outline: async (rawArgs) => {
    const args = CreateOutlineArgs.parse(rawArgs ?? {});
    const plane = args.planeNormal
      ? { originMm: args.planeOrigin ?? ([0, 0, 0] as [number, number, number]), normal: args.planeNormal }
      : undefined;
    return ok(await native.createOutline(args.ids, args.flat, plane));
  },

  duplicate_and_project: async (rawArgs) => {
    const args = DuplicateAndProjectArgs.parse(rawArgs ?? {});
    const source = args.curveIds ? { curveIds: args.curveIds } : { id: args.id!, edgeIds: args.edgeIds! };
    return ok(await native.duplicateAndProject(source, args.planeOrigin, args.planeNormal));
  },
};

export const projection: ToolFamily = { tools, handlers };
