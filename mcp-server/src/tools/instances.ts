import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BODY_IDS_SCHEMA, BodyIds, native, ok, type ToolFamily, VEC3_SCHEMA, Vec3Mm } from "./shared.js";

/** Instances: linked copies of bodies, a family of objects with ids of their own. */

const InstanceIds = z.array(z.number().int().nonnegative()).min(1);

const CreateInstancesArgs = z.object({
  ids: BodyIds,
  delta: Vec3Mm.optional(),
});

const InstanceIdsArgs = z.object({
  ids: InstanceIds,
});

const INSTANCE_IDS_SCHEMA = {
  type: "array",
  items: { type: "number" },
  minItems: 1,
  description: "Instance ids (from list_instances)",
};

const tools: Tool[] = [
  {
    name: "list_instances",
    description:
      "List the instances in the document: id, name, `sourceId` (the body the instance is a " +
      "linked copy of), bounds in millimetres, visible. Instances are a family of their own: " +
      "they have separate ids and do not appear in list_bodies, and the modelling tools do " +
      "not take them until realize_instances turns them into bodies.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_instances",
    description:
      "Create instances of bodies or curves: linked copies that follow their source — edit " +
      "the source and every instance changes — and keep the document small. `delta` shifts " +
      "the instances by [x, y, z] millimetres. For independent copies use copy_bodies. The " +
      "new instances are in `created` (instance ids, not body ids). One undo step.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: BODY_IDS_SCHEMA, delta: VEC3_SCHEMA },
    },
  },
  {
    name: "realize_instances",
    description:
      "Turn instances into ordinary bodies: each becomes an independent copy of its source " +
      "at the instance's place (in `created`) and stops following the source. Undoable.",
    inputSchema: { type: "object", required: ["ids"], properties: { ids: INSTANCE_IDS_SCHEMA } },
  },
  {
    name: "delete_instances",
    description:
      "Delete instances by id with the native Delete command; their sources stay. Clears the " +
      "selection in the window. Undoable.",
    inputSchema: { type: "object", required: ["ids"], properties: { ids: INSTANCE_IDS_SCHEMA } },
  },
];

const handlers: ToolFamily["handlers"] = {
  list_instances: async () => {
    const instances = await native.listInstances();
    return ok({ count: instances.length, instances });
  },

  create_instances: async (rawArgs) => {
    const args = CreateInstancesArgs.parse(rawArgs ?? {});
    return ok(await native.createInstances(args.ids, args.delta));
  },

  realize_instances: async (rawArgs) => {
    const args = InstanceIdsArgs.parse(rawArgs ?? {});
    return ok(await native.realizeInstances(args.ids));
  },

  delete_instances: async (rawArgs) => {
    const args = InstanceIdsArgs.parse(rawArgs ?? {});
    return ok(await native.deleteInstances(args.ids));
  },
};

export const instances: ToolFamily = { tools, handlers };
