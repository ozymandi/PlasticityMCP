/** Organising the scene: groups, visibility, isolation, locking, materials, selection of faces and edges. */

import { COMMAND_TIMEOUT_MS } from "./core.js";
import { SceneTools } from "./scene.js";
import { BUSY_GUARD, FIND_VIEW, PICK_TOPOLOGY, READ_STATE, STUCK_CHECK } from "./snippets.js";
import {
  GroupMutation,
  GroupsState,
  MaterialInfo,
  MaterialSpec,
  MutationResult,
  NativeState,
  SelectionDetail,
} from "./types.js";

// Runs with `this` = editor. Groups form a tree under group 0, the scene itself; a group's
// children are node keys, resolved here to groups, bodies, instances and reference meshes.
export const READ_GROUPS = `function () {
  const nodes = this.db.nodes;
  const bodyByKey = new Map();
  for (const [versionId, item] of this.geo.geometryModel) {
    const id = this.db.lookupStableId(versionId);
    if (Number.isInteger(id)) bodyByKey.set(Number(nodes.item2key(item.view)), id);
  }
  const instanceByKey = new Map();
  const meshByKey = new Map();
  for (const empty of Array.from(this.db.empties.snapshot().empties ?? [])) {
    if (!empty) continue;
    const stable = this.db.lookupEmptyById(Number(empty.versionId));
    const kind = stable?.constructor?.name;
    if (kind === 'InstanceEmpty') instanceByKey.set(Number(nodes.item2key(stable)), Number(stable.versionId));
    else if (kind === 'Empties_ObjectEmpty') meshByKey.set(Number(nodes.item2key(stable)), Number(stable.versionId));
  }
  const snapshot = this.db.groups.snapshot();
  const groupIds = Array.from(snapshot.groupIds ?? [], Number);
  const children = Array.from(snapshot.children ?? [], (list) => Array.from(list ?? [], Number));
  const groupByKey = new Map();
  for (const id of groupIds) {
    const group = this.db.groups.lookupById(id);
    if (group) groupByKey.set(Number(nodes.item2key(group)), id);
  }
  const resolve = (keys, map) => keys.map((key) => map.get(key)).filter(Number.isInteger).sort((a, b) => a - b);
  const groups = [];
  groupIds.forEach((id, index) => {
    const group = this.db.groups.lookupById(id);
    if (!group) return;
    const key = Number(nodes.item2key(group));
    const keys = children[index] ?? [];
    groups.push({
      id,
      name: nodes.getName(key) ?? null,
      parentId: id === 0 ? null : Number(this.db.groups.getParentId(key)),
      groupIds: resolve(keys, groupByKey),
      bodyIds: resolve(keys, bodyByKey),
      instanceIds: resolve(keys, instanceByKey),
      referenceMeshIds: resolve(keys, meshByKey),
      visible: Boolean(nodes.isVisible(key)) && !nodes.isHidden(key),
      locked: Boolean(nodes.isLocked(key)),
    });
  });
  groups.sort((a, b) => a.id - b.id);
  return { activeGroupId: Number(snapshot.currentGroupId ?? 0), groups };
}`;

export const READ_MATERIALS = `function () {
  return this.db.materials.list().map(([id, info]) => {
    const material = this.db.materials.get(id);
    return {
      id: Number(id),
      name: String(info?.name ?? ''),
      color: material?.color?.getHexString ? '#' + material.color.getHexString() : null,
      roughness: Number.isFinite(material?.roughness) ? material.roughness : null,
      metalness: Number.isFinite(material?.metalness) ? material.metalness : null,
      opacity: Number.isFinite(material?.opacity) ? material.opacity : null,
    };
  }).filter((material) => Number.isInteger(material.id)).sort((a, b) => a.id - b.id);
}`;

// What is selected in the window, down to faces, edges and regions.
export const READ_SELECTION = `function () {
  const selected = this.selection.selected;
  const stable = (view) => {
    const id = this.db.lookupStableId(view?.versionId);
    return Number.isInteger(id) ? id : null;
  };
  const parts = (collection, key) => Array.from(collection ?? []).map((part) => ({
    id: stable(part.parentItem),
    [key]: String(part.versionId),
  })).filter((part) => part.id !== null);
  const bodies = [...Array.from(selected.solids ?? []), ...Array.from(selected.sheets ?? []), ...Array.from(selected.curves ?? [])];
  return {
    bodyIds: bodies.map(stable).filter((id) => id !== null).sort((a, b) => a - b),
    faces: parts(selected.faces, 'faceId'),
    edges: parts(selected.edges, 'edgeId'),
    regionIds: Array.from(selected.regions ?? []).map((region) => String(region.versionId)),
    groupIds: Array.from(selected.groups ?? []).map((group) => Number(group.id)).sort((a, b) => a - b),
  };
}`;

// Resolves `args.ids` to the node keys of bodies; unknown ids throw before anything changes.
const BODY_KEYS = `${FIND_VIEW}
        const views = args.ids.map(find);
        const keys = views.map((view) => editor.db.nodes.item2key(view));`;

