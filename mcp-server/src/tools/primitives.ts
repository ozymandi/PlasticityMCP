import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { native, ok, type ToolFamily, VEC3_SCHEMA, Vec3Mm } from "./shared.js";

/** Primitive solids. */

const CreateBoxArgs = z.object({
  origin: Vec3Mm,
  size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  name: z.string().optional(),
});

const CreateSphereArgs = z.object({
  center: Vec3Mm,
  radius: z.number().positive(),
  name: z.string().optional(),
});

const CreateCylinderArgs = z.object({
  base: Vec3Mm,
  radius: z.number().positive(),
  height: z.number().positive(),
  axis: Vec3Mm.optional().refine((a) => !a || Math.hypot(...a) > 0, "axis must be non-zero"),
  name: z.string().optional(),
});

const tools: Tool[] = [
  {
    name: "create_box",
    description:
      "Create a native B-Rep box (Solid), axis-aligned. Units: millimetres. `origin` is the " +
      "minimum corner, `size` is [x, y, z] extents. Returns the created body with its stable id " +
      "and bounds. Undoable.",
    inputSchema: {
      type: "object",
      required: ["origin", "size"],
      properties: {
        origin: VEC3_SCHEMA,
        size: VEC3_SCHEMA,
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_sphere",
    description:
      "Create a native B-Rep sphere (Solid). Units: millimetres. Returns the created body with " +
      "its stable id and bounds. Undoable.",
    inputSchema: {
      type: "object",
      required: ["center", "radius"],
      properties: {
        center: VEC3_SCHEMA,
        radius: { type: "number" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_cylinder",
    description:
      "Create a native B-Rep cylinder (Solid). Units: millimetres. `base` is the centre of the " +
      "bottom cap; the cylinder extends `height` along `axis` (default [0, 0, 1]). Returns the " +
      "created body with its stable id and bounds. Undoable.",
    inputSchema: {
      type: "object",
      required: ["base", "radius", "height"],
      properties: {
        base: VEC3_SCHEMA,
        radius: { type: "number" },
        height: { type: "number" },
        axis: VEC3_SCHEMA,
        name: { type: "string" },
      },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  create_box: async (rawArgs) => {
    const args = CreateBoxArgs.parse(rawArgs ?? {});
    return ok(await native.createBox(args.origin, args.size, args.name));
  },

  create_sphere: async (rawArgs) => {
    const args = CreateSphereArgs.parse(rawArgs ?? {});
    return ok(await native.createSphere(args.center, args.radius, args.name));
  },

  create_cylinder: async (rawArgs) => {
    const args = CreateCylinderArgs.parse(rawArgs ?? {});
    return ok(
      await native.createCylinder(args.base, args.radius, args.height, args.axis, args.name),
    );
  },
};

export const primitives: ToolFamily = { tools, handlers };
