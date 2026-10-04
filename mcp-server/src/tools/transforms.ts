import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  BODY_IDS_SCHEMA,
  BodyIds,
  native,
  ok,
  type ToolFamily,
  VEC3_SCHEMA,
  Vec3Mm,
} from "./shared.js";

/** Moving, rotating, scaling, copying, mirroring and arraying bodies. */

const PositiveFactor = z.number().positive();

const MoveBodiesArgs = z.object({
  ids: BodyIds,
  delta: Vec3Mm,
});

const RotateBodiesArgs = z.object({
  ids: BodyIds,
  axis: Vec3Mm.refine((a) => Math.hypot(...a) > 0, "axis must be non-zero"),
  angle: z.number(),
  pivot: Vec3Mm.optional(),
});

const ScaleBodiesArgs = z.object({
  ids: BodyIds,
  factor: z.union([PositiveFactor, z.tuple([PositiveFactor, PositiveFactor, PositiveFactor])]),
  pivot: Vec3Mm.optional(),
});

const CopyBodiesArgs = z.object({
  ids: BodyIds,
  delta: Vec3Mm.optional(),
});

const MirrorBodiesArgs = z.object({
  ids: BodyIds,
  planeOrigin: Vec3Mm,
  planeNormal: Vec3Mm.refine((a) => Math.hypot(...a) > 0, "planeNormal must be non-zero"),
  keepOriginal: z.boolean().optional().default(true),
});

const Direction = Vec3Mm.refine((a) => Math.hypot(...a) > 0, "direction must be non-zero");

const ArrayCount = z.number().int().min(1).max(200);

const ArrayRectangularArgs = z.object({
  ids: BodyIds,
  direction1: Direction,
  count1: ArrayCount,
  spacing1: z.number().positive(),
  direction2: Direction.optional(),
  count2: ArrayCount.optional().default(1),
  spacing2: z.number().positive().optional(),
});

const ArrayRadialArgs = z.object({
  ids: BodyIds,
  center: Vec3Mm,
  axis: Direction,
  count: z.number().int().min(2).max(200),
  angle: z
    .number()
    .refine((a) => a !== 0 && Math.abs(a) <= 360, "angle must be non-zero and within ±360")
    .optional()
    .default(360),
});