// lookupById does not fail on an id that is not a group, so check against the list first.
const FIND_GROUP = `const groupIds = Array.from(this.db.groups.snapshot().groupIds ?? [], Number);
        const findGroup = (id, allowScene) => {
          if (!groupIds.includes(id) || (id === 0 && !allowScene)) throw new Error('Unknown group id: ' + id);
          return this.db.groups.lookupById(id);
        };`;

/**
 * A native command with its body replaced: the way to make node changes an undo step.
 * `prepare` runs first and resolves ids, so that a bad one changes nothing.
 */
const carrier = (prepare: string, body: string): string => `async function (args) {
        ${BUSY_GUARD}
        const editor = this;
        ${prepare}
        let failure;
        let ran = false;
        const command = new this.commands.GroupSelectedCommand(this);
        command.remember = false;
        command.execute = async function () {
          ran = true;
          try {
            ${body}
          } catch (error) {
            failure = error;
            throw error;
          }
        };
        await this.exec(command);
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`;

/** A native command run as it is, on the selection made by `select`. Leaves the selection empty. */
const nativeCommand = (commandClass: string, select: string, constructorArgs = ""): string => `async function (${
  commandClass === "Command" ? "Command, " : ""
}args) {
        ${BUSY_GUARD}
        const editor = this;
        const selected = this.selection.selected;
        ${select}
        let failure;
        let ran = false;
        const command = new ${commandClass}(this${constructorArgs});
        command.remember = false;
        const execute = command.execute.bind(command);
        command.execute = async function () {
          ran = true;
          try { return await execute(); }
          catch (error) { failure = error; throw error; }
        };
        await this.exec(command);
        selected.removeAll();
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`;

const SELECT_BODIES = `${FIND_VIEW}
        const views = args.ids.map(find);
        selected.removeAll();
        for (const view of views) selected.add(view);`;

export class OrganizeTools extends SceneTools {
  // ---------------- groups ----------------

  listGroups(): Promise<GroupsState> {
    return this.enqueue(() => this.call<GroupsState>(READ_GROUPS));
  }

