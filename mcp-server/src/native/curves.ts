/** Curves: lines, splines, circles, arcs, rectangles, polygons, spirals, text, slots, join. */

import { withHint } from "./core.js";
import { MM, add, cross, dot, norm, rotated, scaled, sub, toMeters, unit } from "./math.js";
import { PrimitiveTools } from "./primitives.js";
import { BUSY_GUARD, STUCK_CHECK, commandFunction } from "./snippets.js";
import { MutationResult, RectangleSpec, SegmentRef, Vec3 } from "./types.js";

/**
 * Unit axes of a plane: `z` along `normal`, `x` along `xDirection` projected into the plane —
 * by default the world X axis, or Y when the normal is X.
 */
export function planeAxes(normal: Vec3, xDirection?: Vec3): { x: Vec3; y: Vec3; z: Vec3 } {
  const z = unit(normal);
  const inPlane = (v: Vec3): Vec3 => sub(v, scaled(z, dot(v, z)));
  let x = inPlane(xDirection ?? [1, 0, 0]);
  if (norm(x) < 1e-9) {
    if (xDirection) throw new Error("xDirection must not be parallel to normal");
    x = inPlane([0, 1, 0]);
  }
  x = unit(x);
  return { x, y: cross(z, x), z };
}

export class CurveTools extends PrimitiveTools {
  /** Straight segments through `pointsMm`; `closed` joins the last point back to the first. */
  createPolyline(pointsMm: Vec3[], closed = false, name?: string): Promise<MutationResult> {
    return this.createCurve("Polyline", pointsMm, closed, name);
  }

  /**
   * Smooth curve: interpolated through `pointsMm`, or with `controlPoints` shaped by them as a
   * control polygon (it then passes only through the first and last point).
   */
  createSpline(pointsMm: Vec3[], closed = false, name?: string, controlPoints = false): Promise<MutationResult> {
    return this.createCurve("NURBS", pointsMm, closed, name, !controlPoints);
  }

  private createCurve(
    type: "Polyline" | "NURBS",
    pointsMm: Vec3[],
    closed: boolean,
    name?: string,
    through = true,
  ): Promise<MutationResult> {
    const setup = `
        factory.points = args.points.map((p) => new Vector3(...p));
        factory.type = CurveType[args.type];
        factory.splineThrough = args.through;
        factory.closed = args.closed;`;
    return this.mutate(
      commandFunction("CurveCommand", ["Vector3", "CurveType"], setup),
      ["CurveFactory", "Vector3", "CurveType"],
      [{ type, points: pointsMm.map(toMeters), closed, through, name: name ?? null }],
    );
  }

  /**
   * Circle through points: three points on it, or two points at the ends of a diameter — the
   * plane is then the one perpendicular to `normal` (default +Z).
   */
  createCircleThrough(pointsMm: Vec3[], normal: Vec3 = [0, 0, 1], name?: string): Promise<MutationResult> {
    if (pointsMm.length === 3) {
      const [a, b, c] = pointsMm as [Vec3, Vec3, Vec3];
      const n = cross(sub(b, a), sub(c, a));
      if (dot(n, n) <= 1e-12 * dot(sub(b, a), sub(b, a)) * dot(sub(c, a), sub(c, a))) {
        return Promise.reject(new Error("The three circle points are collinear or coincide"));
      }
      const setup = `
        factory.isKnife = false;
        factory.p1.fromArray(args.points[0]);
        factory.p2.fromArray(args.points[1]);
        factory.p3.fromArray(args.points[2]);`;
      return this.mutate(
        commandFunction("ThreePointCircleCommand", [], setup),
        ["KnifeThreePointCircleFactory"],
        [{ points: pointsMm.map(toMeters), name: name ?? null }],
      );
    }
    const [a, b] = pointsMm as [Vec3, Vec3];
    const diameter = sub(b, a);
    if (norm(diameter) === 0) return Promise.reject(new Error("The two circle points coincide"));
    if (Math.abs(dot(diameter, unit(normal))) > 1e-6 * norm(diameter)) {
      return Promise.reject(new Error("normal must be perpendicular to the line between the two points"));
    }
    const setup = `
        factory.isKnife = false;
        factory.orientation.copy(
          new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...args.normal).normalize()),
        );
        factory.p1.fromArray(args.points[0]);
        factory.p2.fromArray(args.points[1]);`;
    return this.mutate(
      commandFunction("TwoPointCircleCommand", ["Vector3", "Quaternion"], setup),
      ["KnifeTwoPointCircleFactory", "Vector3", "Quaternion"],
      [{ points: pointsMm.map(toMeters), normal, name: name ?? null }],
    );
  }

