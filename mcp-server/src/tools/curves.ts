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
  VEC3_SCHEMA,
  Vec3Mm,
} from "./shared.js";

/** Curve creation. */

type Vec3 = [number, number, number];

const CreatePolylineArgs = z.object({
  points: z.array(Vec3Mm).min(2),
  closed: z.boolean().optional().default(false),
  name: z.string().optional(),
});

const CreateSplineArgs = z.object({
  points: z.array(Vec3Mm).min(3),
  closed: z.boolean().optional().default(false),
  controlPoints: z.boolean().optional().default(false),
  name: z.string().optional(),
});

const CreateCircleArgs = z
  .object({
    center: Vec3Mm.optional(),
    radius: z.number().positive().optional(),
    points: z.array(Vec3Mm).min(2).max(3).optional(),
    normal: Direction.optional(),
    name: z.string().optional(),
  })
  .refine(
    (a) => (a.points === undefined) !== (a.center === undefined) && (a.center === undefined) === (a.radius === undefined),
    "pass either center with radius, or points",
  );

const CreateRectangleArgs = z
  .object({
    origin: Vec3Mm.optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    centered: z.boolean().optional().default(false),
    normal: Direction.optional(),
    xDirection: Direction.optional(),
    points: z.array(Vec3Mm).length(3).optional(),
    name: z.string().optional(),
  })
  .refine(
    (a) =>
      (a.points === undefined) !== (a.origin === undefined) &&
      (a.origin === undefined) === (a.width === undefined) &&
      (a.origin === undefined) === (a.height === undefined),
    "pass either origin with width and height, or points",
  );

const CreatePolygonArgs = z.object({
  center: Vec3Mm,
  radius: z.number().positive(),
  sides: z.number().int().min(3).max(200),
  normal: Direction.optional(),
  radiusTo: z.enum(["vertex", "side"]).optional().default("vertex"),
  xDirection: Direction.optional(),
  name: z.string().optional(),
});

const CreateSpiralArgs = z.object({
  base: Vec3Mm,
  axis: Direction.optional(),
  height: z.number().positive(),
  radius: z.number().positive(),
  turns: z.number().positive(),
  handedness: z.enum(["right", "left"]).optional().default("right"),
  startDirection: Direction.optional(),
  name: z.string().optional(),
});

const CreateTextArgs = z.object({
  text: z.string().trim().min(1),
  size: z.number().positive(),
  origin: Vec3Mm.optional(),
  normal: Direction.optional(),
  xDirection: Direction.optional(),
});

const CreateSlotArgs = z.object({
  ids: BodyIds,
  width: z.number().positive(),
});

const SegmentRef = z.object({ id: BodyId, segmentId: z.string().min(1) });

const CreateTangentArcArgs = z.object({
  id: BodyId,
  segmentId: z.string().min(1),
  at: z.enum(["start", "end"]),
  end: Vec3Mm,
  flip: z.boolean().optional().default(false),
});

