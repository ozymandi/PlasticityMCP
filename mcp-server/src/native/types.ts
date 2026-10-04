/** Shapes of the data the native tools return. */

import { Drawing } from "../drawing.js";

export type Vec3 = [number, number, number];

export interface BodyInfo {
  id: number;
  type: string;
  name: string | null;
  boundsMm: { min: Vec3; max: Vec3 } | null;
  /** Topology counts; 0 for a Wire. */
  faceCount: number;
  edgeCount: number;
  visible: boolean;
  locked: boolean;
  selected: boolean;
}

export interface NativeState {
  busy: boolean;
  /**
   * True when the window is minimized or completely covered by other windows. Chromium then
   * stops drawing it, so set_view and screenshot cannot work; modelling tools still do.
   */
  windowHidden: boolean;
  undoDepth: number;
  redoDepth: number;
  bodies: BodyInfo[];
  /**
   * Internal version of each body by id. It moves on with every change of the geometry, also
   * with those that leave bounds and counts as they were (a reversed Sheet, a new fillet radius).
   */
  versions: Record<number, string>;
}

export interface FaceInfo {
  id: string;
  /** Native surface class, e.g. "Plane", "Cylinder". */
  surface: string;
  planar: boolean;
  centerMm: Vec3;
  /** Outward normal at the face centre. */
  normal: Vec3;
  radiusMm?: number;
  edgeIds: string[];
}

export interface EdgeInfo {
  id: string;
  kind: "line" | "circle" | "curve";
  lengthMm: number;
  startMm: Vec3;
  midMm: Vec3;
  endMm: Vec3;
  radiusMm?: number;
  faceIds: string[];
}

/** A stretch of a curve between two of its vertices. */
export interface SegmentInfo {
  id: string;
  kind: "line" | "circle" | "curve";
  lengthMm: number;
  startMm: Vec3;
  midMm: Vec3;
  endMm: Vec3;
}

/** A vertex or a control point of a curve. */
export interface CurvePointInfo {
  id: string;
  positionMm: Vec3;
}

export interface BodyTopology {
  id: number;
  type: string;
  faceCount: number;
  edgeCount: number;
  /** Solids and Sheets. */
  faces?: FaceInfo[];
  edges?: EdgeInfo[];
  /** Curves (Wires). */
  closed?: boolean;
  segments?: SegmentInfo[];
  /** Points where segments meet or the curve ends; a full circle has none. */
  vertices?: CurvePointInfo[];
  /** Control points of spline and arc segments. */
  controlPoints?: CurvePointInfo[];
}

export type BooleanOperation = "union" | "difference" | "intersection";

/** A profile for extrude / revolve / sweep: a curve id, or region ids from list_regions. */
export type ProfileRef = number | string[];

export interface RegionInfo {
  id: string;
  /** From the display mesh: accurate to about 0.01 mm. */
  boundsMm: { min: Vec3; max: Vec3 };
  normal?: Vec3;
  /** Edges of the boundary, holes included. */
  edgeCount?: number;
  /** Total length of the boundary, holes included. */
  boundaryLengthMm?: number;
  /** Number of holes: 1 for the ring left around a nested closed curve. */
  holes?: number;
}

/** A rectangle: from a corner or centre with its sizes in a plane, or through three points. */
export type RectangleSpec =
  | {
      originMm: Vec3;
      widthMm: number;
      heightMm: number;
      centered?: boolean;
      normal?: Vec3;
      xDirection?: Vec3;
    }
  | { pointsMm: [Vec3, Vec3, Vec3] };

/** What `project` projects: curves (onto a body, or two of them onto each other), or bodies onto each other. */
export type ProjectionSource =
  | { curveIds: number[]; targetId?: number; direction?: Vec3 }
  | { bodyIds: number[] };

/** One face of a body, by the ids from get_body_topology. */
export interface FaceRef {
  id: number;
  faceId: string;
}

/** Vertices and control points of one curve, by the ids from get_body_topology. */
export interface CurvePoints {
  vertexIds?: string[];
  controlPointIds?: string[];
}

export type Continuity = "G0" | "G1" | "G2" | "G3";

export type SlideDirection = "forward" | "backward" | "normal";

/** How `rebuild` refits a curve. */
export type CurveRebuild =
  | { toleranceMm: number }
  | { pointCount: number }
  | { degree: number; spans: number };

/** One segment of a curve, by the ids from get_body_topology. */
export interface SegmentRef {
  id: number;
  segmentId: string;
}

/** What cuts in `cut`: curves, or faces of another body. */
export type Cutter = { curveIds: number[] } | { id: number; faceIds: string[] };

/** What `patch` closes: closed curves, regions, or holes of a body (all of them, or one by its edges). */
export type PatchSource =
  | { curveIds: number[] }
  | { regionIds: string[] }
  | { id: number; edgeIds?: string[] };

export type FilletConvexity = "any" | "convex" | "concave";

/** What `offset` works on: faces (moved, or with `loops` their outline), or edges. */
export type OffsetTarget = { faceIds: string[]; loops?: boolean } | { edgeIds: string[] };

/** How the corners of an offset outline are closed. */
export type GapFill = "round" | "linear" | "natural";

/** Options of the offsets that draw new edges on the surface (loops and edges). */
export interface OffsetOptions {
  bothSides?: boolean;
  gapFill?: GapFill;
}

export type ExtensionShape = "linear" | "soft" | "reflective" | "natural";

/** How far imprinted edges are continued: as drawn, to the next edges, or around the body. */
export type ImprintCompletion = "none" | "edge" | "boundary";

/** What `imprint` draws on a body: curves (projected along `direction`), or other bodies. */
export type ImprintSource =
  | { curveIds: number[]; direction?: Vec3 }
  | { toolIds: number[]; imprintTools?: boolean };

export interface MutationResult {
  created: BodyInfo[];
  /** Bodies that kept their id but changed (bounds, name, topology, visibility, lock). */
  changed: BodyInfo[];
  removedIds: number[];
  bodyCount: number;
  undoDepth: number;
  redoDepth: number;
}

export type ViewName = "front" | "back" | "left" | "right" | "top" | "bottom" | "isometric";

export interface FileResult {
  path: string;
  bytes: number;
}

/** Length unit a file without units of its own is read in. */
export type ImportUnit = "millimeter" | "centimeter" | "meter" | "inch";

/**
 * An imported mesh. Plasticity keeps it as a reference object, not as a body: it is drawn and
 * can be modelled around, but it has no B-Rep and is invisible to the body tools. Its id lives
 * in a number space of its own.
 */
export interface ReferenceMeshInfo {
  id: number;
  name: string | null;
  sourcePath: string;
  boundsMm: { min: Vec3; max: Vec3 } | null;
  triangles: number;
  visible: boolean;
}

export interface ReferenceMutation {
  created: ReferenceMeshInfo[];
  removedIds: number[];
  referenceCount: number;
  undoDepth: number;
  redoDepth: number;
}

export interface MeshResult extends FileResult {
  format: "stl" | "obj" | "3mf";
  ids: number[];
  /** Triangle count; not available for 3MF (a zip archive). */
  triangles?: number;
}

export interface DrawingResult extends FileResult, Omit<Drawing, "svg"> {
  ids: number[];
}

export interface Screenshot {
  png: Buffer;
  width: number;
  height: number;
}

export interface CameraInfo {
  view: ViewName;
  /** Unit vector from the look-at target towards the camera. */
  direction: Vec3;
  targetMm: Vec3;
  mode: string;
  /** True for the six axis views: Plasticity shows them in X-ray with a view label. */
  aligned: boolean;
}
