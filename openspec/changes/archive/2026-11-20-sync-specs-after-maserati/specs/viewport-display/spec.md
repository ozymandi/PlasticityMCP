# Spec Delta

## Purpose

How the viewport draws what the server shows and captures: the X-ray toggle, its state, and screenshots that show the model as it is now.

## ADDED Requirements

### Requirement: X-ray toggle
The server SHALL provide `set_xray` with `on: true | false`, which switches the first viewport's X-ray drawing (the window's toggle, Alt+Z) only when it differs and returns the state and whether it changed. It is not an undo step and does not mark the document changed.

#### Scenario: Switch both ways
- **WHEN** `set_xray` is called with `on: false`, then `on: true`, then `on: false`
- **THEN** each call returns the asked state with `changed: true` where the state moved

#### Scenario: Already in that state
- **WHEN** `set_xray` is called with `on: true` while X-ray is on
- **THEN** it returns `xray: true` and `changed: false`

#### Scenario: Drawn differently
- **WHEN** a screenshot is taken shaded and another in X-ray of the same view
- **THEN** the two images differ

### Requirement: X-ray state reported
`native_status` SHALL report `xray`, whether the first viewport draws in X-ray, so a model can see the state before taking screenshots.

#### Scenario: Status follows the toggle
- **WHEN** `set_xray` turns X-ray on
- **THEN** the next `native_status` reports `xray: true`

### Requirement: X-ray state in documents
The X-ray state SHALL be documented as part of a saved document: `open_document` brings back the state the file was saved with, and `new_document` starts in X-ray (Plasticity's startup document).

#### Scenario: Saved state comes back
- **WHEN** a document saved with X-ray on is opened while X-ray is off
- **THEN** X-ray is on after opening

#### Scenario: New document
- **WHEN** `new_document` is called with X-ray off
- **THEN** X-ray is on in the new document

### Requirement: Screenshot of the current state
`screenshot` SHALL capture the viewport only after the window has drawn new frames following the request (up to 2 s), so a capture right after a change shows that change.

#### Scenario: Right after a move
- **WHEN** a body is moved and a screenshot is taken at once
- **THEN** the image differs from the one taken before the move
