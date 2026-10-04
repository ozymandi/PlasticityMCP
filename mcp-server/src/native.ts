/**
 * Native CAD access to a running Plasticity window over CDP.
 *
 * Plasticity exposes no globals, but `editor` and every Factory class are reachable through the
 * closure scopes of the <command-log> element's `handleCommandStarted` callback. We keep remote
 * object references to them and run operations with Runtime.callFunctionOn — a native command is
 * constructed from `editor.commands`, its `execute` is replaced with a parameterised factory
 * call, and it goes through `editor.exec`, so results are real B-Rep with native Undo/Redo.
 *
 * This is an unofficial integration against internal APIs, pinned to SUPPORTED_VERSION.
 * Public units are millimetres; Plasticity's internal units are metres.
 */
import { CdpClient, CdpTarget, EvaluateResult, GetPropertiesResult } from "./cdp.js";
import { CDP_PORT, SUPPORTED_VERSION, findRendererTargets, getAppVersion } from "./launcher.js";

export type Vec3 = [number, number, number];

export interface BodyInfo {
  id: number;
  type: string;
  name: string | null;
  boundsMm: { min: Vec3; max: Vec3 } | null;
}

export interface NativeState {
  busy: boolean;
  undoDepth: number;
  redoDepth: number;
  bodies: BodyInfo[];
}

export interface MutationResult {
  created: BodyInfo[];
  removedIds: number[];
  bodyCount: number;
  undoDepth: number;
  redoDepth: number;
}

const MM = 0.001;
const OBJECT_GROUP = "plasticity-mcp";
const COMMAND_TIMEOUT_MS = 60_000;

const toMeters = (v: Vec3): Vec3 => [v[0] * MM, v[1] * MM, v[2] * MM];

// Runs with `this` = editor. Only bodies with a stable id are public: sketching leaves
// transient fragments without one.
const READ_STATE = `function () {
  // Metres to millimetres, rounded to 1e-6 mm to drop float noise.
  const mm = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e6 + 0);
  const bodies = [];
  for (const [versionId, item] of this.geo.geometryModel) {
    const id = this.db.lookupStableId(versionId);
    if (!Number.isInteger(id)) continue;
    let box = null;
    try { box = item.model?.FindBox?.() ?? null; } catch {}
    const key = this.db.nodes?.item2key?.(item.view);
    bodies.push({
      id,
      type: item.view?.constructor?.name ?? 'Unknown',
      name: key === undefined ? null : (this.db.nodes?.getName?.(key) ?? null),
      boundsMm: box ? { min: mm(box.min), max: mm(box.max) } : null,
    });
  }
  bodies.sort((a, b) => a.id - b.id);
  return {
    busy: Boolean(this.executor.isBusy),
    undoDepth: this.history?.undoStack?.length ?? 0,
    redoDepth: this.history?.redoStack?.length ?? 0,
    bodies,
  };
}`;

/**
 * Wraps a factory setup snippet into a native command. The snippet sees `factory`, `editor`,
 * `args` and the extra bindings; it must not commit. Errors raised inside `execute` are
 * rethrown, because the native executor swallows them.
 */
function commandFunction(commandName: string, extraParams: string[], setup: string): string {
  return `async function (${["Factory", ...extraParams, "args"].join(", ")}) {
    if (this.executor.isBusy) throw new Error('Plasticity is busy with another command');
    const editor = this;
    let failure;
    const command = new this.commands.${commandName}(this);
    command.remember = false;
    command.execute = async function () {
      try {
        const factory = new Factory(editor).resource(this);
        ${setup}
        const created = await factory.commit();
        if (args.name && created) {
          for (const view of (Array.isArray(created) ? created : [created])) {
            editor.db.nodes.setName(editor.db.nodes.item2key(view), args.name);
          }
        }
      } catch (error) {
        failure = error;
        throw error;
      }
    };
    await this.exec(command);
    if (failure) throw failure;
  }`;
}

export class NativeSession {
  private client: CdpClient | null = null;
  private target: CdpTarget | null = null;
  private editorId = "";
  private bindings = new Map<string, string>();
  private tail: Promise<unknown> = Promise.resolve();

