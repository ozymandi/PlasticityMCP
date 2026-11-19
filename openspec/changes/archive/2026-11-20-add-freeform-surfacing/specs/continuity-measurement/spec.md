# Spec Delta

## Purpose

Report how smoothly faces meet and how large free-form bodies are, truthfully, so seam checks and size checks can be relied on.

## ADDED Requirements

### Requirement: Seam measurement on split edges
`measure_continuity` SHALL compare the two faces at the same points along an edge, so an edge that is one piece of a split circle or closed curve reports its real gap and angle.

#### Scenario: Joined tube elbow
- **WHEN** the seams of a valid joined body made of two tubes and a clamped loft are measured
- **THEN** no seam is reported as "none" with a gap larger than the modelling tolerance

### Requirement: Approximate bounds flagged
Mutation results and body listings SHALL mark `boundsMm` as approximate when the body has spline faces, because those bounds come from control polygons.

#### Scenario: G2 fillet on a box
- **WHEN** the top loop of a 40 × 40 × 30 box is filleted with `shape: "g2"`
- **THEN** the result marks its bounds as approximate even though they extend past the box
