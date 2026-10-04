/** Regions and the profile operations: extrude, revolve, sweep, loft. */

import { withHint } from "./core.js";
import { CurveTools } from "./curves.js";
import { MM, toMeters } from "./math.js";
import { FIND_VIEW, USE_PROFILE, commandFunction } from "./snippets.js";
import { MutationResult, ProfileRef, RegionInfo, Vec3 } from "./types.js";

export const profileArgs = (profile: ProfileRef) =>
  typeof profile === "number" ? { id: profile } : { regionIds: profile };

// Runs with `this` = editor. Every Region Plasticity has built from closed loops of curves.
// Bounds come from the display mesh (approximate); the rest is read from the exact face of
// the island body that backs the Region.
export const READ_REGIONS = `function () {
  const mm = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e6 + 0);
  const round = (n) => Math.round(n * 1e9) / 1e9 + 0;
  const regions = [];
  for (const [, item] of this.geo.geometryModel) {
    if (item.view?.constructor?.name !== 'SketchIsland') continue;
    const faces = new Map();
    const modelFaces = item.model?.GetFaces?.();
    for (let i = 0; i < (modelFaces?.Size?.() ?? 0); i += 1) {
      const face = modelFaces.Get(i);
      faces.set(face.Id(), face);
    }
    for (let i = 0; i < (item.view.regions?.length ?? 0); i += 1) {
      const region = item.view.regions.get(i);
      if (!region) continue;
      const box = region.getBoundingBox();
      const entry = { id: String(region.versionId), boundsMm: { min: mm(box.min), max: mm(box.max) } };
      const face = faces.get(region.entityId);
      if (face) {
        try {
          const normal = face.FindMidpoint().normal;
          entry.normal = [normal.x, normal.y, normal.z].map(round);
          const edges = face.GetEdges();
          let length = 0;
          for (let j = 0; j < edges.Size(); j += 1) length += edges.Get(j).FindLength().length;
          entry.edgeCount = edges.Size();
          entry.boundaryLengthMm = Math.round(length * 1e9) / 1e6;
          const inner = face.GetInnerLoops();
          entry.holes = typeof inner?.Size === 'function' ? inner.Size() : (inner?.length ?? 0);
        } catch {}
      }
      regions.push(entry);
    }
  }
  regions.sort((a, b) => a.id.localeCompare(b.id));
  return regions;
}`;

export class ProfileTools extends CurveTools {
  /**
   * Regions Plasticity has built from closed loops of curves. Their ids are valid only until
   * the curves of that plane change.
   */
  listRegions(): Promise<RegionInfo[]> {
    return this.enqueue(() => this.call<RegionInfo[]>(READ_REGIONS));
  }

  /**
   * Extrude a curve by `distanceMm`. A closed planar curve gives a Solid, an open curve a Sheet.
   * Refuses a closed curve whose profile is ambiguous (nested or overlapping closed curves in
   * the same plane).
   */
  extrudeProfile(profile: ProfileRef, distanceMm: number): Promise<MutationResult> {
    const setup = `
        ${USE_PROFILE}
        factory.distance1 = args.distance;`;
    return this.mutate(
      commandFunction("ExtrudeCommand", [], setup),
      ["ExtrudeFactory"],
      [{ ...profileArgs(profile), distance: distanceMm * MM }],
    );
  }

  /**
   * Revolve a curve by `angleDeg` around the axis through `axisOriginMm` along `axis`.
   * A closed planar curve gives a Solid, an open curve a Sheet.
   */
  revolveProfile(
    profile: ProfileRef,
    axisOriginMm: Vec3,
    axis: Vec3,
    angleDeg = 360,
  ): Promise<MutationResult> {
    const setup = `
        ${USE_PROFILE}
        factory.origin.fromArray(args.origin);
        factory.axis.fromArray(args.axis).normalize();
        factory.degrees = args.degrees;`;
    return withHint(
      this.mutate(
        commandFunction("RevolveCommand", [], setup),
        ["RevolveFactory"],
        [{ ...profileArgs(profile), origin: toMeters(axisOriginMm), axis, degrees: angleDeg }],
      ),
      "PK_ERROR_impossible_spin",
      "The axis must lie in the plane of the profile and must not pass through it.",
    );
  }