const CreateTangentCircleArgs = z.object({
  first: SegmentRef,
  second: SegmentRef,
  radius: z.number().positive(),
  near: Vec3Mm,
  normal: Direction.optional(),
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

const NORMAL_SCHEMA = { ...VEC3_SCHEMA, description: "Plane normal direction [x, y, z], default [0, 0, 1]" };

const X_DIRECTION_SCHEMA = {
  ...VEC3_SCHEMA,
  description: "Direction of the local x axis in the plane [x, y, z]; default the world X axis",
};

const SEGMENT_REF_SCHEMA = {
  type: "object",
  required: ["id", "segmentId"],
  properties: {
    id: { type: "number", description: "Curve id" },
    segmentId: { type: "string", description: "Segment id from get_body_topology of that curve" },
  },
};

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
      "With `controlPoints: true` the points are its control polygon instead: the curve starts " +
      "and ends at the first and last point and is only pulled towards the others. `closed` " +
      "makes it a loop. Undoable.",
    inputSchema: {
      type: "object",
      required: ["points"],
      properties: {
        points: POINTS_SCHEMA,
        closed: { type: "boolean", default: false },
        controlPoints: { type: "boolean", default: false },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_circle",
    description:
      "Create a circle (Wire), in millimetres. Either `center` and `radius`, in the plane " +
      "perpendicular to `normal` (default [0, 0, 1]); or `points`: three points the circle " +
      "passes through, or two points at the ends of a diameter (the plane is then the one " +
      "perpendicular to `normal`, which must be perpendicular to the diameter). Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        center: VEC3_SCHEMA,
        radius: { type: "number" },
        points: { ...POINTS_SCHEMA, minItems: 2, maxItems: 3 },
        normal: { ...VEC3_SCHEMA, description: "Plane normal direction [x, y, z]" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_rectangle",
    description:
      "Create a rectangle as one closed curve (Wire) — a profile for extrude_profile. Either " +
      "`origin` with `width` (along the local x axis) and `height` (along y) in the plane " +
      "perpendicular to `normal`: `origin` is the corner, or the centre with `centered: true`; " +
      "or three `points`: the two ends of one side and a point on the opposite side. " +
      "Millimetres. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        origin: VEC3_SCHEMA,
        width: { type: "number" },
        height: { type: "number" },
        centered: { type: "boolean", default: false },
        normal: NORMAL_SCHEMA,
        xDirection: X_DIRECTION_SCHEMA,
        points: { ...POINTS_SCHEMA, minItems: 3, maxItems: 3 },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_polygon",
    description:
      "Create a regular polygon with `sides` sides as one closed curve (Wire), around `center` " +
      "in the plane perpendicular to `normal`. `radius` (millimetres) reaches the vertices; " +
      "with `radiusTo: \"side\"` it reaches the middles of the sides — the across-flats size " +
      "of a hexagon is then 2 × radius. One vertex lies along `xDirection`. Undoable.",
    inputSchema: {
      type: "object",
      required: ["center", "radius", "sides"],
      properties: {
        center: VEC3_SCHEMA,
        radius: { type: "number" },
        sides: { type: "number" },
        normal: NORMAL_SCHEMA,
        radiusTo: { type: "string", enum: ["vertex", "side"], default: "vertex" },
        xDirection: X_DIRECTION_SCHEMA,
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_spiral",
    description:
      "Create a helix (Wire): `turns` turns of `radius` around the axis that starts at `base` " +
      "and runs `height` millimetres along `axis` (default [0, 0, 1]). `handedness` is " +
      "`right` or `left`; the curve starts in `startDirection` from the axis. A path for " +
      "sweep_profile (springs, threads) or pipe. Undoable.",
    inputSchema: {
      type: "object",
      required: ["base", "height", "radius", "turns"],
      properties: {
        base: VEC3_SCHEMA,
        axis: { ...VEC3_SCHEMA, description: "Axis direction [x, y, z], default [0, 0, 1]" },
        height: { type: "number" },
        radius: { type: "number" },
        turns: { type: "number" },
        handedness: { type: "string", enum: ["right", "left"], default: "right" },
        startDirection: { ...VEC3_SCHEMA, description: "Direction from the axis to the start of the curve" },
        name: { type: "string" },
      },
    },
  },
  {
    name: "create_text",
    description:
      "Create text as curves (Wires): closed outlines, one or more per letter, in " +
      "Plasticity's built-in font. `size` is the letter height in millimetres. The baseline " +
      "starts at `origin` and runs along `xDirection` in the plane perpendicular to `normal`. " +
      "The outlines are profiles: list_regions gives the regions of the letters for " +
      "extrude_profile. All curves come back in `created`; one undo step.",
    inputSchema: {
      type: "object",
      required: ["text", "size"],
      properties: {
        text: { type: "string" },
        size: { type: "number" },
        origin: VEC3_SCHEMA,
        normal: NORMAL_SCHEMA,
        xDirection: X_DIRECTION_SCHEMA,
      },
    },
  },
  {
    name: "create_slot",
    description:
      "Create slot outlines: a closed curve `width` millimetres wide around each of the given " +
      "curves, with round ends. The curves must be planar and define a plane — a polyline " +
      "with a bend, an arc, a spline; a single straight line is refused (draw that slot with " +
      "create_rectangle and fillet). The outlines are in `created`; the curves stay. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids", "width"],
      properties: { ids: { ...BODY_IDS_SCHEMA, description: "Curves to build slots around" }, width: { type: "number" } },
    },
  },
  {
    name: "create_tangent_arc",
    description:
      "Create an arc (Wire) that continues a curve smoothly: it leaves the `start` or `end` " +
      "(`at`) of segment `segmentId` of curve `id` along the tangent there and ends at point " +
      "`end`. `flip: true` takes the arc that leaves in the opposite direction. The new arc " +
      "is a separate curve — join it to the first one with join. Undoable.",
    inputSchema: {
      type: "object",
      required: ["id", "segmentId", "at", "end"],
      properties: {
        id: { type: "number" },
        segmentId: { type: "string", description: "Segment id from get_body_topology of the curve" },
        at: { type: "string", enum: ["start", "end"] },
        end: VEC3_SCHEMA,
        flip: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "create_tangent_circle",
    description:
      "Create a circle (Wire) of `radius` millimetres that touches two curve segments, " +
      "`first` and `second`. Usually several such circles exist (one in each corner the " +
      "curves make): the one nearest to point `near` is made. `normal` is the plane normal " +
      "(default [0, 0, 1]). Undoable.",
    inputSchema: {
      type: "object",
      required: ["first", "second", "radius", "near"],
      properties: {
        first: SEGMENT_REF_SCHEMA,
        second: SEGMENT_REF_SCHEMA,
        radius: { type: "number" },
        near: VEC3_SCHEMA,
        normal: NORMAL_SCHEMA,
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
    return ok(await native.createSpline(args.points, args.closed, args.name, args.controlPoints));
  },

  create_circle: async (rawArgs) => {
    const args = CreateCircleArgs.parse(rawArgs ?? {});
    if (args.points) return ok(await native.createCircleThrough(args.points, args.normal, args.name));
    return ok(await native.createCircle(args.center!, args.radius!, args.normal, args.name));
  },

  create_rectangle: async (rawArgs) => {
    const args = CreateRectangleArgs.parse(rawArgs ?? {});
    const spec = args.points
      ? { pointsMm: args.points as [Vec3, Vec3, Vec3] }
      : {
          originMm: args.origin!,
          widthMm: args.width!,
          heightMm: args.height!,
          centered: args.centered,
          normal: args.normal,
          xDirection: args.xDirection,
        };
    return ok(await native.createRectangle(spec, args.name));
  },

  create_polygon: async (rawArgs) => {
    const args = CreatePolygonArgs.parse(rawArgs ?? {});
    return ok(
      await native.createPolygon(
        args.center,
        args.radius,
        args.sides,
        args.normal,
        args.radiusTo,
        args.xDirection,
        args.name,
      ),
    );
  },

  create_spiral: async (rawArgs) => {
    const args = CreateSpiralArgs.parse(rawArgs ?? {});
    return ok(
      await native.createSpiral(
        args.base,
        args.axis ?? [0, 0, 1],
        args.height,
        args.radius,
        args.turns,
        args.handedness,
        args.startDirection,
        args.name,
      ),
    );
  },

  create_text: async (rawArgs) => {
    const args = CreateTextArgs.parse(rawArgs ?? {});
    return ok(await native.createText(args.text, args.size, args.origin, args.normal, args.xDirection));
  },

  create_slot: async (rawArgs) => {
    const args = CreateSlotArgs.parse(rawArgs ?? {});
    return ok(await native.createSlot(args.ids, args.width));
  },

  create_tangent_arc: async (rawArgs) => {
    const args = CreateTangentArcArgs.parse(rawArgs ?? {});
    return ok(
      await native.createTangentArc({ id: args.id, segmentId: args.segmentId }, args.at, args.end, args.flip),
    );
  },

  create_tangent_circle: async (rawArgs) => {
    const args = CreateTangentCircleArgs.parse(rawArgs ?? {});
    return ok(await native.createTangentCircle(args.first, args.second, args.radius, args.near, args.normal));
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
