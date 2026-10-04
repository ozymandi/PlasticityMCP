import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BodyId, Direction, native, ok, type ToolFamily, VEC3_SCHEMA, Vec3Mm } from "./shared.js";

/** The working environment: document, display units, grid, construction plane. */

const SetConstructionPlaneArgs = z
  .object({
    preset: z.enum(["xy", "yz", "xz"]).optional(),
    origin: Vec3Mm.optional(),
    normal: Direction.optional(),
    xDirection: Direction.optional(),
    id: BodyId.optional(),
    faceId: z.string().min(1).optional(),
  })
  .refine(
    (a) => [a.preset, a.normal, a.id].filter((v) => v !== undefined).length === 1,
    "pass exactly one of preset, normal (with origin), or id with faceId",
  )
  .refine((a) => (a.id === undefined) === (a.faceId === undefined), "id and faceId go together")
  .refine(
    (a) => a.normal !== undefined || (a.origin === undefined && a.xDirection === undefined),
    "origin and xDirection go with normal",
  );

const OpenDocumentArgs = z.object({
  path: z.string().min(1),
  discardChanges: z.boolean().optional().default(false),
});

const NewDocumentArgs = z.object({
  discardChanges: z.boolean().optional().default(false),
});

const tools: Tool[] = [
  {
    name: "get_environment",
    description:
      "Read the state of the Plasticity window that is not geometry: the document (title, " +
      "file `path` or null when never saved, `unsavedChanges`), the units the window displays " +
      "(this server always takes and returns millimetres and degrees, whatever they are), the " +
      "grid, and the active construction plane (origin, normal, x direction).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_construction_plane",
    description:
      "Set the active construction plane of the window — the plane Plasticity draws on and " +
      "that create_outline looks along. One of: `preset` xy / yz / xz (xy is the default " +
      "plane, a reset); `normal` with an optional `origin` (default the world origin) and " +
      "`xDirection`; or `id` + `faceId` for the plane of a planar face. It is a state of the " +
      "window, visible to the user, not an undo step, and it stays until changed. Returns the " +
      "environment.",
    inputSchema: {
      type: "object",
      properties: {
        preset: { type: "string", enum: ["xy", "yz", "xz"] },
        origin: VEC3_SCHEMA,
        normal: { ...VEC3_SCHEMA, description: "Plane normal direction [x, y, z]" },
        xDirection: { ...VEC3_SCHEMA, description: "Direction of the plane's x axis [x, y, z]" },
        id: { type: "number", description: "Body whose face gives the plane" },
        faceId: { type: "string", description: "A planar face, from get_body_topology" },
      },
    },
  },
  {
    name: "open_document",
    description:
      "Open a `.plasticity` file (absolute `path`) in this window, IN PLACE OF the document " +
      "that is open. Refused while the open document has unsaved changes — save it first " +
      "with save_document, or pass `discardChanges: true` to drop them for good. Not " +
      "undoable. Returns the environment and the number of bodies of the opened document.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Absolute path of a .plasticity file" },
        discardChanges: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "new_document",
    description:
      "Start a new Untitled document in this window, IN PLACE OF the document that is open: " +
      "Plasticity's startup document (by default it holds one 1 m cube). Refused while the " +
      "open document has unsaved changes — save it first with save_document, or pass " +
      "`discardChanges: true` to drop them for good. Not undoable. Returns the environment " +
      "and the number of bodies of the new document.",
    inputSchema: {
      type: "object",
      properties: { discardChanges: { type: "boolean", default: false } },
    },
  },
];

const handlers: ToolFamily["handlers"] = {
  get_environment: async () => ok(await native.getEnvironment()),

  set_construction_plane: async (rawArgs) => {
    const args = SetConstructionPlaneArgs.parse(rawArgs ?? {});
    if (args.preset) return ok(await native.setConstructionPlane({ preset: args.preset }));
    if (args.id !== undefined) return ok(await native.setConstructionPlane({ id: args.id, faceId: args.faceId! }));
    return ok(
      await native.setConstructionPlane({
        originMm: args.origin ?? [0, 0, 0],
        normal: args.normal!,
        xDirection: args.xDirection,
      }),
    );
  },

  open_document: async (rawArgs) => {
    const args = OpenDocumentArgs.parse(rawArgs ?? {});
    return ok(await native.openDocument(args.path, args.discardChanges));
  },

  new_document: async (rawArgs) => {
    const args = NewDocumentArgs.parse(rawArgs ?? {});
    return ok(await native.newDocument(args.discardChanges));
  },
};

export const environment: ToolFamily = { tools, handlers };
