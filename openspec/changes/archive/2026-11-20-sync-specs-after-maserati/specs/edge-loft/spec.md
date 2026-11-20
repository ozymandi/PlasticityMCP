# Spec Delta

## MODIFIED Requirements

### Requirement: Loft between body edges
The server SHALL provide a `loft_edges` tool that builds a Sheet through two or more ends, each a boundary edge of a Sheet (`{ id, edgeId }`) or a curve id, in the given order. An opening bounded by several connected edges SHALL be one end when all its edges are listed: connected edges are chained into one end whatever their order in the list.

#### Scenario: Two open tubes
- **WHEN** `loft_edges` is called with the open top edge of one tube and the open bottom edge of a parallel, offset tube
- **THEN** a new Sheet spans the two edges and the source bodies are unchanged

#### Scenario: Four-edge rim to a circle edge
- **WHEN** the four rim edges of an open box, listed out of order, and the open circle edge of a cylinder above it are lofted
- **THEN** one four-faced Sheet spans from the rim to the circle

#### Scenario: Four-edge rim clamped and joined
- **WHEN** the same ends are lofted with `tangency: "clamped"` and `join: true`
- **THEN** one valid Solid remains, made of the box, the loft and the cylinder

## ADDED Requirements

### Requirement: Loft guides
`loft_edges` SHALL accept `guideIds`, curves the surface follows from end to end; a guide must be a different curve than the ends. A curved guide works between curve ends. With Sheet edges as ends the kernel rejects a curved guide (22000), and the error SHALL tell the caller to make the ends curves with `curves_from_edges` first.

#### Scenario: Curved guide between curve ends
- **WHEN** two closed square curves are lofted with a spline guide bowed outward between them
- **THEN** the Sheet follows the guide and reaches beyond the squares on the guide's side

#### Scenario: Curved guide between Sheet edges
- **WHEN** a four-edge rim and a circle edge are lofted with a curved guide
- **THEN** the call fails and the message names `curves_from_edges`

#### Scenario: Guide that is also an end
- **WHEN** a curve is passed both as an end and in `guideIds`
- **THEN** the call is refused before anything is built
