#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { PlasticityClient } from "./client.js";
import { SUPPORTED_VERSION, launchPlasticity } from "./launcher.js";
import { NativeSession } from "./native.js";
import { FacetShapeType, MessageType, ObjectType } from "./protocol.js";

const client = new PlasticityClient({
  server: process.env.PLASTICITY_SERVER ?? "localhost:8980",
});

// Native CAD access over CDP (separate channel from the WS bridge above).
const native = new NativeSession();

// ---------- Tool argument schemas ----------

const ConnectArgs = z.object({
  server: z.string().optional().describe("host:port (default: localhost:8980)"),
});

const ListSceneArgs = z.object({
  visibleOnly: z.boolean().optional().default(false),
  includeMesh: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include vertex/face counts and bounding boxes (cheap). Raw arrays are never returned."),
});

const GetObjectArgs = z.object({
  id: z.number().int().nonnegative(),
  visibleOnly: z.boolean().optional().default(false),
});

const SubscribeArgs = z.object({});

const DrainEventsArgs = z.object({
  limit: z.number().int().positive().optional(),
});

const RefacetArgs = z.object({
  ids: z.array(z.number().int().nonnegative()).min(1),
  filename: z.string().optional(),
  curveChordTolerance: z.number().optional(),
  curveChordAngle: z.number().optional(),
  surfacePlaneTolerance: z.number().optional(),
  surfacePlaneAngle: z.number().optional(),
  matchTopology: z.boolean().optional(),
  maxSides: z.number().int().min(3).optional(),
  shape: z.enum(["ANY", "CUT", "CONVEX"]).optional(),
});

const PushMeshArgs = z.object({
  name: z.string(),
  positions: z.array(z.number()).describe("Flat xyz array, length = vertexCount * 3"),
  indices: z.array(z.number().int().nonnegative()).describe("Flat per-face vertex indices"),
  sizes: z
    .array(z.number().int().min(3))
    .describe("Verts per face. sum(sizes) must equal indices.length"),
  filename: z.string().optional(),
  groupName: z.string().optional().describe("Group/collection name to put the mesh under"),
  clientId: z.string().optional().describe("Stable client-side id (defaults to a random uuid-like)"),
  asSubd: z.boolean().optional().default(false),
});

const Vec3Mm = z.tuple([z.number(), z.number(), z.number()]);

const NativeLaunchArgs = z.object({
  executable: z.string().optional(),
});

const NativeConnectArgs = z.object({
  targetId: z.string().optional(),
});

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

const BodyId = z.number().int().nonnegative();

const SelectBodiesArgs = z.object({
  ids: z.array(BodyId),
});

const DeleteBodiesArgs = z.object({
  ids: z.array(BodyId).min(1),
});

const RenameBodyArgs = z.object({
  id: BodyId,
  name: z.string().trim().min(1),
});

const BodyIds = z.array(BodyId).min(1);
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

const RegionIds = z.array(z.string().min(1)).min(1);
const oneProfile = (a: { id?: number; profileId?: number; regionIds?: string[] }) =>
  ((a.id ?? a.profileId) === undefined) !== (a.regionIds === undefined);
const ONE_PROFILE_MESSAGE = "pass exactly one of the curve id or regionIds";

const ExtrudeProfileArgs = z
  .object({
    id: BodyId.optional(),
    regionIds: RegionIds.optional(),
    distance: z.number().refine((d) => d !== 0, "distance must be non-zero"),
  })
  .refine(oneProfile, ONE_PROFILE_MESSAGE);

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

const JoinCurvesArgs = z.object({
  ids: z.array(BodyId).min(2),
});

const RevolveProfileArgs = z
  .object({
    id: BodyId.optional(),
    regionIds: RegionIds.optional(),
    axisOrigin: Vec3Mm,
    axis: Vec3Mm.refine((a) => Math.hypot(...a) > 0, "axis must be non-zero"),
    angle: z
      .number()
      .min(-360)
      .max(360)
      .refine((a) => a !== 0, "angle must be non-zero")
      .optional()
      .default(360),
  })
  .refine(oneProfile, ONE_PROFILE_MESSAGE);

const SweepProfileArgs = z
  .object({
    profileId: BodyId.optional(),
    regionIds: RegionIds.optional(),
    pathId: BodyId,
    twist: z.number().optional().default(0),
    scale: z.number().positive().optional().default(1),
  })
  .refine(oneProfile, ONE_PROFILE_MESSAGE);