  isConnected(): boolean {
    return this.client !== null && this.client.isOpen();
  }

  getTarget(): CdpTarget | null {
    return this.isConnected() ? this.target : null;
  }

  /**
   * Attach to a Plasticity window. With several windows open the caller must pick one by
   * target id — titles are not unique.
   */
  async connect(targetId?: string): Promise<CdpTarget> {
    const targets = await findRendererTargets();
    if (targets.length === 0) {
      throw new Error(
        `No Plasticity window is reachable on 127.0.0.1:${CDP_PORT}. Call native_launch first.`,
      );
    }
    const version = await getAppVersion();
    if (version !== SUPPORTED_VERSION) {
      throw new Error(
        `Plasticity ${version ?? "(unknown version)"} is running, but this adapter is pinned to ` +
          `${SUPPORTED_VERSION}: internal APIs differ between versions.`,
      );
    }
    let target: CdpTarget | undefined;
    if (targetId) {
      target = targets.find((t) => t.id === targetId);
      if (!target) throw new Error(`Plasticity window not found: ${targetId}`);
    } else if (targets.length === 1) {
      target = targets[0];
    } else {
      const list = targets.map((t) => `${t.id} ("${t.title}")`).join(", ");
      throw new Error(`Several Plasticity windows are open; pass targetId. Available: ${list}`);
    }

    this.disconnect();
    const client = await CdpClient.connect(target!.webSocketDebuggerUrl);
    try {
      await client.send("Runtime.enable");
      await this.discover(client);
    } catch (err) {
      client.close();
      throw err;
    }
    this.client = client;
    this.target = target!;
    return target!;
  }

