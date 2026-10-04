/** Checking and measuring: validity, open edges, measurements kept in the document, continuity, section view. */

import { COMMAND_TIMEOUT_MS } from "./core.js";
import { InstanceTools } from "./instances.js";
import { MM, toMeters } from "./math.js";
import { BUSY_GUARD, FIND_TYPED, FIND_VIEW, PICK_TOPOLOGY, READ_STATE, STUCK_CHECK } from "./snippets.js";
import {
  BodyCheck,
  BoundaryEdges,
  ContinuityReport,
  MeasurementInfo,
  MeasurementMutation,
  NativeState,
  SectionView,
  Vec3,
} from "./types.js";

// Every point Plasticity can attach a measurement to: vertices, points along edges, centres of
// circles and of faces. A measurement stores such a point as (body, entity, landmark).
const SNAPS = `const snaps = [];
  for (const entry of editor.snaps.cache.entries ?? []) {
    const count = (entry.positions?.length ?? 0) / 3;
    for (let i = 0; i < count; i += 1) {
      const snap = entry.lookup(i);
      if (snap?.position) snaps.push(snap);
    }
  }
  // Landmark numbers as the measurement factory writes them (read from the running 26.1.3 app).
  const landmarkOf = (snap) => {
    const kind = snap.constructor.name;
    if (/VertexSnap$/.test(kind)) return 0;
    if (/FaceCenterPointSnap$/.test(kind)) return 6;
    if (/^Circle\\w*CenterPointSnap$/.test(kind)) return 5;
    return { 'End': 1, '1/4': 2, 'Mid': 3, '3/4': 4 }[snap.name] ?? null;
  };
  const entityOf = (snap) => Number(snap.model?.Id?.() ?? snap.faceSnap?.model?.Id?.());
  const stableOf = (snap) => editor.db.lookupStableId(snap.item?.versionId);`;

// Runs with `this` = editor.
export const READ_MEASUREMENTS = `function () {
  const editor = this;
  const mm = (v) => [v.x, v.y, v.z].map((n) => Math.round(n * 1e9) / 1e6 + 0);
  ${SNAPS}
  const items = new Map();
  for (const [versionId, item] of this.geo.geometryModel) {
    const id = this.db.lookupStableId(versionId);
    if (Number.isInteger(id)) items.set(Number(item.model?.Id?.()), { id, item });
  }
  const resolve = (target) => {
    if (!target) return null;
    const owner = items.get(Number(target.bodyId));
    const snap = owner ? snaps.find((s) => entityOf(s) === Number(target.topologyId) &&
      landmarkOf(s) === Number(target.landmark) && stableOf(s) === owner.id) : null;
    return { bodyId: owner?.id ?? null, position: snap ? snap.position : null };
  };
  const radiusOf = (target) => {
    const owner = items.get(Number(target?.bodyId));
    const edges = owner?.item?.model?.GetEdges?.();
    for (let i = 0; i < (edges?.Size?.() ?? 0); i += 1) {
      const edge = edges.Get(i);
      if (Number(edge.Id()) !== Number(target.topologyId)) continue;
      try {
        const curve = edge.GetCurve();
        const radius = (curve?.curve ?? curve)?.GetInfo?.()?.radius;
        if (Number.isFinite(radius) && radius > 0) return radius;
      } catch {}
    }
    return null;
  };
  const out = [];
  for (const measurement of Array.from(this.measurements.snapshot().repo?.measurements ?? [])) {
    const id = Number(this.measurements.lookupStableId(measurement.versionId));
    if (!Number.isInteger(id)) continue;
    const name = typeof measurement.userData?.name === 'string' ? measurement.userData.name : null;
    if (measurement.constructor?.name === 'RadialMeasurement') {
      const radius = radiusOf(measurement.target);
      out.push({
        id, kind: 'radius', name,
        bodyIds: [items.get(Number(measurement.target?.bodyId))?.id].filter(Number.isInteger),
        valueMm: radius === null ? null : Math.round(radius * 1e9) / 1e6,
        pointsMm: [],
      });
      continue;
    }
    const first = resolve(measurement.target1);
    const second = resolve(measurement.target2);
    const points = [first?.position, second?.position];
    // A zero direction means the straight distance; otherwise the distance along that axis.
    const axis = measurement.direction;
    const along = axis && Math.hypot(axis.x, axis.y, axis.z) > 0;
    let value = null;
    if (points[0] && points[1]) {
      const delta = [points[1].x - points[0].x, points[1].y - points[0].y, points[1].z - points[0].z];
      value = along ? Math.abs(delta[0] * axis.x + delta[1] * axis.y + delta[2] * axis.z) : Math.hypot(...delta);
    }
    out.push({
      id, kind: 'distance', name,
      bodyIds: [...new Set([first?.bodyId, second?.bodyId].filter(Number.isInteger))],
      valueMm: value === null ? null : Math.round(value * 1e9) / 1e6,
      pointsMm: points.filter(Boolean).map(mm),
      ...(along ? { axis: [axis.x, axis.y, axis.z].map((n) => Math.round(n * 1e9) / 1e9 + 0) } : {}),
    });
  }
  return out.sort((a, b) => a.id - b.id);
}`;