const LoftProfilesArgs = z
  .object({
    profileIds: z.array(BodyId).min(2).optional(),
    regionIds: z.array(z.string().min(1)).min(2).optional(),
    guideIds: z.array(BodyId).optional().default([]),
    closed: z.boolean().optional().default(false),
  })
  .refine(
    (a) => (a.profileIds === undefined) !== (a.regionIds === undefined),
    "pass exactly one of profileIds or regionIds",
  );

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

const ExportStepArgs = z.object({
  path: z.string().min(1),
  ids: BodyIds.optional(),
  overwrite: z.boolean().optional().default(false),
});

const ImportStepArgs = z.object({
  path: z.string().min(1),
});

const SaveDocumentArgs = z.object({
  path: z.string().min(1),
  overwrite: z.boolean().optional().default(false),
});

const ScreenshotArgs = z.object({
  path: z.string().min(1).optional(),
  overwrite: z.boolean().optional().default(false),
});

const SetViewArgs = z.object({
  view: z.enum(["front", "back", "left", "right", "top", "bottom", "isometric"]),
  fit: z.boolean().optional().default(true),
});

// ---------- Tool definitions ----------

const VEC3_SCHEMA = {
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
  description: "[x, y, z] in millimetres",
};

const BODY_IDS_SCHEMA = {
  type: "array",
  items: { type: "number" },
  minItems: 1,
  description: "Stable body ids (from list_bodies)",
};

const POINTS_SCHEMA = {
  type: "array",
  items: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
  description: "Points [[x, y, z], ...] in millimetres",
};

const REGION_IDS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  description: "Region ids from list_regions (alternative to the curve id)",
};

const TOPOLOGY_IDS_SCHEMA = {
  type: "array",
  items: { type: "string" },
  minItems: 1,
  description: "Face / edge ids from get_body_topology",
};

