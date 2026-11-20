import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  BodyId,
  Direction,
  native,
  ok,
  type ToolFamily,
  TOPOLOGY_IDS_SCHEMA,
  TopologyIds,
  VEC3_SCHEMA,
  Vec3Mm,
} from "./shared.js";

/** Surfaces: a blend between sheets, a surface through points, hidden spans. */

const BridgeEnd = z.object({ id: BodyId, faceId: z.string().min(1), near: Vec3Mm });

const BridgeSurfaceArgs = z.object({
  first: BridgeEnd,
  second: BridgeEnd,
  width: z.number().positive(),
  shape: z.enum(["g2", "conic", "chamfer"]).optional().default("g2"),
  softness: z.number().positive().optional().default(1),
  trimWalls: z.boolean().optional(),
  trimBlend: z.enum(["none", "short", "long", "both"]).optional(),
});

const ConstrainedSurfaceArgs = z.object({
  points: z.array(Vec3Mm).min(4),
  normals: z.array(Direction).optional(),
  tolerance: z.number().positive().optional().default(0.01),
  optimize: z.enum(["performance", "smoothness"]).optional().default("performance"),
});

const LoftEdgesArgs = z.object({
  ends: z
    .array(z.union([BodyId, z.object({ id: BodyId, edgeId: z.string().min(1) })]))
    .min(2),
  tangency: z.enum(["natural", "free", "clamped"]).optional(),
  startMagnitude: z.number().positive().optional(),
  endMagnitude: z.number().positive().optional(),
  join: z.boolean().optional().default(false),
  guideIds: z.array(BodyId).optional(),
});

const RemoveNominalSurfaceArgs = z.object({
  id: BodyId,
  faceIds: TopologyIds,
});

const BRIDGE_END_SCHEMA = {
  type: "object",
  required: ["id", "faceId", "near"],
  properties: {
    id: { type: "number", description: "Sheet id" },
    faceId: { type: "string", description: "Face of that Sheet, from get_body_topology" },
    near: { ...VEC3_SCHEMA, description: "A point on the face near where the blend should start" },
  },
};

const POINTS_SCHEMA = {
  type: "array",
  items: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
  minItems: 4,
  description: "Points [[x, y, z], ...] in millimetres",
};

