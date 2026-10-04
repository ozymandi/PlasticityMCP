/** Curves: polyline, spline, circle, arcs, ellipse, join. */

import { withHint } from "./core.js";
import { MM, add, cross, dot, norm, rotated, scaled, sub, toMeters, unit } from "./math.js";
import { PrimitiveTools } from "./primitives.js";
import { commandFunction } from "./snippets.js";
import { MutationResult, Vec3 } from "./types.js";

export class CurveTools extends PrimitiveTools {
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
