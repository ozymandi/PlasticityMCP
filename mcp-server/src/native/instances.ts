/** Instances: linked copies of bodies that live outside the list of bodies until realized. */

import { COMMAND_TIMEOUT_MS } from "./core.js";
import { toMeters } from "./math.js";
import { BUSY_GUARD, FIND_VIEW, READ_STATE, STUCK_CHECK } from "./snippets.js";
import { SurfaceTools } from "./surfaces.js";
import { InstanceInfo, InstanceMutation, MutationResult, NativeState, Vec3 } from "./types.js";

// Runs with `this` = editor. An instance has no geometry of its own: its bounds are the bounds
// of the body it points to, carried by its own transform.
export const READ_INSTANCES = `function () {
  const mm = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e6 + 0);
  const snapshot = this.db.empties.snapshot();
  const empties = Array.from(snapshot.empties ?? []);
  const infos = Array.from(snapshot.infos ?? []);
  const out = [];
  empties.forEach((empty, index) => {
    if (!empty || infos[index]?.tag !== 'Instance') return;
    const instance = this.db.lookupEmptyById(Number(empty.versionId));
    if (instance?.constructor?.name !== 'InstanceEmpty') return;
    const key = this.db.nodes.item2key(instance);
    let sourceId = null;
    let bounds = null;
    try {
      const source = this.db.nodes.key2item(instance.targetKey);
      const stable = this.db.lookupStableId(source.versionId);
      if (Number.isInteger(stable)) sourceId = stable;
      const box = this.geo.geometryModel.get(source.versionId)?.model?.FindBox?.();
      if (box) {
        const corners = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
          corners.push(instance.position.clone().set(x, y, z).applyMatrix4(instance.matrixWorld));
        }
        const pick = (axis, fn) => fn(...corners.map((c) => c[axis]));
        bounds = {
          min: mm({ x: pick('x', Math.min), y: pick('y', Math.min), z: pick('z', Math.min) }),
          max: mm({ x: pick('x', Math.max), y: pick('y', Math.max), z: pick('z', Math.max) }),
        };
      }
    } catch {}
    out.push({
      id: Number(instance.versionId),
      name: this.db.nodes.getName(key) ?? null,
      sourceId,
      boundsMm: bounds,
      visible: Boolean(this.db.nodes.isVisible(key)) && !this.db.nodes.isHidden(key),
    });
  });
  return out.sort((a, b) => a.id - b.id);
}`;

// Resolves instance ids to their objects.
const FIND_INSTANCES = `const instances = args.ids.map((id) => {
          let instance = null;
          try { instance = this.db.lookupEmptyById(id); } catch {}
          if (instance?.constructor?.name !== 'InstanceEmpty') throw new Error('Unknown instance id: ' + id);
          return instance;
        });`;

export class InstanceTools extends SurfaceTools {
  listInstances(): Promise<InstanceInfo[]> {
    return this.enqueue(() => this.call<InstanceInfo[]>(READ_INSTANCES));
  }

  /** Run a mutation and report how the set of instances changed. */
  private mutateInstances(
    functionDeclaration: string,
    bindingNames: string[],
    values: unknown[],
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<InstanceMutation> {
    return this.enqueue(async () => {
      await this.waitForBackup();
      const before = await this.call<InstanceInfo[]>(READ_INSTANCES);
      await this.call(functionDeclaration, bindingNames, values, timeoutMs);
      const after = await this.call<InstanceInfo[]>(READ_INSTANCES);
      const state = await this.call<NativeState>(READ_STATE);
      const beforeIds = new Set(before.map((i) => i.id));
      const afterIds = new Set(after.map((i) => i.id));
      return {
        created: after.filter((i) => !beforeIds.has(i.id)),
        removedIds: before.filter((i) => !afterIds.has(i.id)).map((i) => i.id),
        instanceCount: after.length,
        undoDepth: state.undoDepth,
        redoDepth: state.redoDepth,
      };
    });
  }

  /** Run a body mutation that may also make instances, and add those to its result. */
  protected async withInstances(run: () => Promise<MutationResult>): Promise<MutationResult> {
    const before = new Set((await this.listInstances()).map((i) => i.id));
    const result = await run();
    const createdInstances = (await this.listInstances()).filter((i) => !before.has(i.id));
    return { ...result, createdInstances };
  }

  /**
   * Instances of bodies or curves, optionally shifted by `deltaMm`: linked copies that follow
   * their source and are not bodies themselves. One undo step.
   */
  createInstances(ids: number[], deltaMm: Vec3 = [0, 0, 0]): Promise<InstanceMutation> {
    if (new Set(ids).size !== ids.length) {
      return Promise.reject(new Error("Bodies to instance must be distinct"));
    }
    return this.mutateInstances(
      `async function (CreateInstance, Move, args) {
        ${BUSY_GUARD}
        ${FIND_VIEW}
        const editor = this;
        const items = args.ids.map(find);
        const list = (result) => (Array.isArray(result) ? result : [result]).filter(Boolean);
        let failure;
        let ran = false;
        const command = new this.commands.CreateInstanceCommand(this);
        command.remember = false;
        command.execute = async function () {
          ran = true;
          try {
            const create = new CreateInstance(editor).resource(this);
            create.items = items;
            const instances = list(await create.commit());
            if (instances.length === 0) throw new Error('Plasticity created no instances');
            if (args.delta.some((value) => value !== 0)) {
              const move = new Move(editor).resource(this);
              move.empties = instances;
              move.move.fromArray(args.delta);
              await move.commit();
            }
          } catch (error) {
            failure = error;
            throw error;
          }
        };
        await this.exec(command);
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`,
      ["CreateInstanceFactory", "MoveItemAndEmptyFactory"],
      [{ ids, delta: toMeters(deltaMm) }],
    );
  }

  /** Turn instances into ordinary, independent bodies (in `created`). */
  realizeInstances(ids: number[]): Promise<MutationResult> {
    return this.mutate(
      `async function (Realize, args) {
        ${BUSY_GUARD}
        const editor = this;
        ${FIND_INSTANCES}
        let failure;
        let ran = false;
        const command = new this.commands.RealizeInstancesCommand(this);
        command.remember = false;
        command.execute = async function () {
          ran = true;
          try {
            const realize = new Realize(editor).resource(this);
            realize.empties = instances;
            await realize.commit();
          } catch (error) {
            failure = error;
            throw error;
          }
        };
        await this.exec(command);
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`,
      ["RealizeInstanceFactory"],
      [{ ids }],
    );
  }

  /** Delete instances with the native Delete command. Clears the selection. */
  deleteInstances(ids: number[]): Promise<InstanceMutation> {
    return this.mutateInstances(
      `async function (args) {
        ${BUSY_GUARD}
        ${FIND_INSTANCES}
        this.selection.selected.removeAll();
        for (const instance of instances) this.selection.selected.addEmpty(instance);
        let failure;
        let ran = false;
        const command = new this.commands.DeleteCommand(this);
        command.remember = false;
        const execute = command.execute.bind(command);
        command.execute = async function () {
          ran = true;
          try { return await execute(); }
          catch (error) { failure = error; throw error; }
        };
        await this.exec(command);
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`,
      [],
      [{ ids }],
    );
  }
}
