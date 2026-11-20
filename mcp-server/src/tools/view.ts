import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BODY_IDS_SCHEMA, BodyIds, Direction, native, ok, type ToolFamily, VEC3_SCHEMA } from "./shared.js";

/** Camera and screenshots. */

const ScreenshotArgs = z.object({
  path: z.string().min(1).optional(),
  overwrite: z.boolean().optional().default(false),
});

const SetViewArgs = z
  .object({
    view: z.enum(["front", "back", "left", "right", "top", "bottom", "isometric"]).optional(),
    direction: Direction.optional(),
    fit: z.boolean().optional().default(true),
    ids: BodyIds.optional(),
  })
  .refine((a) => (a.view === undefined) !== (a.direction === undefined), "pass either view or direction")
  .refine((a) => a.ids === undefined || a.fit, "ids frame the view: they need fit");

const SetXrayArgs = z.object({ on: z.boolean() });

const tools: Tool[] = [
  {
    name: "set_view",
    description:
      "Point the camera of the first viewport at a standard `view`: front, back, left, right, " +
      "top, bottom or isometric (Z is up; front looks along +Y) — or, instead of `view`, look " +
      "from any side with `direction`: the vector from the model towards the camera, e.g. " +
      "[1, 1, 1] for a shaded view from behind, right and above (isometric is [1, -1, 1]; a " +
      "direction along Z is refused — that is top / bottom; the call fails when the camera " +
      "ends elsewhere, e.g. the viewport was moved by hand meanwhile). `fit` (default true) also " +
      "frames all bodies — hidden and isolated-away ones included — or, with `ids`, only " +
      "those bodies: the way to look closely at one part of a scene. X-ray or shaded follows " +
      "the window's X-ray toggle: switch it with set_xray. Not an undo step. Use before " +
      "screenshot to look at the model from a chosen side.",
    inputSchema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: ["front", "back", "left", "right", "top", "bottom", "isometric"],
        },
        direction: { ...VEC3_SCHEMA, description: "From the model towards the camera [x, y, z]; instead of view" },
        fit: { type: "boolean", default: true },
        ids: { ...BODY_IDS_SCHEMA, description: "Frame only these bodies" },
      },
    },
  },
  {
    name: "set_xray",
    description:
      "Switch X-ray drawing of the viewport on (`on: true`: every face see-through, hidden " +
      "edges shown — to see inner parts) or off (`on: false`: shaded, opaque — for " +
      "presentation screenshots). Same as the window's X-ray toggle (Alt+Z), which the user " +
      "may have left on: native_status reports it as xray. Returns the state and whether it " +
      "changed. Not an undo step and does not mark the document changed, but a saved document " +
      "keeps the state: open_document brings back the file's own, and new_document starts in " +
      "X-ray (Plasticity's startup document).",
    inputSchema: {
      type: "object",
      properties: { on: { type: "boolean", description: "true: X-ray, false: shaded" } },
      required: ["on"],
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

const handlers: ToolFamily["handlers"] = {
  set_view: async (rawArgs) => {
    const args = SetViewArgs.parse(rawArgs ?? {});
    return ok(await native.setView(args.direction ?? args.view!, args.fit, args.ids));
  },

  set_xray: async (rawArgs) => {
    const args = SetXrayArgs.parse(rawArgs ?? {});
    return ok(await native.setXray(args.on));
  },

  screenshot: async (rawArgs) => {
    const args = ScreenshotArgs.parse(rawArgs ?? {});
    const shot = await native.screenshot(args.path, args.overwrite);
    const info = { width: shot.width, height: shot.height, bytes: shot.png.length, path: shot.path };
    return {
      content: [
        { type: "image" as const, data: shot.png.toString("base64"), mimeType: "image/png" },
        { type: "text" as const, text: JSON.stringify(info, null, 2) },
      ],
    };
  },
};

export const view: ToolFamily = { tools, handlers };
