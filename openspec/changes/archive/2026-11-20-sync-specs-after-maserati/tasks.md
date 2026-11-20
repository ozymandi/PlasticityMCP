# Tasks

The behaviour these specs describe is already on `main` (PRs #6–#11). The tasks check each delta against the code and the existing tests, and add smoke checks for the three scenarios that so far were verified only by hand.

## 1. Edge loft and sweep

- [x] 1.1 Check the `edge-loft` delta against `loftEdges` and the `surfacing` smoke group (four-edge rim to a circle edge, clamped + join, curved guide between curves, 22000 hint); verify with `SMOKE_ONLY=surfacing npm run smoke:native` passing those checks
- [x] 1.2 Add a `surfacing` smoke check that a curve given both as an end and in `guideIds` is refused before anything is built (body count unchanged); verify the group passes
- [x] 1.3 Check the `rail-sweeping` delta (new requirement "Sweep wall fallback") against `sweepWithThickness` and its smoke check (`thickenedAfterSweep: true`, valid Solid); verify the same smoke run passes it. The closed-section refusal has no smoke case (no closed sweep is known whose native wall fails): confirm it by reading the code path and note that it stays untested

## 2. Modelling guidance

- [x] 2.1 Check the `modelling-guidance` delta against the `pitfalls` topic in `tools/guide.ts`; verify with `npm test` (catalog: topic listed, own text over 300 characters, only real tool names)

## 3. Display, visibility and documents

- [x] 3.1 Check the `viewport-display` and `scene-visibility` deltas against `setXray`, `native_status`, `screenshot`, `setVisibility` and `unhideAll` and the `display` smoke group; verify with `SMOKE_ONLY=display npm run smoke:native`
- [x] 3.2 Add a smoke check for the X-ray state in documents, as its own `document` group run after all others (it replaces the test document, and only the last group can still hand the baseline back; it skips itself unless the baseline is the startup document, one cube with id 1, and the temp path is ASCII): save a copy with X-ray on to an ASCII temp path, turn X-ray off, `open_document` the copy and expect X-ray on, then `new_document` and expect X-ray on; the run must end in an Untitled document with only the default cube, as the baseline check requires; verify the group passes
- [x] 3.3 Let the same check cover the `document-files` ASCII scenario (the copy opens in place of the current document); verify the opened document's title and body count

## 4. Integration

- [x] 4.1 Run the full `npm run smoke:native`, `npm test` and `openspec validate sync-specs-after-maserati --strict`; all pass

## Workflow follow-up

- Archive the change with `/opsx:archive` so the deltas land in `openspec/specs/`.
- Commit the change and the archived specs through a PR, as the other changes.
