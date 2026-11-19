# Spec Delta

## Purpose

Shape swept and revolved bodies with rails and sweep options, so a section can change its size and shape along a path in a controlled way.

## ADDED Requirements

### Requirement: Sweep rails
`sweep_profile` SHALL accept `guideIds`, one to three rail curves that start on the profile; the section SHALL follow the rails along the path.

#### Scenario: One rail
- **WHEN** a circle is swept along a straight path with one rail that bows outward on one side
- **THEN** the body widens toward the rail on that side only

#### Scenario: Two opposite rails
- **WHEN** two rails bow out symmetrically on opposite sides
- **THEN** the section scales uniformly between them

### Requirement: Sweep options
`sweep_profile` SHALL accept `alignment` (`normal`, `parallel`), `guideMethod` (`point`, `chord`, `curve`), `corners` (`mitre`, `round`) and `thickness` (millimetres, a wall instead of a full section), each defaulting to today's behaviour.

#### Scenario: Rounded corners on a polyline path
- **WHEN** a profile is swept along a polyline path with `corners: "round"`
- **THEN** the body turns each corner with a rounded transition instead of a mitre

#### Scenario: Wall thickness
- **WHEN** a closed profile is swept with `thickness: 2`
- **THEN** the result is a tube with a 2 mm wall

### Requirement: Revolve rails and thickness
`revolve_profile` SHALL accept `guideIds` and `thickness` with the same meaning as for `sweep_profile`.

#### Scenario: Revolved shell
- **WHEN** an open profile is revolved with `thickness: 1.5`
- **THEN** the result is a Solid shell 1.5 mm thick
