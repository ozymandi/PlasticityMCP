# Proposal

## Why

After the `add-freeform-surfacing` change was archived, five more pull requests (#6, #7, #8, #10, #11) changed what the server does, found while modelling the Maserati 300S and probing its gaps. None of them went through OpenSpec, so `openspec/specs/` no longer describes the server: `edge-loft` still implies one edge per end, and display, visibility and document-path behaviour has no spec at all. This change records the behaviour that is already merged and tested; it changes no code.

## What Changes

- `loft_edges`: an end may be several connected edges of one opening, given in any order; new `guideIds` (a curved guide works between curve ends; with Sheet edges the kernel fails and the error points to `curves_from_edges`).
- `sweep_profile` with `thickness`: when Plasticity's own wall fails on an open section, the section is swept as a surface and thickened half to each side, and the result says so.
- `modelling_guide`: a `pitfalls` topic with the field-tested traps.
- New `set_xray` tool and an `xray` field in `native_status`; the X-ray state is part of a saved document, a new document starts in X-ray.
- `screenshot` captures only after the window has drawn new frames.
- `set_visibility` rebuilds and redraws the scene; `unhide_all` shows everything hidden, hidden curves included (Plasticity's own command fails on them).
- `open_document` refuses a path with non-ASCII characters at once (Plasticity hangs on it).

## Capabilities

### New Capabilities
- `viewport-display`: how the viewport draws what the server shows and captures — the X-ray toggle and its state, and screenshots that wait for drawn frames.
- `scene-visibility`: hiding and showing bodies so the window matches the document — redraw after a visibility change and unhide-all that copes with hidden curves.
- `document-files`: opening documents from disk safely — the path rules Plasticity needs.

### Modified Capabilities
- `edge-loft`: "Loft between body edges" takes multi-edge ends; new requirement for loft guides.
- `rail-sweeping`: new requirement for the thickness fallback on open sections ("Sweep options" itself stays as it is).
- `modelling-guidance`: new requirement for the `pitfalls` guide topic.

## Impact

- Specs only: `openspec/specs/` gains three capabilities and three updated ones on archive.
- The described code is already on `main` (PRs #6–#11); the scenarios mirror checks of the `surfacing` and `display` smoke groups and the `catalog` unit test.
- No tool, schema or behaviour changes.
