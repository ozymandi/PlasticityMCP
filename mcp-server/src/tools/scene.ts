import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  BODY_IDS_SCHEMA,
  BodyId,
  BodyIds,
  native,
  ok,
  type ToolFamily,
  TOPOLOGY_IDS_SCHEMA,
  TopologyIds,
} from "./shared.js";

/** Scene tools: bodies, selection, groups, visibility, locking, materials. */

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

const GroupId = z.number().int().nonnegative();

const GroupBodiesArgs = z.object({
  ids: BodyIds,
  name: z.string().trim().min(1).optional(),
});

const UngroupArgs = z.object({
  groupIds: z.array(GroupId.positive()).min(1),
});

const MoveToGroupArgs = z.object({
  ids: BodyIds,
  groupId: GroupId,
});

const SetVisibilityArgs = z.object({
  ids: BodyIds,
  visible: z.boolean(),
});

const BodyIdsArgs = z.object({
  ids: BodyIds,
});

const SetLockedArgs = z.object({
  ids: BodyIds,
  locked: z.boolean(),
});

const unit = z.number().min(0).max(1);

const CreateMaterialArgs = z.object({
  name: z.string().trim().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color must be #rrggbb"),
  roughness: unit.optional().default(0.5),
  metalness: unit.optional().default(0),
  opacity: unit.optional().default(1),
});

const SetMaterialArgs = z.object({
  ids: BodyIds,
  materialId: z.number().int().positive(),
});

const SelectTopologyArgs = z
  .object({
    id: BodyId,
    faceIds: TopologyIds.optional(),
    edgeIds: TopologyIds.optional(),
  })
  .refine((a) => a.faceIds !== undefined || a.edgeIds !== undefined, "pass faceIds, edgeIds or both");

const NO_ARGS = { type: "object" as const, properties: {} };

const tools: Tool[] = [
  {
    name: "list_bodies",
    description:
      "List every body in the connected Plasticity document (native channel): stable id, type " +
      "(Solid / Sheet / Wire), name, bounds in millimetres, face and edge counts, " +
      "visible / locked / selected flags and `materialId`. `visible` is whether the body is " +
      "shown in the window: false when it is hidden, or left out while other bodies are " +
      "isolated. Ids are the ones used by all native tools.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_selection",
    description:
      "Return what is selected in the Plasticity window, to act on what the user has picked: " +
      "`bodies` (whole Solids, Sheets and curves), `faces` and `edges` (each with the body " +
      "`id` and the face / edge id that the face and edge tools take), `regionIds` and " +
      "`groupIds`.",
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
    name: "select_topology",
    description:
      "Select faces and edges of one body in the Plasticity window, replacing the selection — " +
      "to show the user which faces or edges are meant before changing them. Ids come from " +
      "get_body_topology. Not an undo step. Fails without changing anything if an id is " +
      "unknown or stale. Returns the selection.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "number" }, faceIds: TOPOLOGY_IDS_SCHEMA, edgeIds: TOPOLOGY_IDS_SCHEMA },
    },
  },
  {
    name: "list_groups",
    description:
      "List the groups of the document as a tree: id, name, `parentId`, and the direct " +
      "members of each — `groupIds`, `bodyIds`, `instanceIds`, `referenceMeshIds` — with " +
      "visible / locked flags. Group 0 is the scene itself, the root; bodies outside any " +
      "group are its members. `activeGroupId` is the group new objects are created in.",
    inputSchema: NO_ARGS,
  },
  {
    name: "group_bodies",
    description:
      "Put bodies into a new group, optionally with a `name`. The group is created in the " +
      "common parent of the bodies and returned in `created`. Clears the selection in the " +
      "window. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: { ids: BODY_IDS_SCHEMA, name: { type: "string" } },
    },
  },
  {
    name: "ungroup",
    description:
      "Dissolve groups: the groups go (in `removedIds`) and their members move up into the " +
      "parent group. The bodies themselves are not touched. Group 0, the scene, cannot be " +
      "dissolved. Undoable.",
    inputSchema: {
      type: "object",
      required: ["groupIds"],
      properties: { groupIds: { type: "array", items: { type: "number" }, minItems: 1 } },
    },
  },
  {
    name: "move_to_group",
    description:
      "Move bodies into group `groupId` (from list_groups); 0 moves them out of every group, " +
      "back to the scene. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids", "groupId"],
      properties: { ids: BODY_IDS_SCHEMA, groupId: { type: "number" } },
    },
  },
  {
    name: "set_visibility",
    description:
      "Hide (`visible: false`) or show (`visible: true`) bodies in the window. Hidden bodies " +
      "stay in the document and in list_bodies, with `visible: false`. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids", "visible"],
      properties: { ids: BODY_IDS_SCHEMA, visible: { type: "boolean" } },
    },
  },
  {
    name: "unhide_all",
    description: "Show everything that is hidden. Undoable.",
    inputSchema: NO_ARGS,
  },
  {
    name: "isolate",
    description:
      "Show only the given bodies and put everything else out of sight until unisolate — to " +
      "work on a part without the rest in the way. It does not change what is hidden: " +
      "unisolate brings the scene back exactly as it was. Clears the selection. Undoable.",
    inputSchema: { type: "object", required: ["ids"], properties: { ids: BODY_IDS_SCHEMA } },
  },
  {
    name: "unisolate",
    description: "Leave isolation: everything is shown as before isolate. Fails when nothing is isolated. Undoable.",
    inputSchema: NO_ARGS,
  },
  {
    name: "set_locked",
    description:
      "Lock bodies (`locked: true`) so that they cannot be picked or changed by hand in the " +
      "window, or unlock them. The tools of this server still work on locked bodies. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids", "locked"],
      properties: { ids: BODY_IDS_SCHEMA, locked: { type: "boolean" } },
    },
  },
  {
    name: "unlock_all",
    description: "Unlock everything that is locked. Undoable.",
    inputSchema: NO_ARGS,
  },
  {
    name: "list_materials",
    description:
      "List the materials of the document: id, name, colour as #rrggbb, roughness, metalness, " +
      "opacity. Which body has which material is `materialId` in list_bodies.",
    inputSchema: NO_ARGS,
  },
  {
    name: "create_material",
    description:
      "Add a material to the document: `name`, `color` as #rrggbb, and optionally " +
      "`roughness` (0 polished … 1 matt, default 0.5), `metalness` (0 … 1, default 0) and " +
      "`opacity` (0 clear … 1 solid, default 1). Returns the material with its id, to give " +
      "to bodies with set_material. Undoable.",
    inputSchema: {
      type: "object",
      required: ["name", "color"],
      properties: {
        name: { type: "string" },
        color: { type: "string", description: "#rrggbb" },
        roughness: { type: "number", default: 0.5 },
        metalness: { type: "number", default: 0 },
        opacity: { type: "number", default: 1 },
      },
    },
  },
  {
    name: "set_material",
    description:
      "Give bodies the material `materialId` (from list_materials or create_material). The " +
      "whole body takes it. Undoable.",
    inputSchema: {
      type: "object",
      required: ["ids", "materialId"],
      properties: { ids: BODY_IDS_SCHEMA, materialId: { type: "number" } },
    },
  },
  {
    name: "remove_material",
    description:
      "Take the material off bodies: they go back to the default look. The material stays in " +
      "the document. Clears the selection. Undoable.",
    inputSchema: { type: "object", required: ["ids"], properties: { ids: BODY_IDS_SCHEMA } },
  },
];

