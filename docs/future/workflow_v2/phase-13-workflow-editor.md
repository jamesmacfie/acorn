# Slice 13: Outline-led workflow authoring

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ux-authoring.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 07, 10, 11, 12. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A user manually authors and publishes the full Linear triage/conditional-analysis flow without writing pointers or schema JSON.

## Work

1. Replace Nodes/Graph/JSON as the main mental model with the outline, selected-step configuration, and contextual preview; retain secondary graph/code views.
2. Add readable step summaries, branch labels, dependency chips, and guided Find records → For each setup.
3. Create child workflows in context with prefilled typed record inputs and return navigation that preserves the parent.
4. Add a structured-output field editor, autosave/publication states, dependency review, file conflict flow, and one undo stack for draft edits.
5. Integrate published-only run entry and visibly explain unmet setup. Keep advanced limits/title/key controls collapsed until needed.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Verify all three manual examples, adding/removing/reordering steps, referenced-step deletion, draft recovery, child-target changes, publish blockers linking to controls, file editing, keyboard operation, and narrow/terminal layouts.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read the existing editor/draft/graph code and authoring UX. Do not introduce a second graph representation or expose hundreds of runtime children in the authoring outline.
