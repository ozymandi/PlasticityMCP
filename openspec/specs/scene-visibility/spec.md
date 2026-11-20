# scene-visibility Specification

## Purpose

Hiding and showing bodies so that the window always matches the document: what is hidden is not drawn, and showing everything works whatever kind of body is hidden.

## Requirements

### Requirement: Visibility redraws the window
`set_visibility` SHALL hide or show the given bodies as one undo step and then rebuild and redraw the window's scene, so a hidden body is no longer drawn and a body changed while hidden appears as it is now when shown.

#### Scenario: Hide and show
- **WHEN** a box is hidden with `set_visibility` and then shown again
- **THEN** the box is absent from the window's drawn scene while hidden and present again once shown

### Requirement: Unhide all
`unhide_all` SHALL show everything that is hidden — bodies of every kind, curves included, and groups — as one undo step, clearing the hidden flag the way Plasticity's Unhide All does and leaving the outliner's visibility toggle as it is. It SHALL work when curves are hidden, where Plasticity's own command fails with an empty error and shows nothing.

#### Scenario: Hidden bodies
- **WHEN** two bodies are hidden and `unhide_all` is called
- **THEN** both are visible

#### Scenario: Hidden curve
- **WHEN** a curve and a Solid are hidden and `unhide_all` is called
- **THEN** the call succeeds and both are visible