  /** Run a mutation and report how the set of groups changed. */
  private mutateGroups(
    functionDeclaration: string,
    bindingNames: string[],
    values: unknown[],
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<GroupMutation> {
    return this.enqueue(async () => {
      await this.waitForBackup();
      const before = await this.call<GroupsState>(READ_GROUPS);
      await this.call(functionDeclaration, bindingNames, values, timeoutMs);
      const after = await this.call<GroupsState>(READ_GROUPS);
      const state = await this.call<NativeState>(READ_STATE);
      const beforeIds = new Set(before.groups.map((g) => g.id));
      const afterIds = new Set(after.groups.map((g) => g.id));
      return {
        created: after.groups.filter((g) => !beforeIds.has(g.id)),
        removedIds: before.groups.filter((g) => !afterIds.has(g.id)).map((g) => g.id),
        groups: after.groups,
        undoDepth: state.undoDepth,
        redoDepth: state.redoDepth,
      };
    });
  }

  /** Put bodies into a new group, optionally named. Clears the selection. */
  groupBodies(ids: number[], name?: string): Promise<GroupMutation> {
    return this.mutateGroups(
      `async function (args) {
        ${BUSY_GUARD}
        const editor = this;
        const selected = this.selection.selected;
        ${SELECT_BODIES}
        let failure;
        let ran = false;
        const command = new this.commands.GroupSelectedCommand(this);
        command.remember = false;
        const execute = command.execute.bind(command);
        command.execute = async function () {
          ran = true;
          try {
            const result = await execute();
            // The native command leaves the new group selected.
            const made = Array.from(selected.groups ?? []);
            if (made.length !== 1) throw new Error('Plasticity did not create exactly one group');
            if (args.name) editor.db.nodes.setName(editor.db.nodes.item2key(made[0]), args.name);
            return result;
          } catch (error) { failure = error; throw error; }
        };
        await this.exec(command);
        selected.removeAll();
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`,
      [],
      [{ ids, name: name ?? null }],
    );
  }

  /** Dissolve groups: their members move up into the parent group. */
  ungroup(groupIds: number[]): Promise<GroupMutation> {
    return this.mutateGroups(
      nativeCommand(
        "Command",
        `${FIND_GROUP}
        const groups = args.groupIds.map((id) => findGroup(id, false));
        selected.removeAll();
        for (const group of groups) selected.addGroup(group);`,
      ),
      ["DissolveGroupCommand"],
      [{ groupIds }],
    );
  }

  /** Move bodies into a group; group 0 is the scene itself. */
  moveToGroup(ids: number[], groupId: number): Promise<GroupMutation> {
    return this.mutateGroups(
      nativeCommand(
        "Command",
        `${FIND_GROUP}
        const destination = findGroup(args.groupId, true);
        ${SELECT_BODIES}`,
        ", destination",
      ),
      ["MoveSelectionToGroupCommand"],
      [{ ids, groupId }],
    );
  }

  // ---------------- visibility, isolation, locking ----------------

  /** Hide or show bodies. */
  setVisibility(ids: number[], visible: boolean): Promise<MutationResult> {
    return this.mutate(
      carrier(
        BODY_KEYS,
        `for (const key of keys) {
              editor.db.nodes.setHidden(key, !args.visible);
              if (args.visible) editor.db.nodes.setVisible(key, true);
            }`,
      ),
      [],
      [{ ids, visible }],
    );
  }

  /** Show everything that was hidden. */
  unhideAll(): Promise<MutationResult> {
    return this.mutate(nativeCommand("this.commands.UnhideAllCommand", "selected.removeAll();"), [], [{}]);
  }

  /** Show only the given bodies until `unisolate`; nothing is changed in what is hidden. */
  isolate(ids: number[]): Promise<MutationResult> {
    return this.mutate(nativeCommand("this.commands.IsolateCommand", SELECT_BODIES), [], [{ ids }]);
  }

  /** Leave isolation: everything is shown as before. */
  unisolate(): Promise<MutationResult> {
    return this.mutate(
      nativeCommand(
        "this.commands.UnisolateCommand",
        `if (this.db.nodes.isolationLevel === 0) throw new Error('Nothing is isolated');
        selected.removeAll();`,
      ),
      [],
      [{}],
    );
  }

  /** Lock bodies against selection and editing in the window, or unlock them. */
  setLocked(ids: number[], locked: boolean): Promise<MutationResult> {
    return this.mutate(
      carrier(BODY_KEYS, `for (const key of keys) editor.db.nodes.setLocked(key, args.locked);`),
      [],
      [{ ids, locked }],
    );
  }

  /** Unlock everything. */
  unlockAll(): Promise<MutationResult> {
    return this.mutate(nativeCommand("this.commands.UnlockAllCommand", "selected.removeAll();"), [], [{}]);
  }

  // ---------------- materials ----------------

  listMaterials(): Promise<MaterialInfo[]> {
    return this.enqueue(() => this.call<MaterialInfo[]>(READ_MATERIALS));
  }

  /** Add a material to the document. Undoable. */
  createMaterial(spec: MaterialSpec): Promise<MaterialInfo> {
    return this.enqueue(async () => {
      await this.waitForBackup();
      const before = new Set((await this.call<MaterialInfo[]>(READ_MATERIALS)).map((m) => m.id));
      await this.call(
        carrier(
          "",
          `const material = editor.db.materials.default.clone();
            material.color.set(args.color);
            material.roughness = args.roughness;
            material.metalness = args.metalness;
            material.opacity = args.opacity;
            material.transparent = args.opacity < 1;
            editor.db.materials.add(args.name, material);`,
        ),
        [],
        [spec],
      );
      const created = (await this.call<MaterialInfo[]>(READ_MATERIALS)).filter((m) => !before.has(m.id));
      if (created.length !== 1) throw new Error("Plasticity did not add the material");
      return created[0]!;
    });
  }

  /** Give bodies a material of the document. */
  setMaterial(ids: number[], materialId: number): Promise<MutationResult> {
    return this.mutate(
      carrier(
        `${BODY_KEYS}
        if (!this.db.materials.has(args.materialId)) throw new Error('Unknown material id: ' + args.materialId);`,
        `for (const key of keys) editor.db.nodes.setMaterial(key, args.materialId);`,
      ),
      [],
      [{ ids, materialId }],
    );
  }

  /** Take the material off bodies; the material stays in the document. Clears the selection. */
  removeMaterial(ids: number[]): Promise<MutationResult> {
    return this.mutate(nativeCommand("this.commands.RemoveMaterialCommand", SELECT_BODIES), [], [{ ids }]);
  }

  // ---------------- selection ----------------

  /** What is selected in the window: bodies, faces, edges, regions, groups. */
  getSelectionDetail(): Promise<SelectionDetail> {
    return this.enqueue(() => this.call<SelectionDetail>(READ_SELECTION));
  }

  /** Select faces and edges of one body in the window, replacing the selection. Not an undo step. */
  selectTopology(id: number, faceIds: string[] = [], edgeIds: string[] = []): Promise<SelectionDetail> {
    return this.enqueue(async () => {
      // Resolve every id before touching the selection, so a bad id changes nothing.
      await this.call(
        `function (args) {
          ${BUSY_GUARD}
          ${FIND_VIEW}
          ${PICK_TOPOLOGY}
          const view = find(args.id);
          const type = view.constructor.name;
          if (type !== 'Solid' && type !== 'Sheet') throw new Error('Body ' + args.id + ' is a ' + (type === 'Wire' ? 'curve' : type) + ', not a Solid or Sheet');
          const faces = pick(view.high.faces, args.faceIds, 'face');
          const edges = pick(view.high.edges, args.edgeIds, 'edge');
          const selected = this.selection.selected;
          selected.removeAll();
          for (const face of faces) selected.addFace(face);
          for (const edge of edges) selected.addEdge(edge);
        }`,
        [],
        [{ id, faceIds, edgeIds }],
      );
      return this.call<SelectionDetail>(READ_SELECTION);
    });
  }
}