// A measuring command whose body builds measurements with a factory and adds them to the document.
const measuring = (commandName: string, prepare: string, build: string): string => `async function (Factory, args) {
        ${BUSY_GUARD}
        const editor = this;
        ${FIND_VIEW}
        ${FIND_TYPED}
        ${PICK_TOPOLOGY}
        ${SNAPS}
        ${prepare}
        let failure;
        let ran = false;
        const command = new this.commands.${commandName}(this);
        command.remember = false;
        command.execute = async function () {
          ran = true;
          try {
            const factory = new Factory(editor);
            ${build}
            const measurement = await factory.calculate();
            if (args.name) measurement.userData.name = args.name;
            await editor.measurements.update([measurement], [], []);
            for (const viewport of editor.viewports ?? []) viewport.setNeedsRender();
          } catch (error) {
            failure = error;
            throw error;
          }
        };
        await this.exec(command);
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`;

export class MeasureTools extends InstanceTools {
  /** Plasticity's Check: the kernel's fault codes for each body; none means the body is valid. */
  checkBodies(ids: number[]): Promise<BodyCheck[]> {
    return this.enqueue(() =>
      this.call<BodyCheck[]>(
        `function (args) {
          ${FIND_VIEW}
          return args.ids.map((id) => {
            const item = findItem(id);
            if (typeof item.model?.Check !== 'function') throw new Error('Body ' + id + ' cannot be checked');
            const codes = Array.from(item.model.Check(), Number);
            return { id, type: item.view.constructor.name, valid: codes.length === 0, faultCodes: codes };
          });
        }`,
        [],
        [{ ids }],
      ),
    );
  }

  /**
   * Edges of a Solid / Sheet that belong to one face only: the rim of every opening. A valid
   * Solid has none. With `select` they are also selected in the window.
   */
  findBoundaryEdges(id: number, select = false): Promise<BoundaryEdges> {
    return this.enqueue(() =>
      this.call<BoundaryEdges>(
        `function (args) {
          ${BUSY_GUARD}
          ${FIND_VIEW}
          ${FIND_TYPED}
          const item = findItem(args.id);
          const view = typed(args.id, 'Solid', 'Sheet');
          const open = new Set();
          const modelEdges = item.model.GetEdges();
          for (let i = 0; i < modelEdges.Size(); i += 1) {
            const edge = modelEdges.Get(i);
            if (edge.GetFaces().Size() === 1) open.add(edge.Id());
          }
          const ids = Array.from(view.high.edges.versionIds).map(String);
          const edgeIds = [];
          const views = [];
          ids.forEach((edgeId, index) => {
            const edgeView = view.high.edges.get(index);
            if (edgeView && open.has(edgeView.entityId)) { edgeIds.push(edgeId); views.push(edgeView); }
          });
          if (args.select) {
            this.selection.selected.removeAll();
            for (const edgeView of views) this.selection.selected.addEdge(edgeView);
          }
          return { id: args.id, type: view.constructor.name, count: edgeIds.length, edgeIds };
        }`,
        [],
        [{ id, select }],
      ),
    );
  }

  // ---------------- measurements kept in the document ----------------

  listMeasurements(): Promise<MeasurementInfo[]> {
    return this.enqueue(() => this.call<MeasurementInfo[]>(READ_MEASUREMENTS));
  }

