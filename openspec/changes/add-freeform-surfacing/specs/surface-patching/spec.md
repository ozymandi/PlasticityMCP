# Spec Delta

## Purpose

Fill openings in curves, regions, Sheets and Solids with patch surfaces whose smoothness against the neighbouring faces is chosen by the caller.

## ADDED Requirements

### Requirement: Patch continuity
The `patch` tool SHALL accept `continuity` with the values `G0`, `G1` and `G2` and apply it to every edge of the filled loop. Without the argument the result SHALL be the same as before this change (G0).

#### Scenario: Tangent cap on a cylinder
- **WHEN** a cylinder whose top face was removed is patched along its top edge with `continuity: "G1"`
- **THEN** the body becomes a valid Solid and `measure_continuity` on the seam reports G1

#### Scenario: Curvature-continuous cap on a box
- **WHEN** an open-top box is patched along its four top edges with `continuity: "G2"`
- **THEN** the body becomes a valid Solid and every seam measures G2

#### Scenario: Default unchanged
- **WHEN** the same open box is patched without `continuity`
- **THEN** the cap is flat at the height of the rim

### Requirement: Patch topology and smoothness
The `patch` tool SHALL accept `topology` (`multiple`, `minimal`, `single`) and `smoothness` (`sharp`, `smooth`), defaulting to `multiple` and `sharp`.

#### Scenario: Single patch on a smooth boundary
- **WHEN** a circular hole is patched with `continuity: "G2"` and `topology: "single"`
- **THEN** the cap is one face

#### Scenario: Single patch on a cornered boundary
- **WHEN** a square hole between vertical walls is patched with `continuity: "G1"` and `topology: "single"`
- **THEN** the call fails with a message saying single and smooth patches need a boundary without corners

### Requirement: Patch fill preference
The `patch` tool SHALL accept `fill` with the values `smooth`, `preferPlane`, `planeOnly` and `nonSmooth`, defaulting to `smooth`, for curve, region and Solid-edge sources.

#### Scenario: Planar fill requested
- **WHEN** a planar closed curve is patched with `fill: "planeOnly"`
- **THEN** the new Sheet is a single planar face

### Requirement: Patch guide curves
The `patch` tool SHALL accept `guideIds` for a hole in a Sheet. Each guide must end at vertices of the boundary loop. A guide that ends elsewhere SHALL fail with a message saying so.

#### Scenario: Corner-to-corner guide
- **WHEN** an open box is patched with `continuity: "G1"` and a guide spline from one top corner to the opposite corner, raised above the rim
- **THEN** the cap follows the guide and the body is a valid Solid

#### Scenario: Guide ending mid-edge
- **WHEN** a guide ends in the middle of a boundary edge
- **THEN** the call fails and the message says that guides must end at boundary vertices