  /**
   * Sweep a profile curve along a path curve. A closed planar profile gives a Solid, an open
   * one a Sheet. `twistDeg` rotates the profile along the way, `scale` is its size at the end.
   */
  sweepProfile(
    profile: ProfileRef,
    pathId: number,
    twistDeg = 0,
    scale = 1,
  ): Promise<MutationResult> {
    if (profile === pathId) {
      return Promise.reject(new Error("The sweep path must be a different curve than the profile"));
    }
    const setup = `
        const path = findItem(args.pathId).view;
        if (path.constructor.name !== 'Wire') {
          throw new Error('Body ' + args.pathId + ' is a ' + path.constructor.name + ', not a curve');
        }
        ${USE_PROFILE}
        factory.spine = path;
        factory.twistDegrees = args.twist;
        factory.scale = args.scale;`;
    return this.mutate(
      commandFunction("SweepCommand", [], setup),
      ["SweepFactory"],
      [{ ...profileArgs(profile), pathId, twist: twistDeg, scale }],
    );
  }

  /**
   * Loft through `profileIds` in the given order. Closed planar profiles give a Solid, open
   * curves a Sheet; the two kinds cannot be mixed. `guideIds` are curves the surface follows
   * between the profiles; `closed` joins the last profile back to the first (3+ profiles).
   */
  async loftProfiles(
    profiles: number[] | string[],
    guideIds: number[] = [],
    closed = false,
  ): Promise<MutationResult> {
    if (new Set<number | string>(profiles).size !== profiles.length) {
      throw new Error("Loft profiles must be distinct");
    }
    if (profiles.length < 2) throw new Error("A loft needs at least two profiles");
    if (closed && profiles.length < 3) throw new Error("A closed loft needs at least three profiles");
    const loftHint =
      "Plasticity could not build this loft. A closed loop of closed profiles, or profiles " +
      "that turn through more than about half a circle, are known to fail: use fewer or " +
      "straighter profiles, or sweep_profile / revolve_profile for ring shapes.";
    if (typeof profiles[0] === "string") {
      const setup = `
        factory.regions = pickRegions(args.regionIds);
        if (args.guideIds.length > 0) factory.guides = args.guideIds.map(find);
        factory.closed = args.closed;`;
      return withHint(
        this.mutate(
          commandFunction("LoftCommand", [], setup),
          ["RegionLoftFactory"],
          [{ regionIds: profiles, guideIds, closed }],
        ),
        "PK_BODY_make_lofted_body",
        loftHint,
      );
    }
    const profileIds = profiles as number[];
    if (guideIds.some((id) => profileIds.includes(id))) {
      throw new Error("A loft guide must be a different curve than the profiles");
    }
    // Solid and Sheet lofts use different native factories, so look at the curves first.
    const kinds = await this.enqueue(() =>
      this.call<Array<{ id: number; type: string; closed: boolean }>>(
        `function (args) {
          ${FIND_VIEW}
          return args.ids.map((id) => {
            const item = findItem(id);
            return { id, type: item.view.constructor.name, closed: Boolean(item.model?.IsClosed?.()) };
          });
        }`,
        [],
        [{ ids: [...profileIds, ...guideIds] }],
      ),
    );
    const notCurve = kinds.find((k) => k.type !== "Wire");
    if (notCurve) throw new Error(`Body ${notCurve.id} is a ${notCurve.type}, not a curve`);
    const profileKinds = kinds.slice(0, profileIds.length);
    const solid = profileKinds.every((k) => k.closed);
    if (!solid && profileKinds.some((k) => k.closed)) {
      throw new Error("Loft profiles must be either all closed (Solid) or all open (Sheet)");
    }
    const args = [{ profileIds, guideIds, closed }];
    if (solid) {
      const setup = `
        factory.regions = args.profileIds.map((id) => profileOf(id).region);
        if (args.guideIds.length > 0) factory.guides = args.guideIds.map(find);
        factory.closed = args.closed;`;
      // Seen on 26.1.3: closed loops of closed profiles (22001) and profiles that turn through
      // more than about half a circle (21555) are refused by the kernel.
      return withHint(
        this.mutate(commandFunction("LoftCommand", [], setup), ["RegionLoftFactory"], args),
        "PK_BODY_make_lofted_body",
        loftHint,
      );
    }
    // The curve loft reads the selection; LoftEdgeCommand exists only in the module closure.
    const setup = `
        editor.selection.selected.removeAll();
        factory.profiles = args.profileIds.map(find);
        if (args.guideIds.length > 0) factory.guides = args.guideIds.map(find);
        factory.closed = args.closed;
        factory.join = false;`;
    return this.mutate(
      commandFunction("LoftEdgeCommand", [], setup, true),
      ["CurveLoftFactory", "LoftEdgeCommand"],
      args,
    );
  }
}
