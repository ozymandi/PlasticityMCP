# edge-loft Specification

## Purpose

Build a surface between edges of existing bodies (and curves) that continues the adjacent faces tangentially, to join tubes, panels and branches smoothly.

## Requirements

### Requirement: Loft between body edges
The server SHALL provide a `loft_edges` tool that builds a Sheet through two or more ends, each a boundary edge of a Sheet (`{ id, edgeId }`) or a curve id, in the given order.

#### Scenario: Two open tubes
- **WHEN** `loft_edges` is called with the open top edge of one tube and the open bottom edge of a parallel, offset tube
- **THEN** a new Sheet spans the two edges and the source bodies are unchanged

### Requirement: End tangency
`loft_edges` SHALL accept `tangency` for the whole loft with the values `natural`, `free` (default) and `clamped`, where `clamped` continues the face adjacent to each edge. It SHALL also accept `startMagnitude` and `endMagnitude` (positive, default 1) that scale the tangent at each end. The kernel takes one tangency for all ends.

#### Scenario: Clamped elbow
- **WHEN** two tubes at 90° are lofted with `tangency: "clamped"` and both magnitudes 0.6 and the result is joined to both tubes
- **THEN** the joined body is valid and the two seams measure G1 or better

#### Scenario: Tangent too long
- **WHEN** the same elbow is lofted with both magnitudes 1.5
- **THEN** the call fails with a message suggesting a lower `magnitude`

### Requirement: Join to the sources
`loft_edges` SHALL accept `join: true`, which joins the new Sheet to the Sheets whose edges were used. The result keeps the first source's id, or reports why the join failed while keeping the loft.

#### Scenario: Joined elbow
- **WHEN** the clamped elbow is built with `join: true`
- **THEN** one body remains, containing both tubes and the loft
