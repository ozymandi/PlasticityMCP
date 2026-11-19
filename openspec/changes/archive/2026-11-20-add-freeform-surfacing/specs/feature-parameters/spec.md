# Spec Delta

## Purpose

Expose the remaining native parameters of everyday features (extrude, pipe, deform) that the server left at their defaults and that change the result on 26.1.3.

## ADDED Requirements

### Requirement: Extrude both ways and as a wall
`extrude_profile` SHALL accept `distanceBack` (millimetres, extruding the other way too) and `thickness` (millimetres, a wall of that thickness around the profile instead of a filled section); without them the result is unchanged.

#### Scenario: Both directions
- **WHEN** a circle is extruded with distance 20 and `distanceBack: 8`
- **THEN** the body spans 28 mm across the profile plane

#### Scenario: Thin wall
- **WHEN** a circle of radius 10 is extruded with `thickness: 2`
- **THEN** the body is a tube whose outer radius is 12 mm

### Requirement: Pipe section and twist
`pipe` SHALL accept `sides` (a regular polygon section instead of a circle) and `twist` (degrees along the path).

#### Scenario: Hexagonal bar
- **WHEN** a curve is piped with `sides: 6`
- **THEN** the bar has six side faces and two end faces

### Requirement: Deform options
`deform` SHALL accept `scaleU`, `scaleV`, `scaleNormal`, `offsetU`, `offsetV`, `offsetNormal` (millimetres), `flipUV`, `flipNormal` and `mirror`.

#### Scenario: Lifted decal
- **WHEN** a body is deformed from a flat face onto a cylinder wall with `offsetNormal: 3`
- **THEN** it lands 3 mm farther from the wall than without the option

### Requirement: Parameters left out
The server SHALL NOT expose native parameters that changed nothing or failed in the kernel on 26.1.3 (extrude draft angle, draft method, hollow `local`, face rebuild degrees and spans, which need the Studio-only explicit control). It SHALL list them in the coverage document with the reason.

#### Scenario: Coverage names the gaps
- **WHEN** the coverage document is read
- **THEN** it names each left-out parameter and why