  /** Run a mutation and report how the set of measurements changed. */
  private mutateMeasurements(
    functionDeclaration: string,
    bindingNames: string[],
    values: unknown[],
    timeoutMs = COMMAND_TIMEOUT_MS,
  ): Promise<MeasurementMutation> {
    return this.enqueue(async () => {
      await this.waitForBackup();
      const before = await this.call<MeasurementInfo[]>(READ_MEASUREMENTS);
      await this.call(functionDeclaration, bindingNames, values, timeoutMs);
      const after = await this.call<MeasurementInfo[]>(READ_MEASUREMENTS);
      const state = await this.call<NativeState>(READ_STATE);
      const beforeIds = new Set(before.map((m) => m.id));
      const afterIds = new Set(after.map((m) => m.id));
      return {
        created: after.filter((m) => !beforeIds.has(m.id)),
        removedIds: before.filter((m) => !afterIds.has(m.id)).map((m) => m.id),
        measurementCount: after.length,
        undoDepth: state.undoDepth,
        redoDepth: state.redoDepth,
      };
    });
  }

  /**
   * A distance measurement between two points of bodies, kept in the document and following
   * the geometry. Each point must be one Plasticity can attach to: a vertex, the end, quarter
   * or middle of an edge, the centre of a circle or of a face. The distance is the straight
   * one: the axis of an axis-aligned measurement is chosen by the pointer in the UI and cannot
   * be set from here.
   */
  addDistanceMeasurement(
    from: { id: number; pointMm: Vec3 },
    to: { id: number; pointMm: Vec3 },
    name?: string,
  ): Promise<MeasurementMutation> {
    const end = (e: { id: number; pointMm: Vec3 }) => ({ id: e.id, point: toMeters(e.pointMm) });
    return this.mutateMeasurements(
      measuring(
        "MeasureDistanceCommand",
        `const attach = (target) => {
          find(target.id);
          const snap = snaps.find((s) => stableOf(s) === target.id && landmarkOf(s) !== null &&
            Math.hypot(s.position.x - target.point[0], s.position.y - target.point[1], s.position.z - target.point[2]) < 1e-6);
          if (!snap) {
            throw new Error('Body ' + target.id + ' has no measurable point at [' + target.point.map((n) => n * 1000).join(', ') +
              ']: use a vertex, the end, quarter or middle of an edge, or the centre of a circle or face');
          }
          return snap;
        };
        const first = attach(args.from);
        const second = attach(args.to);
        if (first === second) throw new Error('The two points of a measurement must differ');`,
        `factory.isAxisAligned = false;
            factory.p1(first.position, first);
            factory.p2(second.position, second);`,
      ),
      ["PointToPointMeasurementFactory"],
      [{ from: end(from), to: end(to), name: name ?? null }],
    );
  }

  /** A radius measurement on a circular edge of a body, kept in the document. */
  addRadiusMeasurement(id: number, edgeId: string, name?: string): Promise<MeasurementMutation> {
    return this.mutateMeasurements(
      measuring(
        "MeasureRadiusCommand",
        `const edge = pick(typed(args.id, 'Solid', 'Sheet').high.edges, [args.edgeId], 'edge')[0];
        const snap = snaps.find((s) => s.constructor.name === 'EdgePointSnap' && stableOf(s) === args.id &&
          entityOf(s) === Number(edge.entityId));
        if (!snap || !snap.model.IsCircle()) throw new Error('Edge ' + args.edgeId + ' is not circular');`,
        `factory.snap = snap;`,
      ),
      ["RadialMeasurementFactory"],
      [{ id, edgeId, name: name ?? null }],
    );
  }

  /** Delete measurements with the native Delete command. Clears the selection. */
  deleteMeasurements(ids: number[]): Promise<MeasurementMutation> {
    return this.mutateMeasurements(
      `async function (args) {
        ${BUSY_GUARD}
        const known = new Set(Array.from(this.measurements.snapshot().repo?.measurements ?? [])
          .map((m) => Number(this.measurements.lookupStableId(m.versionId))));
        const measurements = args.ids.map((id) => {
          if (!known.has(id)) throw new Error('Unknown measurement id: ' + id);
          return this.measurements.lookupById(id);
        });
        const selected = this.selection.selected;
        selected.removeAll();
        for (const measurement of measurements) selected.addMeasurement(measurement);
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
        selected.removeAll();
        if (failure) throw failure;
        ${STUCK_CHECK}
      }`,
      [],
      [{ ids }],
    );
  }

