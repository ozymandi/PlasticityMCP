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
