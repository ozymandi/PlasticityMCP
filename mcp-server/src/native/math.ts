/** Unit conversion and small vector helpers (millimetres outside, metres inside Plasticity). */

import { Vec3 } from "./types.js";

export const MM = 0.001;

export const toMeters = (v: Vec3): Vec3 => [v[0] * MM, v[1] * MM, v[2] * MM];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const scaled = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export const unit = (a: Vec3): Vec3 => scaled(a, 1 / norm(a));

/** Rotate `v` by `radians` about the unit vector `axis` (right-hand rule). */
export const rotated = (v: Vec3, axis: Vec3, radians: number): Vec3 =>
  add(
    add(scaled(v, Math.cos(radians)), scaled(cross(axis, v), Math.sin(radians))),
    scaled(axis, dot(axis, v) * (1 - Math.cos(radians))),
  );

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