const tools: Tool[] = [
  {
    name: "move_bodies",
    description:
      "Translate bodies by `delta` [x, y, z] in millimetres. Undoable. Body ids are preserved; " +
      "the moved bodies are returned in `changed` with their new bounds.",
    inputSchema: {
      type: "object",
      required: ["ids", "delta"],
      properties: { ids: BODY_IDS_SCHEMA, delta: VEC3_SCHEMA },
    },
  },
  {
    name: "rotate_bodies",
    description:
      "Rotate bodies by `angle` degrees (right-hand rule) around `axis` passing through `pivot`. " +
      "`pivot` defaults to the centre of the bodies' combined bounding box, so they turn in " +
      "place. Undoable. Rotated bodies are returned in `changed`.",
    inputSchema: {
      type: "object",
      required: ["ids", "axis", "angle"],
      properties: {
        ids: BODY_IDS_SCHEMA,
        axis: { ...VEC3_SCHEMA, description: "Rotation axis direction [x, y, z]" },
        angle: { type: "number", description: "Degrees" },
        pivot: VEC3_SCHEMA,
      },
    },
  },
  {
    name: "scale_bodies",
    description:
      "Scale bodies relative to `pivot`. `factor` is one number (uniform) or [x, y, z] per-axis " +
      "factors, all positive. `pivot` defaults to the centre of the bodies' combined bounding " +
      "box. Undoable. Scaled bodies are returned in `changed`.",
    inputSchema: {
      type: "object",
      required: ["ids", "factor"],
      properties: {
        ids: BODY_IDS_SCHEMA,
        factor: {
          anyOf: [
            { type: "number" },
            { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
          ],
        },
        pivot: VEC3_SCHEMA,
      },
    },
  },
  {
    name: "copy_bodies",
    description:
      "Make independent copies of bodies (Solids, Sheets or curves), optionally shifted by " +
      "`delta` [x, y, z] millimetres. The originals are untouched; the copies are returned in " +
      "`created` with new ids. One undo step.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: BODY_IDS_SCHEMA, delta: VEC3_SCHEMA },
    },
  },
  {
    name: "mirror_bodies",
    description:
      "Mirror bodies (Solids, Sheets or curves) across the plane through `planeOrigin` with " +
      "normal `planeNormal`. The mirrored bodies are always new bodies, returned in `created`. " +
      "With keepOriginal: false the originals are then deleted (in `removedIds`) — that " +
      "variant takes two undo steps. To merge a mirrored half with the original, follow with " +
      "boolean union. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids", "planeOrigin", "planeNormal"],
      properties: {
        ids: BODY_IDS_SCHEMA,
        planeOrigin: VEC3_SCHEMA,
        planeNormal: { ...VEC3_SCHEMA, description: "Plane normal direction [x, y, z]" },
        keepOriginal: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "array_rectangular",
    description:
      "Repeat bodies in a row or a grid. `count1` items `spacing1` millimetres apart along " +
      "`direction1`; optionally repeated `count2` times, `spacing2` apart, along `direction2`. " +
      "Counts include the original, so count1: 3 adds two copies. The copies are returned in " +
      "`created`. One undo step.",
    inputSchema: {
      type: "object",
      required: ["ids", "direction1", "count1", "spacing1"],
      properties: {
        ids: BODY_IDS_SCHEMA,
        direction1: { ...VEC3_SCHEMA, description: "Direction of the row [x, y, z]" },
        count1: { type: "number", description: "Items along direction1, original included" },
        spacing1: { type: "number", description: "Distance between items, millimetres" },
        direction2: { ...VEC3_SCHEMA, description: "Second direction [x, y, z]" },
        count2: { type: "number", default: 1 },
        spacing2: { type: "number" },
      },
    },
  },
  {
    name: "array_radial",
    description:
      "Repeat bodies around an axis: `count` items (the original included) spread evenly over " +
      "`angle` degrees (default 360) around the axis through `center` along `axis`. With 360 " +
      "the items are 360 / count apart; with a smaller angle the first and last item sit at " +
      "its two ends. The copies are returned in `created`. One undo step.",
    inputSchema: {
      type: "object",
      required: ["ids", "center", "axis", "count"],
      properties: {
        ids: BODY_IDS_SCHEMA,
        center: VEC3_SCHEMA,
        axis: { ...VEC3_SCHEMA, description: "Axis direction [x, y, z]" },
        count: { type: "number", description: "Total items, original included (2 or more)" },
        angle: { type: "number", default: 360 },
      },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  move_bodies: async (rawArgs) => {
    const args = MoveBodiesArgs.parse(rawArgs ?? {});
    return ok(await native.moveBodies(args.ids, args.delta));
  },

  rotate_bodies: async (rawArgs) => {
    const args = RotateBodiesArgs.parse(rawArgs ?? {});
    return ok(await native.rotateBodies(args.ids, args.axis, args.angle, args.pivot));
  },

  scale_bodies: async (rawArgs) => {
    const args = ScaleBodiesArgs.parse(rawArgs ?? {});
    const factors: [number, number, number] =
      typeof args.factor === "number" ? [args.factor, args.factor, args.factor] : args.factor;
    return ok(await native.scaleBodies(args.ids, factors, args.pivot));
  },

  copy_bodies: async (rawArgs) => {
    const args = CopyBodiesArgs.parse(rawArgs ?? {});
    return ok(await native.copyBodies(args.ids, args.delta));
  },

  mirror_bodies: async (rawArgs) => {
    const args = MirrorBodiesArgs.parse(rawArgs ?? {});
    return ok(
      await native.mirrorBodies(args.ids, args.planeOrigin, args.planeNormal, args.keepOriginal),
    );
  },

  array_rectangular: async (rawArgs) => {
    const args = ArrayRectangularArgs.parse(rawArgs ?? {});
    if (args.count2 > 1 && (!args.direction2 || args.spacing2 === undefined)) {
      throw new Error("count2 > 1 needs direction2 and spacing2");
    }
    return ok(
      await native.arrayRectangular(
        args.ids,
        args.direction1,
        args.count1,
        args.spacing1,
        args.direction2,
        args.count2,
        args.spacing2,
      ),
    );
  },

  array_radial: async (rawArgs) => {
    const args = ArrayRadialArgs.parse(rawArgs ?? {});
    return ok(await native.arrayRadial(args.ids, args.center, args.axis, args.count, args.angle));
  },
};

export const transforms: ToolFamily = { tools, handlers };