  // ---------------- analysis ----------------

  /**
   * How smoothly the two faces along each edge meet: the largest gap, the largest angle
   * between the normals and the largest relative change of curvature, and the continuity that
   * follows from them. Nothing in the document changes.
   */
  measureContinuity(id: number, edgeIds: string[]): Promise<ContinuityReport[]> {
    return this.enqueue(() =>
      this.call<ContinuityReport[]>(
        `async function (Factory, ContinuityType, evaluate, args) {
          ${BUSY_GUARD}
          ${FIND_VIEW}
          ${FIND_TYPED}
          ${PICK_TOPOLOGY}
          const view = typed(args.id, 'Solid', 'Sheet');
          const edges = pick(view.high.edges, args.edgeIds, 'edge');
          const out = [];
          for (let i = 0; i < edges.length; i += 1) {
            const factory = new Factory(this);
            factory.continuity = ContinuityType.G2;
            factory.edges = [edges[i]];
            const tolerance = { g0: factory.g0Tolerance, g1: factory.g1Tolerance, g2: factory.g2Tolerance };
            let views = [];
            try {
              const measurements = await factory.calculate();
              views = (await evaluate(measurements, [], this.analyzer, undefined, undefined)).views;
            } catch {}
            const result = views[0];
            if (!result) { out.push({ edgeId: args.edgeIds[i], continuity: null }); continue; }
            const g0 = Number(result.g0max), g1 = Number(result.g1max), g2 = Number(result.g2max);
            const isG0 = g0 <= tolerance.g0;
            const isG1 = isG0 && g1 <= tolerance.g1;
            const isG2 = isG1 && g2 <= tolerance.g2;
            out.push({
              edgeId: args.edgeIds[i],
              continuity: isG2 ? 'G2' : isG1 ? 'G1' : isG0 ? 'G0' : 'none',
              gapMm: Math.round(g0 * 1e9) / 1e6,
              angleDeg: Math.round((g1 * 180 / Math.PI) * 1e6) / 1e6,
              curvatureChange: Math.round(g2 * 1e6) / 1e6,
            });
          }
          return out;
        }`,
        ["MeasureContinuityFactory", "ContinuityType", "evalSurfaceContinuityMeasurements"],
        [{ id, edgeIds }],
      ),
    );
  }

  /**
   * Cut the view (not the model) with a plane: everything on the side the normal points to is
   * left out of the picture. A display state of the window, outside the undo history.
   */
  setSectionView(originMm: Vec3, normal: Vec3): Promise<SectionView> {
    return this.enqueue(() =>
      this.call<SectionView>(
        `function (Factory, Vector3, args) {
          if (!this.shading) throw new Error('Plasticity does not expose a section view');
          const section = new Factory(this).section;
          const point = new Vector3(...args.origin);
          // The native plane keeps the side its normal points away from.
          const normal = new Vector3(...args.normal).normalize().negate();
          section.position.copy(point);
          section.originalPosition.copy(point);
          section.plane.setFromNormalAndCoplanarPoint(normal, point);
          section.originalPlane.copy(section.plane);
          section.visible = true;
          section.updateMatrixWorld(true);
          this.shading.section = section;
          for (const viewport of this.viewports ?? []) viewport.setNeedsRender();
          return { active: Boolean(this.shading.isSectioned) };
        }`,
        ["SectionAnalysisFactory", "Vector3"],
        [{ origin: [originMm[0] * MM, originMm[1] * MM, originMm[2] * MM], normal }],
      ),
    );
  }

  /** Remove the section view. */
  clearSectionView(): Promise<SectionView> {
    return this.enqueue(() =>
      this.call<SectionView>(`function () {
        if (!this.shading) throw new Error('Plasticity does not expose a section view');
        this.shading.section = null;
        for (const viewport of this.viewports ?? []) viewport.setNeedsRender();
        return { active: Boolean(this.shading.isSectioned) };
      }`),
    );
  }
}