const tools: Tool[] = [
  {
    name: "connect",
    description:
      "Connect to a running Plasticity instance over WebSocket and perform handshake. " +
      "Default server is localhost:8980. Returns the set of opcodes the server supports.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", description: "host:port (default: localhost:8980)" },
      },
    },
  },
  {
    name: "status",
    description:
      "Return current connection state: connected, server, current filename and version, " +
      "supported opcodes, subscription state, and pending event count.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_scene",
    description:
      "List every object in the current Plasticity document. Returns id, name, type, parentId, " +
      "flags, materialId. With includeMesh=true also returns vertexCount/faceCount/bbox per " +
      "SOLID/SHEET. Raw vertex/face arrays are never returned (would blow up context). " +
      "Use refacet + a future export tool for full geometry.",
    inputSchema: {
      type: "object",
      properties: {
        visibleOnly: { type: "boolean", default: false },
        includeMesh: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "get_object",
    description:
      "Get a single object by plasticity id. Returns header info plus vertexCount/faceCount/bbox " +
      "if it's a SOLID/SHEET. Raw mesh arrays are not returned.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number" },
        visibleOnly: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "subscribe_changes",
    description:
      "Subscribe to live transaction events from Plasticity. After this, drain_events returns " +
      "what has happened since the last drain.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "unsubscribe_changes",
    description: "Cancel the active subscription.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "drain_events",
    description:
      "Return and clear the buffered scene events (add/update/delete/newFile/newVersion). " +
      "Optional limit caps how many to return; the rest stay buffered.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "refacet",
    description:
      "Request retessellation of given object ids with quality params. Returns per-object " +
      "vertex/index/normal counts and bounding boxes (raw arrays not returned).",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: { type: "array", items: { type: "number" } },
        filename: { type: "string" },
        curveChordTolerance: { type: "number" },
        curveChordAngle: { type: "number" },
        surfacePlaneTolerance: { type: "number" },
        surfacePlaneAngle: { type: "number" },
        matchTopology: { type: "boolean" },
        maxSides: { type: "number" },
        shape: { type: "string", enum: ["ANY", "CUT", "CONVEX"] },
      },
    },
  },
  {
    name: "push_mesh",
    description:
      "Push a single mesh into Plasticity (PUT_SOME_1). The mesh becomes a SOLID/SHEET object. " +
      "Provide flat positions [x,y,z,...], flat indices, and per-face sizes (3=tri, 4=quad, n=n-gon). " +
      "Returns the assigned plasticity stable_id and version.",
    inputSchema: {
      type: "object",
      required: ["name", "positions", "indices", "sizes"],
      properties: {
        name: { type: "string" },
        positions: { type: "array", items: { type: "number" } },
        indices: { type: "array", items: { type: "number" } },
        sizes: { type: "array", items: { type: "number" } },
        filename: { type: "string" },
        groupName: { type: "string" },
        clientId: { type: "string" },
        asSubd: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "native_launch",
    description:
      `Start Plasticity ${SUPPORTED_VERSION} with native CAD access (loopback-only debugging endpoint). ` +
      "If a window with native access is already available, returns it. Never closes a running " +
      "Plasticity: if it runs without native access, the user must close it first. " +
      "Returns the reachable windows; follow with native_connect.",
    inputSchema: {
      type: "object",
      properties: {
        executable: {
          type: "string",
          description: `Full path to the Plasticity ${SUPPORTED_VERSION} executable (default: auto-detected)`,
        },
      },
    },
  },
  {
    name: "native_connect",
    description:
      "Attach to a Plasticity window for native CAD operations (create_*, undo, redo). " +
      "With several windows open, pass targetId from native_launch. " +
      `Only Plasticity ${SUPPORTED_VERSION} is supported.`,
    inputSchema: {
      type: "object",
      properties: { targetId: { type: "string" } },
    },
  },
  {
    name: "native_status",
    description:
      "Native connection state: connected window, whether Plasticity is busy with a command, " +
      "undo/redo depth, body count, and windowVisible — false when the window is minimized or " +
      "completely covered by other windows, in which case set_view and screenshot cannot work " +
      "(modelling tools still do).",
    inputSchema: { type: "object", properties: {} },
  },
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
  {
    name: "undo",
    description:
      "Undo the last operation in the connected Plasticity window (native history, same as " +
      "Ctrl+Z). Returns which bodies appeared/disappeared.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "redo",
    description: "Redo the last undone operation in the connected Plasticity window.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_bodies",
    description:
      "List every body in the connected Plasticity document (native channel): stable id, type " +
      "(Solid / Sheet / Wire), name, bounds in millimetres, face and edge counts, and " +
      "visible / locked / selected flags. Ids are the ones used by all native tools.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_selection",
    description:
      "Return the bodies currently selected in the Plasticity window (whole bodies only, not " +
      "individual faces or edges). Use it to act on what the user has picked.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "select_bodies",
    description:
      "Replace the selection in the Plasticity window with the given body ids; an empty list " +
      "clears the selection. Not an undo step. Fails without changing anything if an id is unknown.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: { type: "array", items: { type: "number" } } },
    },
  },
  {
    name: "delete_bodies",
    description:
      "Delete bodies by id with the native Delete command. Undoable. Clears the current selection.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: { type: "array", items: { type: "number" }, minItems: 1 } },
    },
  },
  {
    name: "rename_body",
    description: "Rename a body. Undoable. Returns the updated body.",
    inputSchema: {
      type: "object",
      required: ["id", "name"],
      properties: { id: { type: "number" }, name: { type: "string" } },
    },
  },
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
    name: "get_body_topology",
    description:
      "Faces and edges of one Solid / Sheet, for use with fillet_edges, chamfer_edges and " +
      "extrude_faces. Face: id, surface type, planar, centre, outward normal, radius (if round), " +
      "edge ids. Edge: id, kind (line / circle / curve), length, start / mid / end points, " +
      "radius (circles), adjacent face ids. Millimetres. IMPORTANT: these ids are valid only " +
      "until the body changes — re-read after every operation on it. `include` limits the " +
      "output for bodies with many faces.",
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
  {
    name: "join_curves",
    description:
      "Join curves that touch end to end into one curve — needed to use several pieces (lines " +
      "and arcs) as one sweep path. The joined curve keeps the id of the first curve and is " +
      "returned in `changed`; the other curves are in `removedIds`. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: { ...BODY_IDS_SCHEMA, minItems: 2 } },
    },
  },
  {
    name: "list_regions",
    description:
      "List the regions Plasticity has built from closed loops of curves — one per enclosed " +
      "area, so a rectangle with a circle inside gives a ring (holes: 1) and a disc. A profile " +
      "drawn as several curves (lines and arcs) also shows up as a region. Each entry: id, " +
      "approximate bounds in millimetres (about 0.01 mm accurate), plane normal, number of " +
      "boundary edges, total boundary length, number of holes. Pass the ids as `regionIds` to " +
      "extrude_profile, revolve_profile, sweep_profile or loft_profiles. IMPORTANT: region ids " +
      "are valid only until curves in that plane change — re-read after creating, moving or " +
      "deleting curves.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "extrude_profile",
    description:
      "Extrude a curve by `distance` millimetres along the normal of its plane. A closed planar " +
      "curve becomes a Solid, an open curve becomes a Sheet; the new body is in `created` and " +
      "the curve is kept. Positive distance follows the plane normal (+Z for curves in the XY " +
      "plane, the `normal` given to create_circle), negative goes the other way — check the " +
      "returned bounds. A curve `id` is refused when its profile is ambiguous (other curves " +
      "in the same plane cross it or lie inside it); in that case, or for a profile made of " +
      "several curves, pass `regionIds` from list_regions instead of `id` — several regions " +
      "are extruded as one profile. Undoable.",
    inputSchema: {
      type: "object",
      required: ["distance"],
      properties: {
        id: { type: "number", description: "Stable id of the curve (Wire)" },
        regionIds: REGION_IDS_SCHEMA,
        distance: { type: "number" },
      },
    },
  },
  {
    name: "revolve_profile",
    description:
      "Revolve a curve around an axis: a closed planar curve becomes a Solid, an open curve a " +
      "Sheet; the new body is in `created` and the curve is kept. The axis passes through " +
      "`axisOrigin` along `axis`; it must lie in the plane of the profile and must not pass " +
      "through it. `angle` in degrees (default 360) follows the right-hand rule around `axis`; " +
      "negative turns the other way. A curve `id` is refused when its profile is ambiguous " +
      "(other curves in its plane cross it or lie inside it); pass `regionIds` from " +
      "list_regions instead to choose the regions. Undoable.",
    inputSchema: {
      type: "object",
      required: ["axisOrigin", "axis"],
      properties: {
        id: { type: "number", description: "Stable id of the profile curve (Wire)" },
        regionIds: REGION_IDS_SCHEMA,
        axisOrigin: VEC3_SCHEMA,
        axis: { ...VEC3_SCHEMA, description: "Axis direction [x, y, z]" },
        angle: { type: "number", default: 360, description: "Degrees, -360..360, non-zero" },
      },
    },
  },
  {
    name: "sweep_profile",
    description:
      "Sweep a profile curve along a path curve: a closed planar profile becomes a Solid, an " +
      "open one a Sheet; the new body is in `created`, both curves are kept. Draw the profile " +
      "perpendicular to the start of the path; a profile drawn away from the path keeps that " +
      "offset. Corners of a polyline path are mitred. `twist` (degrees, default 0) rotates the " +
      "profile gradually along the path, `scale` (default 1) is its relative size at the end. " +
      "A curve `profileId` is refused when its profile is ambiguous — note that a path lying " +
      "in the profile's own plane and crossing it makes it so; pass `regionIds` from " +
      "list_regions instead to choose the regions. A path made of several pieces must first " +
      "be merged with join_curves. Undoable.",
    inputSchema: {
      type: "object",
      required: ["pathId"],
      properties: {
        profileId: { type: "number", description: "Stable id of the profile curve (Wire)" },
        regionIds: REGION_IDS_SCHEMA,
        pathId: { type: "number", description: "Stable id of the path curve (Wire)" },
        twist: { type: "number", default: 0 },
        scale: { type: "number", default: 1 },
      },
    },
  },
  {
    name: "loft_profiles",
    description:
      "Loft a body through two or more profile curves, in the given order. Closed planar " +
      "profiles give a Solid, open curves give a Sheet; the two kinds cannot be mixed. The new " +
      "body is in `created`, the curves are kept. `guideIds` are curves that touch the " +
      "profiles and steer the surface between them. `closed` joins the last profile back to " +
      "the first (3+ profiles); it works for open curves, but Plasticity refuses a closed loop " +
      "of closed profiles — use revolve_profile or sweep_profile for ring-shaped solids. " +
      "Profiles that turn through more than about half a circle in total also fail. Bounds of " +
      "lofted bodies can be a few microns large. Instead of `profileIds`, `regionIds` from " +
      "list_regions (2+, in loft order) loft a Solid through chosen regions. Undoable.",
    inputSchema: {
      type: "object",
      properties: {
        profileIds: {
          type: "array",
          items: { type: "number" },
          minItems: 2,
          description: "Stable ids of the profile curves, in loft order",
        },
        regionIds: { ...REGION_IDS_SCHEMA, minItems: 2 },
        guideIds: { type: "array", items: { type: "number" } },
        closed: { type: "boolean", default: false },
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
  {
    name: "export_step",
    description:
      "Export bodies as exact B-Rep geometry to a STEP file (.step / .stp). `path` must be " +
      "absolute. Without `ids`, every Solid and Sheet of the document is exported. An existing " +
      "file is replaced only with overwrite: true. Does not change the document.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute output path ending in .step or .stp" },
        ids: BODY_IDS_SCHEMA,
        overwrite: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "import_step",
    description:
      "Add the geometry of a STEP file (.step / .stp, absolute path) to the current document. " +
      "The imported bodies are returned in `created`; their bounds can be up to a fraction of " +
      "a millimetre larger than the source because of import tolerances. Undoable.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string", description: "Absolute path of the STEP file" } },
    },
  },
  {
    name: "save_document",
    description:
      "Save a copy of the current document as a .plasticity file (`path` must be absolute). " +
      "The open document keeps its own file association — an Untitled document stays " +
      "Untitled. An existing file is replaced only with overwrite: true.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute output path ending in .plasticity" },
        overwrite: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "set_view",
    description:
      "Point the camera of the first viewport at a standard view: front, back, left, right, " +
      "top, bottom or isometric (Z is up; front looks along +Y). `fit` (default true) also " +
      "frames all bodies. The six axis views are shown by Plasticity in X-ray. Not an undo " +
      "step. Use before screenshot to look at the model from a chosen side.",
    inputSchema: {
      type: "object",
      required: ["view"],
      properties: {
        view: {
          type: "string",
          enum: ["front", "back", "left", "right", "top", "bottom", "isometric"],
        },
        fit: { type: "boolean", default: true },
      },
    },
  },
  {
    name: "screenshot",
    description:
      "Capture the first 3D viewport of the Plasticity window as a PNG (longest side at most " +
      "1568 px) and return it as an image. With `path` (absolute, .png) the image is also " +
      "written to disk. The window must be visible, not minimized.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional absolute output path ending in .png" },
        overwrite: { type: "boolean", default: false },
      },
    },
  },
];

