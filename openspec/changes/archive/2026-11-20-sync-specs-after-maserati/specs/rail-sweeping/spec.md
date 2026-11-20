# Spec Delta

## ADDED Requirements

### Requirement: Sweep wall fallback
When Plasticity's own sweep wall (`thickness`) fails in the kernel (`hollow`) on an open section, `sweep_profile` SHALL sweep the section as a surface and thicken it half the wall to each side, and the result SHALL report `thickenedAfterSweep: true`. A closed section that fails SHALL be refused with a hint to sweep it without thickness and use hollow.

#### Scenario: Wall after a failed native thickness
- **WHEN** an open arc is swept along a rail-guided path with `thickness: 3` and Plasticity's own wall fails
- **THEN** the result is a valid Solid wall and reports `thickenedAfterSweep: true`
