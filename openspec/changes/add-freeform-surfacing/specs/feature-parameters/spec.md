# Spec Delta

## Purpose

Expose the remaining native parameters of everyday features (extrude, pipe, draft, hollow, rebuild, deform) that the server left at their defaults.

## ADDED Requirements

### Requirement: Extrude draft and two sides
`extrude_profile` SHALL accept `draftAngle` (degrees) and `distanceBack` (millimetres, extruding the other way too); without them the result is unchanged.

#### Scenario: Drafted boss
- **WHEN** a circle is extruded 20 mm with `draftAngle: 5`
- **THEN** the top of the boss is smaller than its base

#### Scenario: Both directions
- **WHEN** a profile is extruded with distance 10 and `distanceBack: 4`
- **THEN** the body spans 14 mm across the profile plane

### Requirement: Pipe section and twist
`pipe` SHALL accept `sides` (a polygon section instead of a circle) and `twist` (degrees along the path).

#### Scenario: Hexagonal bar
- **WHEN** a curve is piped with `sides: 6`
- **THEN** the bar has six flat side faces

### Requirement: Draft method and hollow locality
`draft_faces` SHALL accept `method` (`isocline`, `normal`, `offset`), and `hollow` SHALL accept `local: true` to shell only around the chosen faces.

#### Scenario: Default draft unchanged
- **WHEN** `draft_faces` is called without `method`
- **THEN** the result is the same as before this change

### Requirement: Rebuild controls
`rebuild` SHALL accept, for curves, `degree`, `pointCount` and `spans`, and for faces `uDegree`, `vDegree`, `uSpans`, `vSpans`; without them it behaves as today.

#### Scenario: Lighter curve
- **WHEN** a spline is rebuilt with `pointCount: 6` and `degree: 3`
- **THEN** the curve has six control points

### Requirement: Deform options
`deform` SHALL accept `scaleU`, `scaleV`, `scaleNormal`, `offsetU`, `offsetV`, `offsetNormal`, `flipUV`, `flipNormal` and `mirror`.

#### Scenario: Lifted decal
- **WHEN** a flat decal is deformed onto a cylinder with `offsetNormal: 0.3`
- **THEN** the decal stands 0.3 mm off the wall
