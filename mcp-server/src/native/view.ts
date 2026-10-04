/** Camera views and screenshots. */
import { writeFile } from "node:fs/promises";

import { checkOutput } from "../files.js";

import { ExchangeTools } from "./exchange.js";
import { delay } from "./math.js";
import { BUSY_GUARD } from "./snippets.js";
import { CameraInfo, Screenshot, Vec3, ViewName } from "./types.js";

export const SCREENSHOT_TIMEOUT_MS = 15_000;

/** Longest side of a returned screenshot, in pixels. */
export const SCREENSHOT_MAX_SIDE = 1568;

// Arguments of viewport.navigateToOrientation, checked live on 26.1.3.
export const VIEW_ORIENTATIONS: Record<Exclude<ViewName, "isometric">, number> = {
  right: 0,
  back: 1,
  top: 2,
  left: 3,
  front: 4,
  bottom: 5,
};

export class ViewTools extends ExchangeTools {
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
            throw new Error('The Plasticity window is covered or minimized; bring it into view and retry');
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
   * Point the first viewport's camera at a standard view, or — with a direction instead of a
   * name — look at the model from that side (the vector from the model towards the camera),
   * shaded like the isometric view. `fit` also frames every body, or only the bodies `ids`.
   * Not an undo step.
   */
  setView(view: ViewName | Vec3, fit = true, ids?: number[]): Promise<CameraInfo> {
    const custom = Array.isArray(view);
    // The camera keeps Z up, so it cannot look straight along Z: that is what top / bottom are.
    if (custom && Math.hypot(view[0], view[1]) < 1e-6 * Math.hypot(...view)) {
      return Promise.reject(new Error("A direction along Z has no upright view; use the view top or bottom"));
    }
    const name = custom ? "custom" : view;
    const from = custom ? view : view === "isometric" ? [1, -1, 1] : null;
    return this.enqueue(async () => {
      const info = await this.call<Omit<CameraInfo, "view">>(
        `async function (args) {
          ${BUSY_GUARD}
          // Camera navigation is animated frame by frame, and a hidden window draws no frames.
          if (document.hidden) {
            throw new Error('The Plasticity window is covered or minimized; bring it into view and retry');
          }
          const viewport = Array.from(this.viewports)[0];
          if (!viewport) throw new Error('Plasticity viewport is unavailable');
          const camera = viewport.camera;
          const controls = viewport.orbitControls;
          // What to frame is settled before the camera moves, so a wrong id changes nothing.
          const min = [Infinity, Infinity, Infinity];
          const max = [-Infinity, -Infinity, -Infinity];
          if (args.fit) {
            const wanted = args.ids ? new Set(args.ids) : null;
            const found = new Set();
            for (const [versionId, item] of this.geo.geometryModel) {
              const id = this.db.lookupStableId(versionId);
              if (!Number.isInteger(id) || (wanted && !wanted.has(id))) continue;
              found.add(id);
              let box = null;
              try { box = item.model?.FindBox?.() ?? null; } catch {}
              if (!box) continue;
              ['x', 'y', 'z'].forEach((k, i) => {
                min[i] = Math.min(min[i], box.min[k]);
                max[i] = Math.max(max[i], box.max[k]);
              });
            }
            const missing = (args.ids ?? []).filter((id) => !found.has(id));
            if (missing.length > 0) throw new Error('Unknown body id: ' + missing.join(', '));
          }
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
          if (args.from) {
            const probe = camera.clone();
            probe.position.copy(camera.target).add(probe.position.clone().set(...args.from));
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
        [{ from, fit, ids: ids ?? null, orientation: VIEW_ORIENTATIONS[name as Exclude<ViewName, "isometric">] ?? null }],
      );
      return { view: name, ...info };
    });
  }
}