  /** Rectangle as one closed curve. */
  createRectangle(spec: RectangleSpec, name?: string): Promise<MutationResult> {
    let points: [Vec3, Vec3, Vec3];
    if ("pointsMm" in spec) {
      points = spec.pointsMm;
    } else {
      let axes;
      try {
        axes = planeAxes(spec.normal ?? [0, 0, 1], spec.xDirection);
      } catch (err) {
        return Promise.reject(err);
      }
      const corner = spec.centered
        ? sub(sub(spec.originMm, scaled(axes.x, spec.widthMm / 2)), scaled(axes.y, spec.heightMm / 2))
        : spec.originMm;
      const second = add(corner, scaled(axes.x, spec.widthMm));
      points = [corner, second, add(second, scaled(axes.y, spec.heightMm))];
    }
    // Three points: two ends of one side, and a point on the opposite side.
    const setup = `
        factory.p1 = new Vector3(...args.points[0]);
        factory.p2 = new Vector3(...args.points[1]);
        factory.p3 = new Vector3(...args.points[2]);`;
    return this.mutate(
      commandFunction("ThreePointRectangleCommand", ["Vector3"], setup),
      ["ThreePointRectangleFactory", "Vector3"],
      [{ points: points.map(toMeters), name: name ?? null }],
    );
  }

  /**
   * Regular polygon with `sides` sides. `radiusMm` reaches the vertices, or with
   * `radiusTo: "side"` the middles of the sides. One vertex lies along `xDirection`.
   */
  createPolygon(
    centerMm: Vec3,
    radiusMm: number,
    sides: number,
    normal: Vec3 = [0, 0, 1],
    radiusTo: "vertex" | "side" = "vertex",
    xDirection?: Vec3,
    name?: string,
  ): Promise<MutationResult> {
    let axes;
    try {
      axes = planeAxes(normal, xDirection);
    } catch (err) {
      return Promise.reject(err);
    }
    const setup = `
        factory.isKnife = false;
        factory.center.fromArray(args.center);
        factory.orientation.copy(
          new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...args.normal).normalize()),
        );
        factory.circumscribedOrInscribed = args.mode;
        factory.point.fromArray(args.point);
        factory.vertexCount = args.sides;`;
    return this.mutate(
      commandFunction("PolygonCommand", ["Vector3", "Quaternion"], setup),
      ["KnifePolygonFactory", "Vector3", "Quaternion"],
      [{
        center: toMeters(centerMm),
        point: toMeters(add(centerMm, scaled(axes.x, radiusMm))),
        normal: axes.z,
        // Native naming: the polygon is inscribed in the circle when the radius reaches its vertices.
        mode: radiusTo === "vertex" ? "inscribed" : "circumscribed",
        sides,
        name: name ?? null,
      }],
    );
  }

  /**
   * Helix around the axis from `baseMm` along `axis`: `turns` turns over `heightMm`, at
   * `radiusMm`. It starts in the direction of `startDirection` from the axis.
   */
  createSpiral(
    baseMm: Vec3,
    axis: Vec3,
    heightMm: number,
    radiusMm: number,
    turns: number,
    handedness: "right" | "left" = "right",
    startDirection?: Vec3,
    name?: string,
  ): Promise<MutationResult> {
    let axes;
    try {
      axes = planeAxes(axis, startDirection);
    } catch (err) {
      return Promise.reject(err);
    }
    const top = add(baseMm, scaled(axes.z, heightMm));
    const setup = `
        factory.p1 = new Vector3(...args.base);
        factory.p2 = new Vector3(...args.top);
        factory.p3 = new Vector3(...args.radiusPoint);
        factory.radius = args.radius;
        factory.turns = args.turns;
        factory.spiralPitch = 0;
        factory.handedness = args.right;`;
    return this.mutate(
      commandFunction("SpiralCommand", ["Vector3"], setup),
      ["SpiralFactory", "Vector3"],
      [{
        base: toMeters(baseMm),
        top: toMeters(top),
        radiusPoint: toMeters(add(top, scaled(axes.x, radiusMm))),
        radius: radiusMm * MM,
        turns,
        right: handedness === "right",
        name: name ?? null,
      }],
    );
  }

