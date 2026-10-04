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
import { readFile, writeFile } from "node:fs/promises";
import { CdpClient, CdpTarget, EvaluateResult, GetPropertiesResult } from "./cdp.js";
import { checkInput, checkOutput, writeStaged } from "./files.js";
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
const IMPORT_TIMEOUT_MS = 300_000;
const SCREENSHOT_TIMEOUT_MS = 15_000;
/** Longest side of a returned screenshot, in pixels. */
const SCREENSHOT_MAX_SIDE = 1568;

const STEP_EXTENSIONS = [".step", ".stp"];

export type ViewName = "front" | "back" | "left" | "right" | "top" | "bottom" | "isometric";

// Arguments of viewport.navigateToOrientation, checked live on 26.1.3.
const VIEW_ORIENTATIONS: Record<Exclude<ViewName, "isometric">, number> = {
  right: 0,
  back: 1,
  top: 2,
  left: 3,
  front: 4,
  bottom: 5,
};

export interface FileResult {
  path: string;
  bytes: number;
}

export interface Screenshot {
  png: Buffer;
  width: number;
  height: number;
}

export interface CameraInfo {
  view: ViewName;
  /** Unit vector from the look-at target towards the camera. */
  direction: Vec3;
  targetMm: Vec3;
  mode: string;
  /** True for the six axis views: Plasticity shows them in X-ray with a view label. */
  aligned: boolean;
}

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
    timeoutMs = COMMAND_TIMEOUT_MS,
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
      timeoutMs,
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
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<MutationResult> {
    return this.enqueue(async () => {
      await this.waitForBackup();
      const before = await this.call<NativeState>(READ_STATE);
      const callValues = typeof values === "function" ? values(before) : values;
      await this.call(functionDeclaration, bindingNames, callValues, timeoutMs);
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

  /** Straight segments through `pointsMm`; `closed` joins the last point back to the first. */
  createPolyline(pointsMm: Vec3[], closed = false, name?: string): Promise<MutationResult> {
    return this.createCurve("Polyline", pointsMm, closed, name);
  }

  /** Smooth curve interpolated through `pointsMm`. */
  createSpline(pointsMm: Vec3[], closed = false, name?: string): Promise<MutationResult> {
    return this.createCurve("NURBS", pointsMm, closed, name);
  }

  private createCurve(
    type: "Polyline" | "NURBS",
    pointsMm: Vec3[],
    closed: boolean,
    name?: string,
  ): Promise<MutationResult> {
    const setup = `
        factory.points = args.points.map((p) => new Vector3(...p));
        factory.type = CurveType[args.type];
        factory.closed = args.closed;`;
    return this.mutate(
      commandFunction("CurveCommand", ["Vector3", "CurveType"], setup),
      ["CurveFactory", "Vector3", "CurveType"],
      [{ type, points: pointsMm.map(toMeters), closed, name: name ?? null }],
    );
  }

  /** Circle in the plane perpendicular to `normal` (default +Z). */
  createCircle(
    centerMm: Vec3,
    radiusMm: number,
    normal: Vec3 = [0, 0, 1],
    name?: string,
  ): Promise<MutationResult> {
    // The factory takes a centre, a plane orientation and one point on the circle.
    const setup = `
        factory.center.fromArray(args.center);
        factory.orientation.copy(
          new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...args.normal).normalize()),
        );
        factory.point.copy(factory.center).add(
          new Vector3(args.radius, 0, 0).applyQuaternion(factory.orientation),
        );`;
    return this.mutate(
      commandFunction("CenterCircleCommand", ["Vector3", "Quaternion"], setup),
      ["CenterCircleFactory", "Vector3", "Quaternion"],
      [{ center: toMeters(centerMm), radius: radiusMm * MM, normal, name: name ?? null }],
    );
  }

  /**
   * Extrude a curve by `distanceMm`. A closed planar curve gives a Solid, an open curve a Sheet.
   * Refuses a closed curve whose profile is ambiguous (nested or overlapping closed curves in
   * the same plane).
   */
  extrudeProfile(id: number, distanceMm: number): Promise<MutationResult> {
    // Plasticity builds Regions automatically from the closed curves of a plane, but a Region
    // does not say which curve it came from. Match by bounding box instead: exactly one Region
    // of that plane may lie inside the curve's box, and it must fill it. Region boxes come
    // from the display mesh, hence the tolerance.
    const setup = `
        const item = findItem(args.id);
        const view = item.view;
        const type = view.constructor.name;
        if (type !== 'Wire') throw new Error('Body ' + args.id + ' is a ' + type + ', not a curve');
        if (item.model?.IsClosed?.()) {
          let basis;
          try { basis = editor.curves.lookup(view); }
          catch { throw new Error('Closed curve ' + args.id + ' is not planar, so it has no profile to extrude'); }
          const sketch = Array.from(editor.curves.read.sketch2basis ?? []).find(([, b]) => b === basis)?.[0];
          const box = item.model.FindBox();
          const axes = ['x', 'y', 'z'];
          const tol = Math.max(1e-5, 0.01 * Math.hypot(...axes.map((k) => box.max[k] - box.min[k])));
          const inside = (b) => axes.every((k) => b.min[k] >= box.min[k] - tol && b.max[k] <= box.max[k] + tol);
          const fills = (b) => axes.every((k) => Math.abs(b.min[k] - box.min[k]) <= tol && Math.abs(b.max[k] - box.max[k]) <= tol);
          const regions = [];
          for (const [, candidate] of editor.geo.geometryModel) {
            if (candidate.view?.constructor?.name !== 'SketchIsland') continue;
            let candidateSketch;
            try { candidateSketch = editor.sketches.getSketchId(candidate.view); } catch { continue; }
            if (String(candidateSketch) !== String(sketch)) continue;
            for (let i = 0; i < (candidate.view.regions?.length ?? 0); i += 1) {
              const region = candidate.view.regions.get(i);
              if (region && inside(region.getBoundingBox())) regions.push(region);
            }
          }
          if (regions.length === 0) throw new Error('Plasticity built no region for closed curve ' + args.id);
          if (regions.length > 1 || !fills(regions[0].getBoundingBox())) {
            throw new Error('The profile of curve ' + args.id + ' is ambiguous: other closed curves in the same plane are nested in it or overlap it. Move or delete them, or build the shape with boolean.');
          }
          factory.regions = regions;
        } else {
          factory.curves = [view];
        }
        factory.distance1 = args.distance;`;
    return this.mutate(
      commandFunction("ExtrudeCommand", [], setup),
      ["ExtrudeFactory"],
      [{ id, distance: distanceMm * MM }],
    );
  }

  /**
   * Export bodies as exact B-Rep to a STEP file. Without `ids`, every Solid and Sheet of the
   * document is exported. Does not touch the undo history.
   */
  exportStep(path: string, ids?: number[], overwrite = false): Promise<FileResult & { ids: number[] }> {
    return this.enqueue(async () => {
      const output = await checkOutput(path, STEP_EXTENSIONS, overwrite);
      const state = await this.call<NativeState>(READ_STATE);
      const exported =
        ids ?? state.bodies.filter((b) => b.type === "Solid" || b.type === "Sheet").map((b) => b.id);
      if (exported.length === 0) throw new Error("Nothing to export: the document has no Solid or Sheet");
      const bytes = await writeStaged(
        output,
        overwrite,
        (staged) =>
          this.call(
            `async function (Factory, args) {
              ${BUSY_GUARD}
              ${FIND_VIEW}
              const factory = new Factory(this);
              factory.items = args.ids.map(find);
              factory.filePath = args.path;
              await factory.commit();
            }`,
            ["ExportCadFactory"],
            [{ ids: exported, path: staged }],
          ),
        async (staged) => {
          const text = await readFile(staged, "utf8").catch(() => "");
          if (!text.startsWith("ISO-10303-21;") || !text.includes("END-ISO-10303-21;")) {
            throw new Error("Plasticity did not produce a valid STEP file");
          }
        },
      );
      return { path: output, bytes, ids: exported };
    });
  }

  /** Add the geometry of a STEP file to the current document. */
  async importStep(path: string): Promise<MutationResult> {
    const input = await checkInput(path, STEP_EXTENSIONS);
    // ImportCommand is not in editor.commands; it comes from the module closure.
    return this.mutate(
      `async function (Factory, Command, args) {
        ${BUSY_GUARD}
        const editor = this;
        let failure;
        const command = new Command(this);
        command.remember = false;
        command.execute = async function () {
          try {
            const factory = new Factory(editor).resource(this);
            factory.filePath = args.path;
            await factory.commit();
          } catch (error) {
            failure = error;
            throw error;
          }
        };
        await this.exec(command);
        if (failure) throw failure;
      }`,
      ["ExchangeImportFactory", "ImportCommand"],
      [{ path: input }],
      IMPORT_TIMEOUT_MS,
    );
  }

  /**
   * Save a copy of the document as a .plasticity file. The open document keeps its own
   * file association (an Untitled document stays Untitled).
   */
  saveCopy(path: string, overwrite = false): Promise<FileResult> {
    return this.enqueue(async () => {
      const output = await checkOutput(path, [".plasticity"], overwrite);
      const bytes = await writeStaged(
        output,
        overwrite,
        (staged) =>
          this.call(
            `async function (args) {
              ${BUSY_GUARD}
              await this.saver.save(args.path);
            }`,
            [],
            [{ path: staged }],
          ),
        async (staged) => {
          const header = await readFile(staged).catch(() => Buffer.alloc(0));
          if (header.subarray(0, 10).toString() !== "plasticity") {
            throw new Error("Plasticity did not produce a valid document file");
          }
        },
      );
      return { path: output, bytes };
    });
  }

  /**
   * PNG of the first 3D viewport (not the whole window), scaled so that its longest side is
   * at most SCREENSHOT_MAX_SIDE pixels. Optionally also written to `path`.
   */
  screenshot(path?: string, overwrite = false): Promise<Screenshot & { path?: string }> {
    return this.enqueue(async () => {
      const output = path === undefined ? undefined : await checkOutput(path, [".png"], overwrite);
      const client = this.client;
      const area = await this.call<{ x: number; y: number; width: number; height: number; dpr: number }>(
        `function () {
          if (document.hidden) {
            throw new Error('The Plasticity window is hidden or minimized; restore it and retry');
          }
          const element = document.querySelector('plasticity-viewport');
          if (!element) throw new Error('Plasticity viewport element was not found');
          for (const viewport of this.viewports) viewport.setNeedsRender();
          const r = element.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, dpr: window.devicePixelRatio };
        }`,
      );
      await delay(200); // let the requested frame render
      const scale = Math.min(1, SCREENSHOT_MAX_SIDE / (Math.max(area.width, area.height) * area.dpr));
      const shot = await client!
        .send<{ data: string }>(
          "Page.captureScreenshot",
          {
            format: "png",
            clip: { x: area.x, y: area.y, width: area.width, height: area.height, scale },
          },
          SCREENSHOT_TIMEOUT_MS,
        )
        .catch((err: Error) => {
          throw new Error(
            `Could not capture the viewport (${err.message}). Make sure the Plasticity window is visible.`,
          );
        });
      const png = Buffer.from(shot.data, "base64");
      if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") {
        throw new Error("Plasticity returned an invalid screenshot");
      }
      if (output !== undefined) await writeFile(output, png);
      return { png, width: png.readUInt32BE(16), height: png.readUInt32BE(20), path: output };
    });
  }

  /**
   * Point the first viewport's camera at a standard view. `fit` also frames every body.
   * Not an undo step.
   */
  setView(view: ViewName, fit = true): Promise<CameraInfo> {
    return this.enqueue(async () => {
      const info = await this.call<Omit<CameraInfo, "view">>(
        `async function (args) {
          ${BUSY_GUARD}
          const viewport = Array.from(this.viewports)[0];
          if (!viewport) throw new Error('Plasticity viewport is unavailable');
          const camera = viewport.camera;
          const controls = viewport.orbitControls;
          // Navigation is animated and its promise resolves early: wait until the camera rests.
          const settle = async () => {
            let last = null;
            for (let i = 0; i < 100; i += 1) {
              await new Promise((resolve) => setTimeout(resolve, 50));
              const pose = [...camera.quaternion.toArray(), ...camera.position.toArray()];
              if (last && pose.every((v, j) => Math.abs(v - last[j]) < 1e-9)) return;
              last = pose;
            }
          };
          if (args.view === 'isometric') {
            const probe = camera.clone();
            probe.position.copy(camera.target).add(probe.position.clone().set(1, -1, 1));
            probe.lookAt(camera.target);
            controls.setQuaternion(probe.quaternion);
            // A previous front/top/... view leaves the viewport "aligned" (view label, X-ray,
            // construction plane); setting the quaternion directly does not end that state.
            if (viewport.isAlignedView) viewport.transitionFromAlignedView();
          } else {
            await viewport.navigateToOrientation(args.orientation);
          }
          await settle();
          if (args.fit) {
            const min = [Infinity, Infinity, Infinity];
            const max = [-Infinity, -Infinity, -Infinity];
            for (const [versionId, item] of this.geo.geometryModel) {
              if (!Number.isInteger(this.db.lookupStableId(versionId))) continue;
              let box = null;
              try { box = item.model?.FindBox?.() ?? null; } catch {}
              if (!box) continue;
              ['x', 'y', 'z'].forEach((k, i) => {
                min[i] = Math.min(min[i], box.min[k]);
                max[i] = Math.max(max[i], box.max[k]);
              });
            }
            if (Number.isFinite(min[0])) {
              const center = camera.target.clone().fromArray(min.map((v, i) => (v + max[i]) / 2));
              const radius = Math.max(1e-6, Math.hypot(...max.map((v, i) => v - min[i])) / 2);
              const halfV = camera.perspective.fov * Math.PI / 360;
              const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
              const limiting = Math.min(halfV, halfH);
              const distance = limiting > 0 ? radius / Math.sin(limiting) * 1.4 : radius * 3;
              controls.target.copy(center);
              controls.targetEnd.copy(center);
              controls.focalOffset.set(0, 0, 0);
              controls.focalOffsetEnd.set(0, 0, 0);
              controls.radius = controls.radiusEnd = distance;
              const width = camera.orthographic.right - camera.orthographic.left;
              const height = camera.orthographic.top - camera.orthographic.bottom;
              const zoom = Math.min(width, height) / (radius * 2 * 1.4);
              controls.zoom = controls.zoomEnd = zoom;
              camera.zoom = zoom;
              controls.setNeedsUpdate();
              controls.update(1 / 60);
              camera.updateProjectionMatrix();
            }
          }
          viewport.setNeedsRender();
          const round = (n) => Math.round(n * 1e6) / 1e6 + 0;
          const direction = camera.position.clone().sub(camera.target).normalize();
          return {
            direction: direction.toArray().map(round),
            targetMm: camera.target.toArray().map((n) => round(n * 1000)),
            mode: String(camera.mode),
            aligned: Boolean(viewport.isAlignedView),
          };
        }`,
        [],
        [{ view, fit, orientation: VIEW_ORIENTATIONS[view as Exclude<ViewName, "isometric">] ?? null }],
      );
      return { view, ...info };
    });
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
