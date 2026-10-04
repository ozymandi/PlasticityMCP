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
  /** Topology counts; 0 for a Wire. */
  faceCount: number;
  edgeCount: number;
  visible: boolean;
  locked: boolean;
  selected: boolean;
}

export interface NativeState {
  busy: boolean;
  undoDepth: number;
  redoDepth: number;
  bodies: BodyInfo[];
}

export interface FaceInfo {
  id: string;
  /** Native surface class, e.g. "Plane", "Cylinder". */
  surface: string;
  planar: boolean;
  centerMm: Vec3;
  /** Outward normal at the face centre. */
  normal: Vec3;
  radiusMm?: number;
  edgeIds: string[];
}

export interface EdgeInfo {
  id: string;
  kind: "line" | "circle" | "curve";
  lengthMm: number;
  startMm: Vec3;
  midMm: Vec3;
  endMm: Vec3;
  radiusMm?: number;
  faceIds: string[];
}

export interface BodyTopology {
  id: number;
  type: string;
  faceCount: number;
  edgeCount: number;
  faces?: FaceInfo[];
  edges?: EdgeInfo[];
}

export type BooleanOperation = "union" | "difference" | "intersection";

// Native operation codes, read from the running 26.1.3 app.
const BOOLEAN_CODES: Record<BooleanOperation, number> = {
  intersection: 15901,
  difference: 15902,
  union: 15903,
};

export interface MutationResult {
  created: BodyInfo[];
  /** Bodies that kept their id but changed (bounds, name, topology, visibility, lock). */
  changed: BodyInfo[];
  removedIds: number[];
  bodyCount: number;
  undoDepth: number;
  redoDepth: number;
}

const MM = 0.001;
const OBJECT_GROUP = "plasticity-mcp";
const COMMAND_TIMEOUT_MS = 60_000;

const LOAD_TIMEOUT_MS = 40_000;

const toMeters = (v: Vec3): Vec3 => [v[0] * MM, v[1] * MM, v[2] * MM];
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The window exists but the app inside it has not built its UI yet. */
class NotReadyError extends Error {
  constructor() {
    super("Plasticity command log is not ready yet (window still loading)");
  }
}

/** Everything about a body except its selection flag, for change detection. */
const fingerprint = ({ selected: _selected, ...rest }: BodyInfo): string => JSON.stringify(rest);