  /**
   * Text as curves, one or more per letter, `sizeMm` high. The baseline starts at `originMm`
   * and runs along `xDirection` in the plane perpendicular to `normal`.
   */
  createText(
    text: string,
    sizeMm: number,
    originMm: Vec3 = [0, 0, 0],
    normal: Vec3 = [0, 0, 1],
    xDirection?: Vec3,
  ): Promise<MutationResult> {
    let axes;
    try {
      axes = planeAxes(normal, xDirection);
    } catch (err) {
      return Promise.reject(err);
    }
    // Plasticity writes text at the origin of the XY plane; turning and moving it are separate
    // factories, run in the same command so that one Undo removes the text.
    const turned = Math.abs(axes.x[0] - 1) > 1e-9 || Math.abs(axes.y[1] - 1) > 1e-9 || Math.abs(axes.z[2] - 1) > 1e-9;
    return this.mutate(
      `async function (Text, Rotate, Move, Vector3, Matrix4, Quaternion, args) {
        ${BUSY_GUARD}
        const editor = this;
        const list = (result) => (Array.isArray(result) ? result : [result]).filter(Boolean);
        let failure;
        let ran = false;
        const command = new this.commands.TextCommand(this);
        command.remember = false;
        command.execute = async function () {
          ran = true;
          try {
            const text = new Text(editor).resource(this);
            text.text = args.text;
            text.size = args.size;
            let views = list(await text.commit());
            if (views.length === 0) throw new Error('Plasticity produced no curves for this text');
            if (args.turned) {
              const rotate = new Rotate(editor).resource(this);
              rotate.items = views;
              rotate.pivot.fromArray([0, 0, 0]);
              rotate.rotation.copy(new Quaternion().setFromRotationMatrix(
                new Matrix4().makeBasis(new Vector3(...args.x), new Vector3(...args.y), new Vector3(...args.z)),
              ));
              views = list(await rotate.commit());
            }
            if (args.origin.some((value) => value !== 0)) {
              const move = new Move(editor).resource(this);
              move.items = views;
              move.move.fromArray(args.origin);
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
      ["TextFactory", "RotateItemAndEmptyFactory", "MoveItemAndEmptyFactory", "Vector3", "Matrix4", "Quaternion"],
      [{ text, size: sizeMm * MM, origin: toMeters(originMm), turned, x: axes.x, y: axes.y, z: axes.z }],
    );
  }

  /**
   * Closed outlines `widthMm` wide around planar curves — slots. The curves stay. The slot lies
   * in the plane of its curve, so a single straight line, which has none, cannot be slotted.
   */
  createSlot(ids: number[], widthMm: number): Promise<MutationResult> {
    const setup = `
        factory.curves = args.ids.map((id) => typed(id, 'Wire'));
        factory.width = args.width;`;
    return withHint(
      this.mutate(commandFunction("SlotCommand", [], setup), ["SlotFactory"], [{ ids, width: widthMm * MM }]),
      "No basis found",
      "A slot needs a curve that defines a plane (a bend, an arc); a single straight line does not.",
    );
  }

  /**
   * Arc that leaves one end of a curve segment tangentially and ends at `endMm`. `flip` takes
   * the arc that leaves in the opposite direction.
   */
  createTangentArc(from: SegmentRef, at: "start" | "end", endMm: Vec3, flip = false): Promise<MutationResult> {
    const setup = `
        const segment = pick(typed(args.id, 'Wire').segments, [args.segmentId], 'segment')[0];
        const anchor = editor.db.lookupTopologyItem(segment).GetPointAndTangent(args.at === 'start' ? 0 : 1);
        factory.segment = segment;
        factory.point1.copy(anchor.position);
        factory.point2.fromArray(args.end);
        factory.flipTangent = args.flip;`;
    return this.mutate(
      commandFunction("TangentArcCommand", [], setup),
      ["TangentArcFactory"],
      [{ ...from, at, end: toMeters(endMm), flip }],
    );
  }

  /**
   * Circle of `radiusMm` tangent to two curve segments. Several circles usually fit: the one
   * nearest to `nearMm` is made.
   */
  createTangentCircle(
    first: SegmentRef,
    second: SegmentRef,
    radiusMm: number,
    nearMm: Vec3,
    normal: Vec3 = [0, 0, 1],
  ): Promise<MutationResult> {
    const setup = `
        const segment = (ref) => pick(typed(ref.id, 'Wire').segments, [ref.segmentId], 'segment')[0];
        factory.segment1 = segment(args.first);
        factory.segment2 = segment(args.second);
        factory.point.fromArray(args.near);
        factory.normal.copy(new Vector3(...args.normal).normalize());
        factory.radius = args.radius;`;
    return this.mutate(
      commandFunction("TangentCircleCommand", ["Vector3"], setup),
      ["TangentCircleFactory", "Vector3"],
      [{ first, second, radius: radiusMm * MM, near: toMeters(nearMm), normal }],
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

  /** Circular arc from `startMm` through `throughMm` to `endMm`. */
  createArc(startMm: Vec3, throughMm: Vec3, endMm: Vec3, name?: string): Promise<MutationResult> {
    const a = sub(throughMm, startMm);
    const b = sub(endMm, startMm);
    const n = cross(a, b);
    const nn = dot(n, n);
    if (nn < 1e-12 * dot(a, a) * dot(b, b) || nn === 0) {
      return Promise.reject(new Error("The three arc points are collinear or coincide"));
    }
    // Circumcentre of the triangle; start -> through -> end runs counter-clockwise about n.
    const offset = scaled(
      add(scaled(cross(b, n), dot(a, a)), scaled(cross(n, a), dot(b, b))),
      1 / (2 * nn),
    );
    return this.arc(add(startMm, offset), startMm, endMm, unit(n), name);
  }

  /**
   * Circular arc around `centerMm`, from `startMm` through `angleDeg` (right-hand rule about
   * `normal`; negative turns the other way).
   */
  createArcCenter(
    centerMm: Vec3,
    startMm: Vec3,
    angleDeg: number,
    normal: Vec3 = [0, 0, 1],
    name?: string,
  ): Promise<MutationResult> {
    const radial = sub(startMm, centerMm);
    const axis = unit(normal);
    if (norm(radial) === 0) return Promise.reject(new Error("start must differ from center"));
    if (Math.abs(dot(radial, axis)) > 1e-6 * norm(radial)) {
      return Promise.reject(
        new Error("start must lie in the plane through center perpendicular to normal"),
      );
    }
    const turn = angleDeg < 0 ? scaled(axis, -1) : axis;
    const end = add(centerMm, rotated(radial, turn, (Math.abs(angleDeg) * Math.PI) / 180));
    return this.arc(centerMm, startMm, end, turn, name);
  }

  /** Arc from `startMm` counter-clockwise about `normal` to `endMm`. */
  private arc(
    centerMm: Vec3,
    startMm: Vec3,
    endMm: Vec3,
    normal: Vec3,
    name?: string,
  ): Promise<MutationResult> {
    const setup = `
        factory.isKnife = false;
        factory.center.fromArray(args.center);
        factory.orientation.copy(
          new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...args.normal).normalize()),
        );
        factory.p2.fromArray(args.start);
        factory.p3.fromArray(args.end);
        factory.lastSense = true;`;
    return this.mutate(
      commandFunction("CenterPointArcCommand", ["Vector3", "Quaternion"], setup),
      ["KnifeCenterPointArcFactory", "Vector3", "Quaternion"],
      [
        {
          center: toMeters(centerMm),
          start: toMeters(startMm),
          end: toMeters(endMm),
          normal,
          name: name ?? null,
        },
      ],
    );
  }

  /**
   * Ellipse in the plane perpendicular to `normal`. `majorDirection` (projected into that
   * plane) is the direction of the major axis; by default the X axis, or Y if the normal is X.
   */
  createEllipse(
    centerMm: Vec3,
    majorRadiusMm: number,
    minorRadiusMm: number,
    normal: Vec3 = [0, 0, 1],
    majorDirection?: Vec3,
    name?: string,
  ): Promise<MutationResult> {
    const axis = unit(normal);
    const inPlane = (v: Vec3): Vec3 => sub(v, scaled(axis, dot(v, axis)));
    let major = inPlane(majorDirection ?? [1, 0, 0]);
    if (norm(major) < 1e-9) {
      if (majorDirection) {
        return Promise.reject(new Error("majorDirection must not be parallel to normal"));
      }
      major = inPlane([0, 1, 0]);
    }
    major = unit(major);
    const minor = cross(axis, major);
    const setup = `
        factory.isKnife = false;
        factory.center.fromArray(args.center);
        factory.orientation.copy(
          new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...args.normal).normalize()),
        );
        factory.point1.fromArray(args.majorPoint);
        factory.point2.fromArray(args.minorPoint);`;
    return this.mutate(
      commandFunction("EllipseCommand", ["Vector3", "Quaternion"], setup),
      ["KnifeEllipseFactory", "Vector3", "Quaternion"],
      [
        {
          center: toMeters(centerMm),
          majorPoint: toMeters(add(centerMm, scaled(major, majorRadiusMm))),
          minorPoint: toMeters(add(centerMm, scaled(minor, minorRadiusMm))),
          normal: axis,
          name: name ?? null,
        },
      ],
    );
  }

  /**
   * Join curves that touch end to end into one curve. The result keeps the id of the first
   * curve (reported in `changed`); the others are removed.
   */
  joinCurves(ids: number[]): Promise<MutationResult> {
    if (ids.length < 2) return Promise.reject(new Error("Joining needs at least two curves"));
    if (new Set(ids).size !== ids.length) {
      return Promise.reject(new Error("Curves to join must be distinct"));
    }
    const setup = `
        factory.curves = args.ids.map((id) => {
          const view = find(id);
          if (view.constructor.name !== 'Wire') {
            throw new Error('Body ' + id + ' is a ' + view.constructor.name + ', not a curve');
          }
          return view;
        });`;
    return withHint(
      this.mutate(commandFunction("JoinCurvesCommand", [], setup), ["JoinCurvesFactory"], [{ ids }]),
      "Operation has no effect",
      "Nothing was joined: the curves must touch end to end.",
    );
  }
}
