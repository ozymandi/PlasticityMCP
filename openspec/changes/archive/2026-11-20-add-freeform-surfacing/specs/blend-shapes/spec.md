# Spec Delta

## Purpose

Choose the cross-section of fillets, chamfers and bridge blends, so edges and transitions can be round, conic or curvature-continuous as the object needs.

## ADDED Requirements

### Requirement: Fillet shape
`fillet` SHALL accept `shape` with the values `round` (default, today's result), `conic` with `rho` between 0 and 1, and `g2`.

#### Scenario: Curvature-continuous edge
- **WHEN** an edge of a box is filleted with `shape: "g2"`
- **THEN** both seams of the new face measure G2

#### Scenario: Conic edge
- **WHEN** an edge is filleted with `shape: "conic"` and `rho: 0.3`
- **THEN** the fillet face is a spline surface meeting its neighbours G1

### Requirement: Two-distance chamfer
`chamfer` SHALL accept `distance2` for an asymmetric chamfer; without it the chamfer is symmetric as today.

#### Scenario: Asymmetric chamfer
- **WHEN** an edge of a box is chamfered with distance 2 and `distance2` 5
- **THEN** the bevel cuts 2 mm into one face and 5 mm into the other

### Requirement: Bridge surface shape and trimming
`bridge_surface` SHALL accept `shape: "conic"` in addition to `g2` and `chamfer`. It SHALL also accept `trimWalls` (default true) and `trimBlend` (`none`, `short`, `long`, `both`; default `both`).

#### Scenario: Separate blend sheet
- **WHEN** a floor and a wall are bridged with `trimWalls: false`
- **THEN** the blend is a new Sheet and the floor and the wall are unchanged

#### Scenario: Conic bridge
- **WHEN** they are bridged with `shape: "conic"`
- **THEN** the blend face is cylindrical