const handlers: ToolFamily["handlers"] = {
  list_bodies: async () => {
    const state = await native.state();
    return ok({ count: state.bodies.length, bodies: state.bodies });
  },

  get_selection: async () => {
    const bodies = await native.getSelection();
    const detail = await native.getSelectionDetail();
    return ok({
      count: bodies.length,
      bodies,
      faces: detail.faces,
      edges: detail.edges,
      regionIds: detail.regionIds,
      groupIds: detail.groupIds,
    });
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

  select_topology: async (rawArgs) => {
    const args = SelectTopologyArgs.parse(rawArgs ?? {});
    return ok(await native.selectTopology(args.id, args.faceIds, args.edgeIds));
  },

  list_groups: async () => ok(await native.listGroups()),

  group_bodies: async (rawArgs) => {
    const args = GroupBodiesArgs.parse(rawArgs ?? {});
    return ok(await native.groupBodies(args.ids, args.name));
  },

  ungroup: async (rawArgs) => {
    const args = UngroupArgs.parse(rawArgs ?? {});
    return ok(await native.ungroup(args.groupIds));
  },

  move_to_group: async (rawArgs) => {
    const args = MoveToGroupArgs.parse(rawArgs ?? {});
    return ok(await native.moveToGroup(args.ids, args.groupId));
  },

  set_visibility: async (rawArgs) => {
    const args = SetVisibilityArgs.parse(rawArgs ?? {});
    return ok(await native.setVisibility(args.ids, args.visible));
  },

  unhide_all: async () => ok(await native.unhideAll()),

  isolate: async (rawArgs) => {
    const args = BodyIdsArgs.parse(rawArgs ?? {});
    return ok(await native.isolate(args.ids));
  },

  unisolate: async () => ok(await native.unisolate()),

  set_locked: async (rawArgs) => {
    const args = SetLockedArgs.parse(rawArgs ?? {});
    return ok(await native.setLocked(args.ids, args.locked));
  },

  unlock_all: async () => ok(await native.unlockAll()),

  list_materials: async () => {
    const materials = await native.listMaterials();
    return ok({ count: materials.length, materials });
  },

  create_material: async (rawArgs) => {
    const args = CreateMaterialArgs.parse(rawArgs ?? {});
    return ok(await native.createMaterial({ ...args, color: args.color.toLowerCase() }));
  },

  set_material: async (rawArgs) => {
    const args = SetMaterialArgs.parse(rawArgs ?? {});
    return ok(await native.setMaterial(args.ids, args.materialId));
  },

  remove_material: async (rawArgs) => {
    const args = BodyIdsArgs.parse(rawArgs ?? {});
    return ok(await native.removeMaterial(args.ids));
  },
};

export const scene: ToolFamily = { tools, handlers };
