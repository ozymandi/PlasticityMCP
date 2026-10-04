/** Move, rotate, scale, copy, mirror, arrays. */

import { boundsCentre } from "./core.js";
import { MM, cross, norm, toMeters, unit } from "./math.js";
import { BUSY_GUARD, FIND_VIEW, STUCK_CHECK, commandFunction } from "./snippets.js";
import { MeasureTools } from "./measure.js";
import { CurveArrayAlignment, MutationResult, Vec3 } from "./types.js";

// Native codes, read from the running 26.1.3 app.
const ALIGNMENT_CODES: Record<CurveArrayAlignment, number> = { normal: 21560, parallel: 21561, transport: 21564 };

export class TransformTools extends MeasureTools {
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
   * Independent copies of bodies, optionally shifted by `deltaMm`. One undo step.
   * The originals are left untouched; the copies come back in `created`.
   */
  copyBodies(ids: number[], deltaMm: Vec3 = [0, 0, 0]): Promise<MutationResult> {
    if (new Set(ids).size !== ids.length) {
      return Promise.reject(new Error("Bodies to copy must be distinct"));
    }
    // Plasticity copies Solids and Sheets through instances (create, move, realize) and curves
    // through their own factory. All of it runs inside one command so that one Undo reverts it.
    return this.mutate(
      `async function (CreateInstance, RealizeInstance, CurveDuplicate, Move, args) {
        ${BUSY_GUARD}
        ${FIND_VIEW}
        const editor = this;
        const views = args.ids.map(find);
        const curves = views.filter((view) => view.constructor.name === 'Wire');
        const shells = views.filter((view) => view.constructor.name !== 'Wire');
        const shifted = args.delta.some((value) => value !== 0);
        const list = (result) => (Array.isArray(result) ? result : [result]).filter(Boolean);
        let failure;
        let ran = false;
        const command = new this.commands.GroupSelectedCommand(this);
        command.remember = false;
        command.execute = async function () {
          ran = true;
          try {
            if (shells.length > 0) {
              const create = new CreateInstance(editor).resource(this);
              create.items = shells;
              const instances = list(await create.commit());
              if (instances.length === 0) throw new Error('Plasticity created no copies');
              if (shifted) {
                const move = new Move(editor).resource(this);
                move.empties = instances;
                move.move.fromArray(args.delta);
                await move.commit();
              }
              const realize = new RealizeInstance(editor).resource(this);
              realize.empties = instances;
              await realize.commit();
            }
            if (curves.length > 0) {
              const duplicate = new CurveDuplicate(editor).resource(this);
              duplicate.curves = curves;
              const copies = list(await duplicate.commit());
              if (shifted) {
                if (copies.length !== curves.length) throw new Error('Plasticity did not return the curve copies');
                const move = new Move(editor).resource(this);
                move.items = copies;
                move.move.fromArray(args.delta);
                await move.commit();
              }
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
      ["CreateInstanceFactory", "RealizeInstanceFactory", "CurveDuplicateFactory", "MoveItemAndEmptyFactory"],
      [{ ids, delta: toMeters(deltaMm) }],
    );
  }

  /**
   * Mirror bodies across the plane through `planeOriginMm` with normal `planeNormal`.
   * The mirrored bodies are always new bodies (in `created`). Without `keepOriginal` the
   * originals are then deleted, which is a second undo step.
   */
  async mirrorBodies(
    ids: number[],
    planeOriginMm: Vec3,
    planeNormal: Vec3,
    keepOriginal = true,
  ): Promise<MutationResult> {
    // By default Plasticity's mirror also cuts the body at the plane (symmetry modelling);
    // a plain mirror must switch that off. The factory's `move` is an offset distance, not a
    // "move instead of copy" flag, so it always makes copies.
    const setup = `
        const views = args.ids.map(find);
        factory.shells = views.filter((view) => view.constructor.name !== 'Wire');
        factory.curves = views.filter((view) => view.constructor.name === 'Wire');
        factory.origin.fromArray(args.origin);
        factory.normal.fromArray(args.normal).normalize();
        factory.shouldCut = false;
        factory.shouldUnion = false;`;
    const mirrored = await this.mutate(
      commandFunction("MirrorCommand", [], setup),
      ["MirrorFactory"],
      [{ ids, origin: toMeters(planeOriginMm), normal: planeNormal }],
    );
    if (keepOriginal) return mirrored;
    // Deleting through the native Delete command keeps the history consistent. Removing the
    // items directly from inside the mirror command made Redo fail and froze the editor.
    const deleted = await this.deleteBodies(ids);
    return { ...deleted, created: mirrored.created };
  }

  /**
   * Grid of copies: `count1` items spaced `spacing1Mm` apart along `direction1`, repeated
   * `count2` times along `direction2`. Counts include the original.
   */
  arrayRectangular(
    ids: number[],
    direction1: Vec3,
    count1: number,
    spacing1Mm: number,
    direction2: Vec3 = [0, 1, 0],
    count2 = 1,
    spacing2Mm = 0,
    instances = false,
  ): Promise<MutationResult> {
    if (count1 * count2 < 2) {
      return Promise.reject(new Error("The array needs at least two items in total"));
    }
    if (count2 > 1 && norm(cross(unit(direction1), unit(direction2))) < 1e-9) {
      return Promise.reject(new Error("The two array directions must not be parallel"));
    }
    const setup = `
        factory.items = args.ids.map(find);
        factory.dir1 = new Vector3(...args.direction1).normalize();
        factory.dir2 = new Vector3(...args.direction2).normalize();
        factory.mode = 'spacing';
        factory.num1 = args.count1;
        factory.num2 = args.count2;
        factory.distance1 = args.spacing1;
        factory.distance2 = args.spacing2;
        factory.shouldMakeInstances = args.instances;`;
    const run = () =>
      this.mutate(
        commandFunction("RectangularArrayCommand", ["Vector3"], setup),
        ["RectangularArrayFactory", "Vector3"],
        [
          {
            ids,
            direction1,
            direction2,
            count1,
            count2,
            spacing1: spacing1Mm * MM,
            spacing2: spacing2Mm * MM,
            instances,
          },
        ],
      );
    return instances ? this.withInstances(run) : run();
  }

  /**
   * `count` items (the original included) spread evenly over `angleDeg` around the axis
   * through `centerMm` along `axis`.
   */
  arrayRadial(
    ids: number[],
    centerMm: Vec3,
    axis: Vec3,
    count: number,
    angleDeg = 360,
    instances = false,
  ): Promise<MutationResult> {
    const setup = `
        const axis = new Vector3(...args.axis).normalize();
        const reference = Math.abs(axis.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
        factory.items = args.ids.map(find);
        factory.center = new Vector3(...args.center);
        factory.dir1 = reference.cross(axis).normalize();
        factory.dir2 = axis;
        factory.mode = 'total';
        factory.num1 = 1;
        factory.num2 = args.count;
        factory.angle = args.radians;
        factory.shouldMakeInstances = args.instances;`;
    const run = () =>
      this.mutate(
        commandFunction("RadialArrayCommand", ["Vector3"], setup),
        ["RadialArrayFactory", "Vector3"],
        [{ ids, center: toMeters(centerMm), axis, count, radians: (angleDeg * Math.PI) / 180, instances }],
      );
    return instances ? this.withInstances(run) : run();
  }

  /**
   * `count` items (the original included) spread along a curve. Each copy keeps the offset
   * the original has from the start of the curve. `extent` (0..1) is the part of the curve
   * that is used.
   */
  arrayCurve(
    ids: number[],
    curveId: number,
    count: number,
    alignment: CurveArrayAlignment = "normal",
    twistDeg = 0,
    scale = 1,
    extent = 1,
    instances = false,
  ): Promise<MutationResult> {
    const setup = `
        factory.items = args.ids.map((id) => typed(id, 'Solid', 'Sheet', 'Wire'));
        factory.curve = typed(args.curveId, 'Wire');
        factory.num = args.count;
        factory.alignment = args.alignment;
        factory.twistDegrees = args.twist;
        factory.scale = args.scale;
        factory.distance = args.extent;
        factory.shouldMakeInstances = args.instances;`;
    if (ids.includes(curveId)) {
      return Promise.reject(new Error("The path curve cannot be one of the arrayed bodies"));
    }
    const run = () =>
      this.mutate(
        commandFunction("CurveArrayCommand", [], setup),
        ["CurveArrayFactory"],
        [{ ids, curveId, count, alignment: ALIGNMENT_CODES[alignment], twist: twistDeg, scale, extent, instances }],
      );
    return instances ? this.withInstances(run) : run();
  }
}