/** Centre of the combined bounding box of the given bodies, in millimetres. */
function boundsCentre(state: NativeState, ids: number[]): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const id of ids) {
    const body = state.bodies.find((b) => b.id === id);
    if (!body) throw new Error(`Unknown body id: ${id}`);
    if (!body.boundsMm) throw new Error(`Body ${id} has no bounds; pass pivot explicitly`);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, body.boundsMm.min[i]!);
      max[i] = Math.max(max[i]!, body.boundsMm.max[i]!);
    }
  }
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

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
    const view = item.view;
    const nodes = this.db.nodes;
    const key = nodes.item2key(view);
    bodies.push({
      id,
      type: view?.constructor?.name ?? 'Unknown',
      name: nodes.getName(key) ?? null,
      boundsMm: box ? { min: mm(box.min), max: mm(box.max) } : null,
      faceCount: view?.high?.faces?.versionIds?.length ?? 0,
      edgeCount: view?.high?.edges?.versionIds?.length ?? 0,
      visible: Boolean(nodes.isVisible(key)) && !nodes.isHidden(key),
      locked: Boolean(nodes.isLocked(key)),
      selected: Boolean(this.selection.selected.has(view)),
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

// Snippets shared by the functions below; all run with `this` = editor.
const BUSY_GUARD = `if (this.executor.isBusy) throw new Error('Plasticity is busy with another command');`;
const FIND_VIEW = `const findItem = (id) => {
    for (const [versionId, item] of this.geo.geometryModel) {
      if (this.db.lookupStableId(versionId) === id) return item;
    }
    throw new Error('Unknown body id: ' + id);
  };
  const find = (id) => findItem(id).view;`;

// Resolves face / edge ids of one body to their views. Ids are version-specific: any change
// to the body invalidates them, so a miss is reported as stale rather than guessed at.
const PICK_TOPOLOGY = `const pick = (collection, ids, kind) => {
    const all = Array.from(collection?.versionIds ?? []).map(String);
    return ids.map((id) => {
      const index = all.indexOf(String(id));
      if (index < 0) {
        throw new Error('Stale or unknown ' + kind + ' id: ' + id + ' (re-read get_body_topology)');
      }
      return collection.get(index);
    });
  };`;

// Runs with `this` = editor. Faces and edges of one Solid / Sheet, in millimetres.
const READ_TOPOLOGY = `function (args) {
  ${FIND_VIEW}
  const round = (n) => Math.round(n * 1e9) / 1e9 + 0;
  const mm = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e6 + 0);
  const dir = (v) => [v.x, v.y, v.z].map(round);
  const len = (n) => Math.round(n * 1e9) / 1e6;
  const item = findItem(args.id);
  const view = item.view;
  const type = view?.constructor?.name ?? 'Unknown';
  if (type !== 'Solid' && type !== 'Sheet') {
    throw new Error('Body ' + args.id + ' is a ' + type + ' and has no faces or edges');
  }
  const idsByEntity = (views) => {
    const map = new Map();
    const versionIds = views?.versionIds ?? [];
    for (let i = 0; i < versionIds.length; i += 1) {
      const v = views.get(i);
      if (v) map.set(v.entityId, String(versionIds[i]));
    }
    return map;
  };
  const faceIds = idsByEntity(view.high.faces);
  const edgeIds = idsByEntity(view.high.edges);
  const adjacent = (collection, ids) => {
    const out = [];
    for (let i = 0; i < (collection?.Size?.() ?? 0); i += 1) {
      const id = ids.get(collection.Get(i).Id());
      if (id) out.push(id);
    }
    return out;
  };
  const result = { id: args.id, type, faceCount: faceIds.size, edgeCount: edgeIds.size };

  if (args.include !== 'edges') {
    const faces = [];
    const modelFaces = item.model.GetFaces();
    for (let i = 0; i < modelFaces.Size(); i += 1) {
      const face = modelFaces.Get(i);
      const id = faceIds.get(face.Id());
      if (!id) continue;
      const midpoint = face.FindMidpoint();
      const radius = face.GetRadius();
      faces.push({
        id,
        surface: face.GetSurface()?.surface?.constructor?.name ?? 'Unknown',
        planar: Boolean(face.IsPlanar()),
        centerMm: mm(midpoint.position),
        normal: dir(midpoint.normal),
        ...(Number.isFinite(radius) && radius > 0 ? { radiusMm: len(radius) } : {}),
        edgeIds: adjacent(face.GetEdges(), edgeIds),
      });
    }
    result.faces = faces;
  }

  if (args.include !== 'faces') {
    const edges = [];
    const modelEdges = item.model.GetEdges();
    for (let i = 0; i < modelEdges.Size(); i += 1) {
      const edge = modelEdges.Get(i);
      const id = edgeIds.get(edge.Id());
      if (!id) continue;
      const circle = Boolean(edge.IsCircle());
      let radiusMm;
      if (circle) {
        try {
          const curve = edge.GetCurve();
          const radius = (curve?.curve ?? curve)?.GetInfo?.()?.radius;
          if (Number.isFinite(radius) && radius > 0) radiusMm = len(radius);
        } catch {}
      }
      edges.push({
        id,
        kind: edge.IsLine() ? 'line' : circle ? 'circle' : 'curve',
        lengthMm: len(edge.FindLength().length),
        startMm: mm(edge.GetPointAndTangent(0).position),
        midMm: mm(edge.GetPointAndTangent(0.5).position),
        endMm: mm(edge.GetPointAndTangent(1).position),
        ...(radiusMm === undefined ? {} : { radiusMm }),
        faceIds: adjacent(edge.GetFaces(), faceIds),
      });
    }
    result.edges = edges;
  }
  return result;
}`;

/**
 * Wraps a factory setup snippet into a native command. The snippet sees `factory`, `editor`,
 * `args` and the extra bindings; it must not commit. Errors raised inside `execute` are
 * rethrown, because the native executor swallows them.
 */
function commandFunction(commandName: string, extraParams: string[], setup: string): string {
  return `async function (${["Factory", ...extraParams, "args"].join(", ")}) {
    ${BUSY_GUARD}
    ${FIND_VIEW}
    ${PICK_TOPOLOGY}
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
      // Right after a launch the CDP target exists before the app has loaded: wait for it,
      // and take the title from the page (the target list still says "index.html" then).
      target = { ...target!, title: await this.waitUntilLoaded(client) };
    } catch (err) {
      client.close();
      throw err;
    }
    this.client = client;
    this.target = target;
    return target;
  }

  private async waitUntilLoaded(client: CdpClient): Promise<string> {
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    const expired = () => {
      if (Date.now() > deadline) throw new Error("Plasticity window did not finish loading in time");
    };
    for (;;) {
      try {
        await this.discover(client);
        break;
      } catch (err) {
        if (!(err instanceof NotReadyError)) throw err;
        expired();
        await delay(300);
      }
    }
    for (;;) {
      const loaded = await client.send<EvaluateResult>("Runtime.callFunctionOn", {
        objectId: this.editorId,
        functionDeclaration: `function () {
          const ready = this.windowLoaded === true && document.readyState === 'complete' &&
            document.title !== 'index.html';
          return ready ? document.title : null;
        }`,
        returnByValue: true,
      });
      if (typeof loaded.result?.value === "string") return loaded.result.value;
      expired();
      await delay(300);
    }
  }

  /**
   * Plasticity writes its crash-recovery backup after each history change, but skips the write
   * while a previous one is still running. Back-to-back operations would leave a stale backup
   * (restored into the next session's Untitled document), so let each write finish first.
   */
  private async waitForBackup(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const busy = await this.call<boolean>(`function () { return Boolean(this.backup?.isBusy); }`);
      if (!busy) return;
      await delay(50);
    }
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
    if (!handlerId) throw new NotReadyError();
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
      // First line only: the rest is a renderer stack trace.
      throw new Error(`Plasticity command failed: ${detail.split("\n")[0]}`);
    }
    return response.result?.value as T;
  }

  state(): Promise<NativeState> {
    return this.enqueue(() => this.call<NativeState>(READ_STATE));
  }

  /**
   * Run a mutation and report what it changed, by diffing the bodies before and after.
   * `values` may be derived from the state read just before the call.
   */
  private mutate(
    functionDeclaration: string,
    bindingNames: string[] = [],
    values: unknown[] | ((before: NativeState) => unknown[]) = [],
  ): Promise<MutationResult> {
    return this.enqueue(async () => {
      await this.waitForBackup();
      const before = await this.call<NativeState>(READ_STATE);
      const callValues = typeof values === "function" ? values(before) : values;
      await this.call(functionDeclaration, bindingNames, callValues);
      const after = await this.call<NativeState>(READ_STATE);
      const beforeById = new Map(before.bodies.map((b) => [b.id, b]));
      const afterIds = new Set(after.bodies.map((b) => b.id));
      return {
        created: after.bodies.filter((b) => !beforeById.has(b.id)),
        changed: after.bodies.filter((b) => {
          const previous = beforeById.get(b.id);
          return previous !== undefined && fingerprint(previous) !== fingerprint(b);
        }),
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

  moveBodies(ids: number[], deltaMm: Vec3): Promise<MutationResult> {
    const setup = `
        factory.items = args.ids.map(find);
        factory.move.fromArray(args.delta);`;
    return this.mutate(
      commandFunction("MoveItemCommand", [], setup),
      ["MoveItemAndEmptyFactory"],
      [{ ids, delta: toMeters(deltaMm) }],
    );
  }

  /**
   * Rotate by `angleDeg` (right-hand rule) around `axis` through `pivotMm`.
   * Default pivot: centre of the bodies' combined bounding box.
   */
  rotateBodies(
    ids: number[],
    axis: Vec3,
    angleDeg: number,
    pivotMm?: Vec3,
  ): Promise<MutationResult> {
    // The factory's `axis` proxy does not update reliably; set the quaternion directly.
    const setup = `
        factory.items = args.ids.map(find);
        factory.pivot.fromArray(args.pivot);
        factory.rotation.copy(
          new Quaternion().setFromAxisAngle(new Vector3(...args.axis).normalize(), args.radians),
        );`;
    return this.mutate(
      commandFunction("RotateItemCommand", ["Vector3", "Quaternion"], setup),
      ["RotateItemAndEmptyFactory", "Vector3", "Quaternion"],
      (before) => [
        {
          ids,
          axis,
          radians: (angleDeg * Math.PI) / 180,
          pivot: toMeters(pivotMm ?? boundsCentre(before, ids)),
        },
      ],
    );
  }

  /**
   * Scale by per-axis `factors` relative to `pivotMm`.
   * Default pivot: centre of the bodies' combined bounding box.
   */
  scaleBodies(ids: number[], factors: Vec3, pivotMm?: Vec3): Promise<MutationResult> {
    const setup = `
        factory.items = args.ids.map(find);
        factory.pivot.fromArray(args.pivot);
        factory.scale.fromArray(args.factors);`;
    return this.mutate(
      commandFunction("ScaleItemCommand", [], setup),
      ["ProjectingScaleItemAndEmptyFactory"],
      (before) => [{ ids, factors, pivot: toMeters(pivotMm ?? boundsCentre(before, ids)) }],
    );
  }

  /**
   * Faces and edges of a Solid / Sheet. Their ids are valid only until the body changes:
   * re-read after every operation on it.
   */
  topology(id: number, include: "faces" | "edges" | "all" = "all"): Promise<BodyTopology> {
    return this.enqueue(() => this.call<BodyTopology>(READ_TOPOLOGY, [], [{ id, include }]));
  }

  /** Boolean of `toolIds` against `targetIds`. Tools are consumed unless `keepTools`. */
  boolean(
    operation: BooleanOperation,
    targetIds: number[],
    toolIds: number[],
    keepTools = false,
  ): Promise<MutationResult> {
    if (targetIds.some((id) => toolIds.includes(id))) {
      return Promise.reject(new Error("A body cannot be both a target and a tool"));
    }
    const setup = `
        factory.targets = args.targetIds.map(find);
        factory.tools = args.toolIds.map(find);
        factory.operationType = args.code;
        factory.keepTools = args.keepTools;`;
    return this.mutate(
      commandFunction("BooleanCommand", [], setup),
      ["BooleanFactory"],
      [{ targetIds, toolIds, code: BOOLEAN_CODES[operation], keepTools }],
    );
  }

  /** Round the given edges of one body with `radiusMm`. */
  filletEdges(id: number, edgeIds: string[], radiusMm: number): Promise<MutationResult> {
    return this.blendEdges(id, edgeIds, radiusMm * MM);
  }

  /** Bevel the given edges of one body by `distanceMm`. */
  chamferEdges(id: number, edgeIds: string[], distanceMm: number): Promise<MutationResult> {
    // Same native factory as fillet: a negative distance makes a chamfer.
    return this.blendEdges(id, edgeIds, -distanceMm * MM);
  }

  private blendEdges(id: number, edgeIds: string[], distance: number): Promise<MutationResult> {
    const setup = `
        const view = find(args.id);
        factory.shell = view;
        factory.edges = pick(view.high?.edges, args.edgeIds, 'edge');
        factory.distance = args.distance;`;
    return this.mutate(
      commandFunction("FilletShellCommand", [], setup),
      ["FilletShellFactory"],
      [{ id, edgeIds, distance }],
    );
  }

  /**
   * Extrude faces of one body along their normals. On a Solid this is a push / pull: positive
   * `distanceMm` adds material outward, negative cuts into the body, and the body keeps its id.
   * On a Sheet the extrusion becomes a new Solid and the Sheet is left as it is.
   */
  extrudeFaces(id: number, faceIds: string[], distanceMm: number): Promise<MutationResult> {
    // `targets` turns the extrusion into a boolean against the body; without it the result is
    // a separate Solid. A Sheet cannot be a boolean target here (PK_ERROR_boolean_failure).
    const setup = `
        const view = find(args.id);
        factory.faces = pick(view.high?.faces, args.faceIds, 'face');
        if (view.constructor.name === 'Solid') factory.targets = [view];
        factory.distance1 = args.distance;`;
    return this.mutate(
      commandFunction("ExtrudeCommand", [], setup),
      ["ExtrudeFactory"],
      [{ id, faceIds, distance: distanceMm * MM }],
    );
  }

  undo(): Promise<MutationResult> {
    return this.mutate(`async function () {
      ${BUSY_GUARD}
      await this.undo();
    }`);
  }

  redo(): Promise<MutationResult> {
    return this.mutate(`async function () {
      ${BUSY_GUARD}
      await this.redo();
    }`);
  }

  /** Bodies currently selected in the window (whole Solids / Sheets / Wires, not faces or edges). */
  async getSelection(): Promise<BodyInfo[]> {
    return (await this.state()).bodies.filter((b) => b.selected);
  }

  /** Replace the selection with the given bodies; an empty list clears it. Not an undo step. */
  selectBodies(ids: number[]): Promise<BodyInfo[]> {
    return this.enqueue(async () => {
      // Resolve every id before touching the selection, so a bad id changes nothing.
      await this.call(
        `function (args) {
          ${BUSY_GUARD}
          ${FIND_VIEW}
          const views = args.ids.map(find);
          this.selection.selected.removeAll();
          for (const view of views) this.selection.selected.add(view);
        }`,
        [],
        [{ ids }],
      );
      return (await this.call<NativeState>(READ_STATE)).bodies.filter((b) => b.selected);
    });
  }

  /** Delete bodies with the native Delete command. Replaces the current selection. */
  deleteBodies(ids: number[]): Promise<MutationResult> {
    return this.mutate(
      `async function (args) {
        ${BUSY_GUARD}
        ${FIND_VIEW}
        const views = args.ids.map(find);
        this.selection.selected.removeAll();
        for (const view of views) this.selection.selected.add(view);
        let failure;
        const command = new this.commands.DeleteCommand(this);
        command.remember = false;
        const execute = command.execute.bind(command);
        command.execute = async function () {
          try { return await execute(); }
          catch (error) { failure = error; throw error; }
        };
        await this.exec(command);
        if (failure) throw failure;
      }`,
      [],
      [{ ids }],
    );
  }

  renameBody(id: number, name: string): Promise<BodyInfo> {
    return this.enqueue(async () => {
      // Renaming has no command of its own; run it inside a native command so that it
      // becomes an undo step. GroupSelectedCommand is only the carrier, its body is replaced.
      await this.waitForBackup();
      await this.call(
        `async function (args) {
          ${BUSY_GUARD}
          ${FIND_VIEW}
          const editor = this;
          const view = find(args.id);
          let failure;
          const command = new this.commands.GroupSelectedCommand(this);
          command.remember = false;
          command.execute = async function () {
            try { editor.db.nodes.setName(editor.db.nodes.item2key(view), args.name); }
            catch (error) { failure = error; throw error; }
          };
          await this.exec(command);
          if (failure) throw failure;
        }`,
        [],
        [{ id, name }],
      );
      const body = (await this.call<NativeState>(READ_STATE)).bodies.find((b) => b.id === id);
      if (!body) throw new Error(`Body ${id} disappeared during rename`);
      return body;
    });
  }
}