const tools: Tool[] = [
  {
    name: "bridge_surface",
    description:
      "Blend two Sheets into one with a smooth transition surface `width` millimetres wide " +
      "between a face of each — like a fillet between two separate Sheets. The two surfaces " +
      "must meet at an angle when extended (a floor and a wall with a gap between them); " +
      "parallel or coplanar faces cannot be bridged; the width must be larger than the gap. " +
      "`shape` is `g2` (curvature-continuous, default), `conic` (a circular, cylindrical " +
      "blend) or `chamfer` (flat); `softness` tunes how full the blend is. `trimWalls: false` " +
      "leaves both Sheets untouched and returns the blend as a new Sheet; `trimBlend` none / " +
      "short / long / both (default) trims the blend's ends to the Sheets. Otherwise the Sheets are " +
      "trimmed to the blend and joined: the first keeps its id (in `changed`), the second is " +
      "in `removedIds`. Undoable.",
    inputSchema: {
      type: "object",
      required: ["first", "second", "width"],
      properties: {
        first: BRIDGE_END_SCHEMA,
        second: BRIDGE_END_SCHEMA,
        width: { type: "number" },
        shape: { type: "string", enum: ["g2", "conic", "chamfer"], default: "g2" },
        trimWalls: { type: "boolean", default: true },
        trimBlend: { type: "string", enum: ["none", "short", "long", "both"], default: "both" },
        softness: { type: "number", default: 1 },
      },
    },
  },
  {
    name: "constrained_surface",
    description:
      "Create a smooth Sheet that passes through `points` (at least four, millimetres) — a " +
      "surface over scattered measurements or over the corners of a frame. `normals`, one " +
      "direction per point, say which way the surface faces there; without them it is fitted " +
      "freely. `tolerance` (millimetres, default 0.01) is how closely the points are met; " +
      "`optimize` is `performance` or `smoothness`. The Sheet reaches somewhat beyond the " +
      "points and is not trimmed to them. Undoable.",
    inputSchema: {
      type: "object",
      required: ["points"],
      properties: {
        points: POINTS_SCHEMA,
        normals: { ...POINTS_SCHEMA, description: "One direction [x, y, z] per point" },
        tolerance: { type: "number", default: 0.01 },
        optimize: { type: "string", enum: ["performance", "smoothness"], default: "performance" },
      },
    },
  },
  {
    name: "loft_edges",
    description:
      "Loft a Sheet between boundary edges of Sheets and curves, in the given order — to join " +
      "two open tubes, continue a panel, or bridge a gap so the new surface flows out of the " +
      "existing ones. Each of `ends` is a curve id or { id, edgeId } (an edge with one face, " +
      "from get_body_topology). An opening bounded by several edges is one end: list all its " +
      "edges — connected edges are chained into one end, in any order (a square rim of four " +
      "edges to a circle edge works). `guideIds`: curves the surface follows from end to end, " +
      "touching each end; a curved guide works only between curve ends — with Sheet edges the " +
      "kernel fails, so make them curves with curves_from_edges first. `tangency` (one value for the loft): `clamped` continues the " +
      "face next to each edge (smooth, G1 or better after join), `free` (default) or " +
      "`natural` (no tangency, can pinch). `startMagnitude` / `endMagnitude` (default 1) " +
      "scale the tangent at the ends: a tight bend needs less (0.6 for a 90° elbow of tubes " +
      "of radius 10 with 30 mm between their ends); too long a tangent fails. `join: true` " +
      "joins the loft to the source Sheets (the first keeps its id; a failed join keeps the loft " +
      "and reports `joinError`). Undoable.",
    inputSchema: {
      type: "object",
      required: ["ends"],
      properties: {
        ends: {
          type: "array",
          minItems: 2,
          items: {
            anyOf: [
              { type: "number", description: "Curve id" },
              {
                type: "object",
                required: ["id", "edgeId"],
                properties: { id: { type: "number" }, edgeId: { type: "string" } },
              },
            ],
          },
        },
        tangency: { type: "string", enum: ["natural", "free", "clamped"] },
        startMagnitude: { type: "number" },
        endMagnitude: { type: "number" },
        join: { type: "boolean", default: false },
        guideIds: { type: "array", items: { type: "number" }, description: "Guide curves" },
      },
    },
  },
  {
    name: "remove_nominal_surface",
    description:
      "Reveal the hidden spans of control points of spline faces: Plasticity keeps extra " +
      "spans beyond the visible face for editing, and this makes them part of the face's " +
      "control points so that rebuild can then clean them up. The shape does not change. " +
      "Face ids come from get_body_topology. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "faceIds"],
      properties: { id: { type: "number" }, faceIds: TOPOLOGY_IDS_SCHEMA },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  bridge_surface: async (rawArgs) => {
    const args = BridgeSurfaceArgs.parse(rawArgs ?? {});
    const end = (e: z.infer<typeof BridgeEnd>) => ({ id: e.id, faceId: e.faceId, nearMm: e.near });
    return ok(await native.bridgeSurface(end(args.first), end(args.second), args.width, args.shape, args.softness,
      { trimWalls: args.trimWalls, trimBlend: args.trimBlend }));
  },

  constrained_surface: async (rawArgs) => {
    const args = ConstrainedSurfaceArgs.parse(rawArgs ?? {});
    return ok(await native.constrainedSurface(args.points, args.normals, args.tolerance, args.optimize));
  },

  loft_edges: async (rawArgs) => {
    const args = LoftEdgesArgs.parse(rawArgs ?? {});
    const { tangency, startMagnitude, endMagnitude, join, guideIds } = args;
    return ok(await native.loftEdges(args.ends, { tangency, startMagnitude, endMagnitude, join, guideIds }));
  },

  remove_nominal_surface: async (rawArgs) => {
    const args = RemoveNominalSurfaceArgs.parse(rawArgs ?? {});
    return ok(await native.removeNominalSurface(args.id, args.faceIds));
  },
};

export const surfaces: ToolFamily = { tools, handlers };
