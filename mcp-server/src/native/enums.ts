/**
 * Native enum codes of Plasticity 26.1.3, keyed by the names the tools expose. Read from the
 * running app (module bindings such as `ContinuityType`, `FillHoleTopologyType`); see
 * docs/surfacing-spike.md. They are build-specific: the server refuses other versions.
 */

/** Geometric continuity of a patch against its neighbouring faces (`ContinuityType`). */
export const CONTINUITY_CODES = { G0: 23156, G1: 23153, G2: 23154 } as const;
export type Continuity = keyof typeof CONTINUITY_CODES;

/** How a filled hole is split into faces (`FillHoleTopologyType`). */
export const FILL_TOPOLOGY_CODES = { multiple: 22740, minimal: 22741, single: 22742 } as const;
export type FillTopology = keyof typeof FILL_TOPOLOGY_CODES;

/** Smoothness inside a filled hole (`FillHoleInternalSmoothnessType`). */
export const FILL_SMOOTHNESS_CODES = { sharp: 24910, smooth: 24911 } as const;
export type FillSmoothness = keyof typeof FILL_SMOOTHNESS_CODES;

/** Preference for planar fills (`FillHolePreferenceType`). */
export const FILL_PREFERENCE_CODES = {
  smooth: 22370,
  preferPlane: 22371,
  planeOnly: 22372,
  nonSmooth: 22373,
} as const;
export type FillPreference = keyof typeof FILL_PREFERENCE_CODES;

/** End condition of a loft between edges (`LoftCurvatureType`). */
export const LOFT_TANGENCY_CODES = { natural: 21530, free: 21531, clamped: 21532 } as const;
export type LoftTangency = keyof typeof LOFT_TANGENCY_CODES;

/** Cross-section of fillets and blends (`BlendShape`). */
export const BLEND_SHAPE_CODES = { round: 22201, conic: 22201, g2: 22202, chamfer: 22203 } as const;
export type BlendShapeName = keyof typeof BLEND_SHAPE_CODES;

/** Trimming of a bridge-surface blend (`BlendTrim`). */
export const BLEND_TRIM_CODES = { none: 17401, short: 17420, long: 17421, both: 17402 } as const;
export type BlendTrim = keyof typeof BLEND_TRIM_CODES;

/** Orientation of a swept section (`SweepAlignmentType`); Transport fails in the kernel. */
export const SWEEP_ALIGNMENT_CODES = { normal: 21560, parallel: 21561 } as const;
export type SweepAlignment = keyof typeof SWEEP_ALIGNMENT_CODES;

/** How rails steer a swept section (`SweepGuideMethod`). Not exposed: on 26.1.3 the three
 * values gave identical bodies, even on a rail twisting around the path. */
export const SWEEP_GUIDE_METHOD_CODES = { point: 23250, chord: 23251, curve: 23252 } as const;
export type SweepGuideMethod = keyof typeof SWEEP_GUIDE_METHOD_CODES;

/** Corners of a polyline sweep path (`SweepCornerType`). */
export const SWEEP_CORNER_CODES = { mitre: 25700, round: 25701 } as const;
export type SweepCorners = keyof typeof SWEEP_CORNER_CODES;

/** Draft method (`TaperMethod`). */
export const TAPER_METHOD_CODES = { isocline: 21847, normal: 21849, offset: 21848 } as const;
export type TaperMethod = keyof typeof TAPER_METHOD_CODES;
