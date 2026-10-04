/** The working environment: document, display units, grid, construction plane. */

import { checkInput } from "../files.js";
import { planeAxes } from "./curves.js";
import { MeasureTools } from "./measure.js";
import { toMeters } from "./math.js";
import { BUSY_GUARD, FIND_TYPED, FIND_VIEW, PICK_TOPOLOGY, READ_STATE } from "./snippets.js";
import { ConstructionPlaneSpec, Environment, NativeState } from "./types.js";

const OPEN_TIMEOUT_MS = 120_000;

// Both ways of replacing the open document refuse to drop unsaved work unless told to.
const UNSAVED_GUARD = `if (this.hasUnsavedChanges && !args.discardChanges) {
            throw new Error('The open document has unsaved changes; save it first, or pass discardChanges: true to drop them');
          }`;

// Runs with `this` = editor.
export const READ_ENVIRONMENT = `function () {
  const mm = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e6 + 0);
  const dir = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e9 + 0);
  const viewport = this.activeViewport ?? Array.from(this.viewports ?? [])[0];
  const plane = viewport?.constructionPlane;
  const settings = this.document.settings;
  return {
    document: {
      title: document.title.replace(/ - Plasticity$/, ''),
      path: this.document._filename ?? null,
      unsavedChanges: Boolean(this.hasUnsavedChanges),
    },
    units: { length: settings.Unit.length, angle: settings.Unit.angle },
    grid: { size: settings.Grid.size, every: settings.Grid.every },
    constructionPlane: plane ? {
      name: plane.name ?? null,
      originMm: mm(plane.p),
      normal: dir(plane.n),
      xDirection: dir(plane.x),
    } : null,
  };
}`;

const AXES: Record<"xy" | "yz" | "xz", { normal: [number, number, number]; x: [number, number, number] }> = {
  xy: { normal: [0, 0, 1], x: [1, 0, 0] },
  yz: { normal: [1, 0, 0], x: [0, 1, 0] },
  xz: { normal: [0, 1, 0], x: [1, 0, 0] },
};

export class EnvironmentTools extends MeasureTools {
  getEnvironment(): Promise<Environment> {
    return this.enqueue(() => this.call<Environment>(READ_ENVIRONMENT));
  }

  /**
   * Set the active construction plane of every viewport: a world plane, a plane through a
   * point, or the plane of a planar face. A state of the window, outside the undo history;
   * drawing in the window and `create_outline` follow it.
   */
  setConstructionPlane(spec: ConstructionPlaneSpec): Promise<Environment> {
    let args: Record<string, unknown>;
    if ("preset" in spec) {
      args = { origin: [0, 0, 0], normal: AXES[spec.preset].normal, x: AXES[spec.preset].x, reset: spec.preset === "xy" };
    } else if ("faceId" in spec) {
      args = { id: spec.id, faceId: spec.faceId };
    } else {
      let axes;
      try {
        axes = planeAxes(spec.normal, spec.xDirection);
      } catch (err) {
        return Promise.reject(err);
      }
      args = { origin: toMeters(spec.originMm), normal: axes.z, x: axes.x };
    }
    return this.enqueue(async () => {
      await this.call(
        `function (ConstructionPlaneSnap, Vector3, args) {
          ${BUSY_GUARD}
          ${FIND_VIEW}
          ${FIND_TYPED}
          ${PICK_TOPOLOGY}
          const viewports = Array.from(this.viewports ?? []);
          if (viewports.length === 0) throw new Error('Plasticity has no viewport to set a construction plane on');
          let plane = null;
          if (args.faceId) {
            const view = typed(args.id, 'Solid', 'Sheet');
            const entityId = pick(view.high.faces, [args.faceId], 'face')[0].entityId;
            const faces = findItem(args.id).model.GetFaces();
            let face = null;
            for (let i = 0; i < faces.Size(); i += 1) if (faces.Get(i).Id() === entityId) face = faces.Get(i);
            if (!face?.IsPlanar()) throw new Error('Face ' + args.faceId + ' is not planar');
            const middle = face.FindMidpoint();
            const normal = new Vector3(middle.normal.x, middle.normal.y, middle.normal.z).normalize();
            const reference = Math.abs(normal.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
            const x = reference.clone().cross(normal).normalize();
            plane = new ConstructionPlaneSnap(normal, new Vector3(middle.position.x, middle.position.y, middle.position.z), x);
          } else if (!args.reset) {
            plane = new ConstructionPlaneSnap(new Vector3(...args.normal), new Vector3(...args.origin), new Vector3(...args.x));
          }
          for (const viewport of viewports) {
            if (plane) viewport.constructionPlane = plane;
            else viewport.resetCplane();
            viewport.setNeedsRender?.();
          }
        }`,
        ["ConstructionPlaneSnap", "Vector3"],
        [args],
      );
      return this.call<Environment>(READ_ENVIRONMENT);
    });
  }

  /**
   * Open a .plasticity file in this window, in place of the current document. Refused while
   * the current document has unsaved changes, unless `discardChanges`.
   */
  async openDocument(path: string, discardChanges = false): Promise<Environment & { bodyCount: number }> {
    const input = await checkInput(path, [".plasticity"]);
    return this.enqueue(async () => {
      await this.waitForBackup();
      await this.call(
        `async function (args) {
          ${BUSY_GUARD}
          ${UNSAVED_GUARD}
          await this.open(args.path);
        }`,
        [],
        [{ path: input, discardChanges }],
        OPEN_TIMEOUT_MS,
      );
      const state = await this.call<NativeState>(READ_STATE);
      return { ...(await this.call<Environment>(READ_ENVIRONMENT)), bodyCount: state.bodies.length };
    });
  }

  /**
   * Start a new Untitled document in this window, in place of the current one: Plasticity's
   * startup document. Refused while there are unsaved changes, unless `discardChanges`.
   */
  newDocument(discardChanges = false): Promise<Environment & { bodyCount: number }> {
    return this.enqueue(async () => {
      await this.waitForBackup();
      await this.call(
        `async function (args) {
          ${BUSY_GUARD}
          ${UNSAVED_GUARD}
          await this.loadStartup();
        }`,
        [],
        [{ discardChanges }],
        OPEN_TIMEOUT_MS,
      );
      const state = await this.call<NativeState>(READ_STATE);
      return { ...(await this.call<Environment>(READ_ENVIRONMENT)), bodyCount: state.bodies.length };
    });
  }
}
