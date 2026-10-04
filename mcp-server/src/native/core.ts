/** Connection to a Plasticity window, command execution and history. */

import { CdpClient, CdpTarget, EvaluateResult, GetPropertiesResult } from "../cdp.js";

import { CDP_PORT, SUPPORTED_VERSION, findRendererTargets, getAppVersion } from "../launcher.js";
import { delay } from "./math.js";
import { BUSY_GUARD, READ_STATE } from "./snippets.js";
import { BodyInfo, MutationResult, NativeState, Vec3 } from "./types.js";

export const OBJECT_GROUP = "plasticity-mcp";

export const COMMAND_TIMEOUT_MS = 60_000;

export const LOAD_TIMEOUT_MS = 40_000;

/** Append an explanation to a native kernel error that says nothing useful on its own. */
export function withHint<T>(operation: Promise<T>, marker: string, hint: string): Promise<T> {
  return operation.catch((err: Error) => {
    throw err.message.includes(marker) ? new Error(`${err.message.trim()} ${hint}`) : err;
  });
}

/** The window exists but the app inside it has not built its UI yet. */
export class NotReadyError extends Error {
  constructor() {
    super("Plasticity command log is not ready yet (window still loading)");
  }
}

/** Everything about a body except its selection flag, for change detection. */
export const fingerprint = ({ selected: _selected, ...rest }: BodyInfo): string => JSON.stringify(rest);

/** Centre of the combined bounding box of the given bodies, in millimetres. */
export function boundsCentre(state: NativeState, ids: number[]): Vec3 {
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

export class NativeCore {
  protected client: CdpClient | null = null;

  protected target: CdpTarget | null = null;

  protected editorId = "";

  protected bindings = new Map<string, string>();

  protected tail: Promise<unknown> = Promise.resolve();

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

  protected async waitUntilLoaded(client: CdpClient): Promise<string> {
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
  protected async waitForBackup(): Promise<void> {
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

  protected async discover(client: CdpClient): Promise<void> {
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

  protected enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.tail.then(operation, operation);
    this.tail = run.catch(() => {});
    return run;
  }

  protected async call<T>(
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
  protected mutate(
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
          return previous !== undefined &&
            (fingerprint(previous) !== fingerprint(b) || before.versions[b.id] !== after.versions[b.id]);
        }),
        removedIds: before.bodies.filter((b) => !afterIds.has(b.id)).map((b) => b.id),
        bodyCount: after.bodies.length,
        undoDepth: after.undoDepth,
        redoDepth: after.redoDepth,
      };
    });
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
}
