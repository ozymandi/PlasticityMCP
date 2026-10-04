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

// ---------- Tool definitions ----------

const VEC3_SCHEMA = {
  type: "array",
  items: { type: "number" },
  minItems: 3,
  maxItems: 3,
  description: "[x, y, z] in millimetres",
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
      "undo/redo depth and body count.",
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
