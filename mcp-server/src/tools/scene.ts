import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BodyId, native, ok, type ToolFamily } from "./shared.js";

/** Scene tools: listing, selection, deleting and renaming bodies. */

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

const tools: Tool[] = [
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

const handlers: ToolFamily["handlers"] = {
  list_bodies: async () => {
    const state = await native.state();
    return ok({ count: state.bodies.length, bodies: state.bodies });
  },

  get_selection: async () => {
    const bodies = await native.getSelection();
    return ok({ count: bodies.length, bodies });
  },

  select_bodies: async (rawArgs) => {
    const args = SelectBodiesArgs.parse(rawArgs ?? {});
    const bodies = await native.selectBodies(args.ids);
    return ok({ count: bodies.length, bodies });
  },

  delete_bodies: async (rawArgs) => {
    const args = DeleteBodiesArgs.parse(rawArgs ?? {});
    return ok(await native.deleteBodies(args.ids));
  },

  rename_body: async (rawArgs) => {
    const args = RenameBodyArgs.parse(rawArgs ?? {});
    return ok(await native.renameBody(args.id, args.name));
  },
};

export const scene: ToolFamily = { tools, handlers };
