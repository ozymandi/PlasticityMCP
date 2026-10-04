import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { native, ok, type ToolFamily, VEC3_SCHEMA, Vec3Mm } from "./shared.js";

/** Curve creation. */

const CreatePolylineArgs = z.object({
  points: z.array(Vec3Mm).min(2),
  closed: z.boolean().optional().default(false),
  name: z.string().optional(),
});

const CreateSplineArgs = z.object({
  points: z.array(Vec3Mm).min(3),
  closed: z.boolean().optional().default(false),
  name: z.string().optional(),
});

const CreateCircleArgs = z.object({
  center: Vec3Mm,
  radius: z.number().positive(),
  normal: Vec3Mm.optional().refine((a) => !a || Math.hypot(...a) > 0, "normal must be non-zero"),
  name: z.string().optional(),
});

const CreateArcArgs = z.object({
  start: Vec3Mm,
  through: Vec3Mm,
  end: Vec3Mm,
  name: z.string().optional(),
});

const CreateArcCenterArgs = z.object({
  center: Vec3Mm,
  start: Vec3Mm,
  angle: z
    .number()
    .refine((a) => a !== 0 && Math.abs(a) < 360, "angle must be non-zero and within ±360"),
  normal: Vec3Mm.optional().refine((a) => !a || Math.hypot(...a) > 0, "normal must be non-zero"),
  name: z.string().optional(),
});

const CreateEllipseArgs = z.object({
  center: Vec3Mm,
  majorRadius: z.number().positive(),
  minorRadius: z.number().positive(),
  normal: Vec3Mm.optional().refine((a) => !a || Math.hypot(...a) > 0, "normal must be non-zero"),
  majorDirection: Vec3Mm.optional().refine(
    (a) => !a || Math.hypot(...a) > 0,
    "majorDirection must be non-zero",
  ),
  name: z.string().optional(),
});

const POINTS_SCHEMA = {
  type: "array",
  items: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
  description: "Points [[x, y, z], ...] in millimetres",
};

const tools: Tool[] = [
  {
    name: "create_polyline",
    description:
      "Create a curve (Wire) of straight segments through `points` (at least 2, millimetres). " +
      "`closed` joins the last point back to the first — a closed planar polyline is a profile " +
      "for extrude_profile (a rectangle or polygon is just a closed polyline). Undoable.",
    inputSchema: {
      type: "object",
      required: ["points"],
      properties: {
        points: POINTS_SCHEMA,
        closed: { type: "boolean", default: false },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_spline",
    description:
      "Create a smooth curve (Wire) that passes through `points` (at least 3, millimetres). " +
      "`closed` makes it a loop. Undoable.",
    inputSchema: {
      type: "object",
      required: ["points"],
      properties: {
        points: POINTS_SCHEMA,
        closed: { type: "boolean", default: false },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_circle",
    description:
      "Create a circle (Wire) with `center` and `radius` in millimetres, lying in the plane " +
      "perpendicular to `normal` (default [0, 0, 1]). Undoable.",
    inputSchema: {
      type: "object",
      required: ["center", "radius"],
      properties: {
        center: VEC3_SCHEMA,
        radius: { type: "number" },
        normal: { ...VEC3_SCHEMA, description: "Plane normal direction [x, y, z]" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_arc",
    description:
      "Create a circular arc (Wire) from `start` through `through` to `end` (millimetres). The " +
      "three points must not be collinear. Undoable.",
    inputSchema: {
      type: "object",
      required: ["start", "through", "end"],
      properties: {
        start: VEC3_SCHEMA,
        through: VEC3_SCHEMA,
        end: VEC3_SCHEMA,
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_arc_center",
    description:
      "Create a circular arc (Wire) around `center`, starting at `start` and turning through " +
      "`angle` degrees by the right-hand rule about `normal` (default [0, 0, 1]); a negative " +
      "angle turns the other way. `start` must lie in the plane through `center` perpendicular " +
      "to `normal`. For a full circle use create_circle. Undoable.",
    inputSchema: {
      type: "object",
      required: ["center", "start", "angle"],
      properties: {
        center: VEC3_SCHEMA,
        start: VEC3_SCHEMA,
        angle: { type: "number", description: "Degrees, non-zero, between -360 and 360" },
        normal: { ...VEC3_SCHEMA, description: "Plane normal direction [x, y, z]" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_ellipse",
    description:
      "Create an ellipse (Wire) with `center`, `majorRadius` and `minorRadius` in millimetres, " +
      "in the plane perpendicular to `normal` (default [0, 0, 1]). `majorDirection` is the " +
      "direction of the major axis (projected into the plane); by default the X axis, or Y " +
      "when the normal is X. Undoable.",
    inputSchema: {
      type: "object",
      required: ["center", "majorRadius", "minorRadius"],
      properties: {
        center: VEC3_SCHEMA,
        majorRadius: { type: "number" },
        minorRadius: { type: "number" },
        normal: { ...VEC3_SCHEMA, description: "Plane normal direction [x, y, z]" },
        majorDirection: { ...VEC3_SCHEMA, description: "Direction of the major axis [x, y, z]" },
        name: { type: "string" },
      },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  create_polyline: async (rawArgs) => {
    const args = CreatePolylineArgs.parse(rawArgs ?? {});
    return ok(await native.createPolyline(args.points, args.closed, args.name));
  },

  create_spline: async (rawArgs) => {
    const args = CreateSplineArgs.parse(rawArgs ?? {});
    return ok(await native.createSpline(args.points, args.closed, args.name));
  },

  create_circle: async (rawArgs) => {
    const args = CreateCircleArgs.parse(rawArgs ?? {});
    return ok(await native.createCircle(args.center, args.radius, args.normal, args.name));
  },

  create_arc: async (rawArgs) => {
    const args = CreateArcArgs.parse(rawArgs ?? {});
    return ok(await native.createArc(args.start, args.through, args.end, args.name));
  },

  create_arc_center: async (rawArgs) => {
    const args = CreateArcCenterArgs.parse(rawArgs ?? {});
    return ok(
      await native.createArcCenter(args.center, args.start, args.angle, args.normal, args.name),
    );
  },

  create_ellipse: async (rawArgs) => {
    const args = CreateEllipseArgs.parse(rawArgs ?? {});
    return ok(
      await native.createEllipse(
        args.center,
        args.majorRadius,
        args.minorRadius,
        args.normal,
        args.majorDirection,
        args.name,
      ),
    );
  },
};

export const curves: ToolFamily = { tools, handlers };