// ---------- Helpers ----------

function bbox(positions: Float32Array): {
  min: [number, number, number];
  max: [number, number, number];
} | null {
  if (positions.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!,
      y = positions[i + 1]!,
      z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function summarizeObject(o: {
  type: number;
  id: number;
  version: number;
  parentId: number;
  materialId: number;
  flags: number;
  name: string;
  vertices?: Float32Array;
  faces?: Int32Array;
  normals?: Float32Array;
}, includeMesh: boolean) {
  const base = {
    id: o.id,
    name: o.name,
    type: ObjectType[o.type] ?? `UNKNOWN(${o.type})`,
    version: o.version,
    parentId: o.parentId,
    materialId: o.materialId,
    flags: {
      hidden: !!(o.flags & 1),
      visible: !!(o.flags & 2),
      selectable: !!(o.flags & 4),
      raw: o.flags,
    },
  };
  if (!includeMesh) return base;
  if (!o.vertices) return base;
  return {
    ...base,
    vertexCount: o.vertices.length / 3,
    triCount: (o.faces?.length ?? 0) / 3,
    bbox: bbox(o.vertices),
  };
}

function ensureConnected() {
  if (!client.isConnected()) {
    throw new Error("Not connected. Call the `connect` tool first.");
  }
}

function ensureFilename(provided?: string): string {
  const name = provided ?? client.getFilename();
  if (!name) {
    throw new Error(
      "No filename known. Either pass `filename`, or call `list_scene` first so the client learns the active document name.",
    );
  }
  return name;
}

function shapeFromString(s?: string): FacetShapeType | undefined {
  if (!s) return undefined;
  if (s === "ANY") return FacetShapeType.ANY;
  if (s === "CUT") return FacetShapeType.CUT;
  if (s === "CONVEX") return FacetShapeType.CONVEX;
  return undefined;
}

function randomId(): string {
  return `mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- Server wiring ----------

const server = new Server(
  { name: "plasticity-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;

  try {
    switch (name) {
      case "connect": {
        const args = ConnectArgs.parse(rawArgs ?? {});
        if (args.server && args.server !== client.getServer() && client.isConnected()) {
          await client.disconnect();
        }
        // If a different server was requested, we'd need a new client — for the MVP we
        // keep one global client tied to PLASTICITY_SERVER env / default. Surface mismatch.
        if (args.server && args.server !== client.getServer()) {
          throw new Error(
            `Server override not supported in MVP (set PLASTICITY_SERVER env before launch). ` +
              `Configured: ${client.getServer()}; requested: ${args.server}`,
          );
        }
        await client.connect();
        return ok({
          connected: true,
          server: client.getServer(),
          supportedOpcodes: [...listSupported()],
        });
      }

      case "status": {
        return ok({
          connected: client.isConnected(),
          server: client.getServer(),
          filename: client.getFilename(),
          version: client.getVersion(),
          subscribed: client.isSubscribed(),
          supportedOpcodes: client.isConnected() ? [...listSupported()] : [],
          pendingEvents: client.pendingEventCount(),
        });
      }

      case "list_scene": {
        ensureConnected();
        const args = ListSceneArgs.parse(rawArgs ?? {});
        const objects = await client.listAll(args.visibleOnly);
        return ok({
          filename: client.getFilename(),
          version: client.getVersion(),
          count: objects.length,
          objects: objects.map((o) => summarizeObject(o, args.includeMesh)),
        });
      }

      case "get_object": {
        ensureConnected();
        const args = GetObjectArgs.parse(rawArgs ?? {});
        const objects = await client.listAll(args.visibleOnly);
        const found = objects.find((o) => o.id === args.id);
        if (!found) {
          throw new Error(`Object id ${args.id} not found`);
        }
        return ok(summarizeObject(found, true));
      }

      case "subscribe_changes": {
        ensureConnected();
        SubscribeArgs.parse(rawArgs ?? {});
        await client.subscribeAll();
        return ok({ subscribed: true });
      }

      case "unsubscribe_changes": {
        ensureConnected();
        SubscribeArgs.parse(rawArgs ?? {});
        await client.unsubscribeAll();
        return ok({ subscribed: false });
      }

      case "drain_events": {
        ensureConnected();
        const args = DrainEventsArgs.parse(rawArgs ?? {});
        const events = client.drainEvents(args.limit);
        return ok({ count: events.length, events });
      }

      case "refacet": {
        ensureConnected();
        const args = RefacetArgs.parse(rawArgs ?? {});
        const filename = ensureFilename(args.filename);
        const resp = await client.refacetSome(filename, args.ids, {
          curveChordTolerance: args.curveChordTolerance,
          curveChordAngle: args.curveChordAngle,
          surfacePlaneTolerance: args.surfacePlaneTolerance,
          surfacePlaneAngle: args.surfacePlaneAngle,
          matchTopology: args.matchTopology,
          maxSides: args.maxSides,
          shape: shapeFromString(args.shape),
        });
        return ok({
          code: resp.code,
          filename: resp.filename,
          fileVersion: resp.fileVersion,
          items: resp.items.map((it) => ({
            plasticityId: it.plasticityId,
            version: it.version,
            vertexCount: it.positions.length / 3,
            triOrLoopIndexCount: it.indices.length,
            normalCount: it.normals.length / 3,
            bbox: bbox(it.positions),
          })),
        });
      }

      case "push_mesh": {
        ensureConnected();
        if (!client.supports(MessageType.PUT_SOME_1)) {
          throw new Error("Server does not advertise PUT_SOME_1 support (check Plasticity version).");
        }
        const args = PushMeshArgs.parse(rawArgs ?? {});
        const filename = ensureFilename(args.filename);
        const sizesSum = args.sizes.reduce((a, b) => a + b, 0);
        if (sizesSum !== args.indices.length) {
          throw new Error(
            `sizes sum ${sizesSum} does not match indices length ${args.indices.length}`,
          );
        }
        if (args.positions.length % 3 !== 0) {
          throw new Error(`positions length ${args.positions.length} is not a multiple of 3`);
        }
        const groupClientId = args.groupName ? `mcp-group-${args.groupName}` : "";
        const groups = args.groupName
          ? [
              {
                clientGroupId: groupClientId,
                name: args.groupName,
                parentClientGroupId: "",
              },
            ]
          : [];
        const itemClientId = args.clientId ?? randomId();
        const item = {
          clientId: itemClientId,
          name: args.name,
          parentClientGroupId: groupClientId,
          options: args.asSubd ? 1n : 0n,
          positions: args.positions,
          indices: args.indices,
          sizes: args.sizes,
        };
        const resp = await client.putSome(filename, groups, [item]);
        return ok({
          code: resp.code,
          groups: resp.groups,
          item: resp.items[0] ?? null,
        });
      }

      case "native_launch": {
        const args = NativeLaunchArgs.parse(rawArgs ?? {});
        const result = await launchPlasticity(args.executable);
        return ok({
          alreadyAvailable: result.alreadyAvailable,
          windows: result.targets.map((t) => ({ targetId: t.id, title: t.title })),
        });
      }

      case "native_connect": {
        const args = NativeConnectArgs.parse(rawArgs ?? {});
        const target = await native.connect(args.targetId);
        const state = await native.state();
        return ok({
          connected: true,
          window: { targetId: target.id, title: target.title },
          version: SUPPORTED_VERSION,
          bodyCount: state.bodies.length,
          undoDepth: state.undoDepth,
          redoDepth: state.redoDepth,
        });
      }

      case "native_status": {
        const target = native.getTarget();
        if (!target) return ok({ connected: false, supportedVersion: SUPPORTED_VERSION });
        const state = await native.state();
        return ok({
          connected: true,
          window: { targetId: target.id, title: target.title },
          version: SUPPORTED_VERSION,
          busy: state.busy,
          windowVisible: !state.windowHidden,
          bodyCount: state.bodies.length,
          undoDepth: state.undoDepth,
          redoDepth: state.redoDepth,
        });
      }

      case "create_box": {
        const args = CreateBoxArgs.parse(rawArgs ?? {});
        return ok(await native.createBox(args.origin, args.size, args.name));
      }

      case "create_sphere": {
        const args = CreateSphereArgs.parse(rawArgs ?? {});
        return ok(await native.createSphere(args.center, args.radius, args.name));
      }

      case "create_cylinder": {
        const args = CreateCylinderArgs.parse(rawArgs ?? {});
        return ok(
          await native.createCylinder(args.base, args.radius, args.height, args.axis, args.name),
        );
      }

      case "undo":
        return ok(await native.undo());

      case "redo":
        return ok(await native.redo());

      case "list_bodies": {
        const state = await native.state();
        return ok({ count: state.bodies.length, bodies: state.bodies });
      }

      case "get_selection": {
        const bodies = await native.getSelection();
        return ok({ count: bodies.length, bodies });
      }

      case "select_bodies": {
        const args = SelectBodiesArgs.parse(rawArgs ?? {});
        const bodies = await native.selectBodies(args.ids);
        return ok({ count: bodies.length, bodies });
      }

      case "delete_bodies": {
        const args = DeleteBodiesArgs.parse(rawArgs ?? {});
        return ok(await native.deleteBodies(args.ids));
      }

      case "rename_body": {
        const args = RenameBodyArgs.parse(rawArgs ?? {});
        return ok(await native.renameBody(args.id, args.name));
      }

      case "move_bodies": {
        const args = MoveBodiesArgs.parse(rawArgs ?? {});
        return ok(await native.moveBodies(args.ids, args.delta));
      }

      case "rotate_bodies": {
        const args = RotateBodiesArgs.parse(rawArgs ?? {});
        return ok(await native.rotateBodies(args.ids, args.axis, args.angle, args.pivot));
      }

      case "scale_bodies": {
        const args = ScaleBodiesArgs.parse(rawArgs ?? {});
        const factors: [number, number, number] =
          typeof args.factor === "number" ? [args.factor, args.factor, args.factor] : args.factor;
        return ok(await native.scaleBodies(args.ids, factors, args.pivot));
      }

      case "get_body_topology": {
        const args = GetBodyTopologyArgs.parse(rawArgs ?? {});
        return ok(await native.topology(args.id, args.include));
      }

      case "boolean": {
        const args = BooleanArgs.parse(rawArgs ?? {});
        return ok(
          await native.boolean(args.operation, args.targetIds, args.toolIds, args.keepTools),
        );
      }

      case "fillet_edges": {
        const args = FilletEdgesArgs.parse(rawArgs ?? {});
        return ok(await native.filletEdges(args.id, args.edgeIds, args.radius));
      }

      case "chamfer_edges": {
        const args = ChamferEdgesArgs.parse(rawArgs ?? {});
        return ok(await native.chamferEdges(args.id, args.edgeIds, args.distance));
      }

      case "extrude_faces": {
        const args = ExtrudeFacesArgs.parse(rawArgs ?? {});
        return ok(await native.extrudeFaces(args.id, args.faceIds, args.distance));
      }

      case "create_polyline": {
        const args = CreatePolylineArgs.parse(rawArgs ?? {});
        return ok(await native.createPolyline(args.points, args.closed, args.name));
      }

      case "create_spline": {
        const args = CreateSplineArgs.parse(rawArgs ?? {});
        return ok(await native.createSpline(args.points, args.closed, args.name));
      }

      case "create_circle": {
        const args = CreateCircleArgs.parse(rawArgs ?? {});
        return ok(await native.createCircle(args.center, args.radius, args.normal, args.name));
      }

      case "create_arc": {
        const args = CreateArcArgs.parse(rawArgs ?? {});
        return ok(await native.createArc(args.start, args.through, args.end, args.name));
      }

      case "create_arc_center": {
        const args = CreateArcCenterArgs.parse(rawArgs ?? {});
        return ok(
          await native.createArcCenter(args.center, args.start, args.angle, args.normal, args.name),
        );
      }

      case "create_ellipse": {
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
      }

      case "join_curves": {
        const args = JoinCurvesArgs.parse(rawArgs ?? {});
        return ok(await native.joinCurves(args.ids));
      }

      case "list_regions": {
        const regions = await native.listRegions();
        return ok({ count: regions.length, regions });
      }

      case "extrude_profile": {
        const args = ExtrudeProfileArgs.parse(rawArgs ?? {});
        return ok(await native.extrudeProfile((args.id ?? args.regionIds)!, args.distance));
      }

      case "revolve_profile": {
        const args = RevolveProfileArgs.parse(rawArgs ?? {});
        return ok(
          await native.revolveProfile(
            (args.id ?? args.regionIds)!,
            args.axisOrigin,
            args.axis,
            args.angle,
          ),
        );
      }

      case "sweep_profile": {
        const args = SweepProfileArgs.parse(rawArgs ?? {});
        return ok(
          await native.sweepProfile(
            (args.profileId ?? args.regionIds)!,
            args.pathId,
            args.twist,
            args.scale,
          ),
        );
      }

      case "loft_profiles": {
        const args = LoftProfilesArgs.parse(rawArgs ?? {});
        return ok(
          await native.loftProfiles((args.profileIds ?? args.regionIds)!, args.guideIds, args.closed),
        );
      }

      case "copy_bodies": {
        const args = CopyBodiesArgs.parse(rawArgs ?? {});
        return ok(await native.copyBodies(args.ids, args.delta));
      }

      case "mirror_bodies": {
        const args = MirrorBodiesArgs.parse(rawArgs ?? {});
        return ok(
          await native.mirrorBodies(args.ids, args.planeOrigin, args.planeNormal, args.keepOriginal),
        );
      }

      case "array_rectangular": {
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
      }

      case "array_radial": {
        const args = ArrayRadialArgs.parse(rawArgs ?? {});
        return ok(await native.arrayRadial(args.ids, args.center, args.axis, args.count, args.angle));
      }

      case "export_step": {
        const args = ExportStepArgs.parse(rawArgs ?? {});
        return ok(await native.exportStep(args.path, args.ids, args.overwrite));
      }

      case "import_step": {
        const args = ImportStepArgs.parse(rawArgs ?? {});
        return ok(await native.importStep(args.path));
      }

      case "save_document": {
        const args = SaveDocumentArgs.parse(rawArgs ?? {});
        return ok(await native.saveCopy(args.path, args.overwrite));
      }

      case "set_view": {
        const args = SetViewArgs.parse(rawArgs ?? {});
        return ok(await native.setView(args.view, args.fit));
      }

      case "screenshot": {
        const args = ScreenshotArgs.parse(rawArgs ?? {});
        const shot = await native.screenshot(args.path, args.overwrite);
        const info = { width: shot.width, height: shot.height, bytes: shot.png.length, path: shot.path };
        return {
          content: [
            { type: "image" as const, data: shot.png.toString("base64"), mimeType: "image/png" },
            { type: "text" as const, text: JSON.stringify(info, null, 2) },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return error((err as Error).message);
  }
});

function listSupported(): string[] {
  const out: string[] = [];
  for (const v of Object.values(MessageType)) {
    if (typeof v === "number" && client.supports(v)) {
      out.push(MessageType[v as MessageType] as string);
    }
  }
  return out;
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function error(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${message}` }],
  };
}

// ---------- Boot ----------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[plasticity-mcp] ready (stdio)");
}

main().catch((err) => {
  console.error("[plasticity-mcp] fatal:", err);
  process.exit(1);
});