  disconnect(): void {
    if (this.client?.isOpen()) {
      this.client.send("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP }).catch(() => {});
      this.client.close();
    }
    this.client = null;
    this.target = null;
    this.editorId = "";
    this.bindings.clear();
  }

  private async discover(client: CdpClient): Promise<void> {
    const handler = await client.send<EvaluateResult>("Runtime.evaluate", {
      expression: "document.querySelector('command-log')?.handleCommandStarted",
      objectGroup: OBJECT_GROUP,
    });
    const handlerId = handler.result?.objectId;
    if (!handlerId) {
      throw new Error("Plasticity command log is not ready yet (window still loading?)");
    }
    const props = (id: string) =>
      client.send<GetPropertiesResult>("Runtime.getProperties", { objectId: id });

    const scopesId = (await props(handlerId)).internalProperties?.find(
      (p) => p.name === "[[Scopes]]",
    )?.value?.objectId;
    if (!scopesId) throw new Error("Plasticity command scopes were not found");

    // Scope 0 is the CommandLog closure (holds `editor`), scope 1 is the app module closure
    // (holds the Factory classes and THREE types). Never enumerate the Global scope.
    const scopeIds = (await props(scopesId)).result
      .filter((p) => /^\d+$/.test(p.name))
      .map((p) => p.value?.objectId);
    if (!scopeIds[0] || !scopeIds[1]) throw new Error("Plasticity native scopes were not found");

    const editorId = (await props(scopeIds[0])).result.find((p) => p.name === "editor")?.value
      ?.objectId;
    if (!editorId) throw new Error("Plasticity editor was not found in the command log closure");

    // Function source is hidden (V8 bytecode), so classes can only be identified by binding name.
    this.bindings.clear();
    for (const p of (await props(scopeIds[1])).result) {
      if (p.value?.objectId) this.bindings.set(p.name, p.value.objectId);
    }
    this.editorId = editorId;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.catch(() => {});
    return run;
  }

  private async call<T>(
    functionDeclaration: string,
    bindingNames: string[] = [],
    values: unknown[] = [],
  ): Promise<T> {
    const client = this.client;
    if (!client || !client.isOpen()) {
      throw new Error("Not connected to Plasticity. Call native_connect first.");
    }
    const args: Array<{ objectId?: string; value?: unknown }> = [];
    for (const name of bindingNames) {
      const objectId = this.bindings.get(name);
      if (!objectId) throw new Error(`Plasticity native binding is unavailable: ${name}`);
      args.push({ objectId });
    }
    for (const value of values) args.push({ value });
    const response = await client.send<EvaluateResult>(
      "Runtime.callFunctionOn",
      {
        objectId: this.editorId,
        functionDeclaration,
        arguments: args,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      },
      COMMAND_TIMEOUT_MS,
    );
    if (response.exceptionDetails) {
      const detail =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "unknown renderer error";
      throw new Error(`Plasticity command failed: ${detail}`);
    }
    return response.result?.value as T;
  }

  state(): Promise<NativeState> {
    return this.enqueue(() => this.call<NativeState>(READ_STATE));
  }

  /** Run a mutation and report what it changed, by diffing stable body ids. */
  private mutate(
    functionDeclaration: string,
    bindingNames: string[] = [],
    values: unknown[] = [],
  ): Promise<MutationResult> {
    return this.enqueue(async () => {
      const before = await this.call<NativeState>(READ_STATE);
      await this.call(functionDeclaration, bindingNames, values);
      const after = await this.call<NativeState>(READ_STATE);
      const beforeIds = new Set(before.bodies.map((b) => b.id));
      const afterIds = new Set(after.bodies.map((b) => b.id));
      return {
        created: after.bodies.filter((b) => !beforeIds.has(b.id)),
        removedIds: before.bodies.filter((b) => !afterIds.has(b.id)).map((b) => b.id),
        bodyCount: after.bodies.length,
        undoDepth: after.undoDepth,
        redoDepth: after.redoDepth,
      };
    });
  }

  /** Axis-aligned box: `originMm` is the min corner, `sizeMm` the extents along X, Y, Z. */
  createBox(originMm: Vec3, sizeMm: Vec3, name?: string): Promise<MutationResult> {
    const setup = `
        const [x, y, z] = args.origin;
        const [w, d, h] = args.size;
        factory.p1 = new Vector3(x, y, z);
        factory.p2 = new Vector3(x + w, y, z);
        factory.p3 = new Vector3(x + w, y + d, z);
        factory.p4 = new Vector3(x + w, y + d, z + h);`;
    return this.mutate(
      commandFunction("ThreePointBoxCommand", ["Vector3"], setup),
      ["ThreePointBoxFactory", "Vector3"],
      [{ origin: toMeters(originMm), size: toMeters(sizeMm), name: name ?? null }],
    );
  }

  createSphere(centerMm: Vec3, radiusMm: number, name?: string): Promise<MutationResult> {
    const setup = `
        factory.center.fromArray(args.center);
        factory.radius = args.radius;`;
    return this.mutate(
      commandFunction("SphereCommand", [], setup),
      ["PossiblyBooleanSphereFactory"],
      [{ center: toMeters(centerMm), radius: radiusMm * MM, name: name ?? null }],
    );
  }

  /** Cylinder standing on `baseCenterMm`, extruded `heightMm` along `axis` (default +Z). */
  createCylinder(
    baseCenterMm: Vec3,
    radiusMm: number,
    heightMm: number,
    axis: Vec3 = [0, 0, 1],
    name?: string,
  ): Promise<MutationResult> {
    const setup = `
        factory.center.fromArray(args.base);
        factory.orientation.copy(
          new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...args.axis).normalize()),
        );
        factory.radius = args.radius;
        factory.height = args.height;`;
    return this.mutate(
      commandFunction("CylinderCommand", ["Vector3", "Quaternion"], setup),
      ["PossiblyBooleanCylinderFactory", "Vector3", "Quaternion"],
      [
        {
          base: toMeters(baseCenterMm),
          radius: radiusMm * MM,
          height: heightMm * MM,
          axis,
          name: name ?? null,
        },
      ],
    );
  }

  undo(): Promise<MutationResult> {
    return this.mutate(`async function () {
      if (this.executor.isBusy) throw new Error('Plasticity is busy with another command');
      await this.undo();
    }`);
  }

  redo(): Promise<MutationResult> {
    return this.mutate(`async function () {
      if (this.executor.isBusy) throw new Error('Plasticity is busy with another command');
      await this.redo();
    }`);
  }
}
