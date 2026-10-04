/** Box, sphere, cylinder. */

import { MM, toMeters } from "./math.js";
import { OrganizeTools } from "./organize.js";
import { commandFunction } from "./snippets.js";
import { MutationResult, Vec3 } from "./types.js";

export class PrimitiveTools extends OrganizeTools {
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
}
