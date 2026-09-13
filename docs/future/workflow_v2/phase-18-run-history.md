# Slice 18: Record-first history and collapsed task navigation

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ux-running.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 08, 09, 13, 16. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A 500-record run remains navigable, with failed/skipped/gated rows and nested tasks accessible from the root.

## Work

1. Add paged run-record and attempt-history routes/projections, including query completeness/provenance and bounded named outputs.
2. Render progress and record table with stable selection, filters, and expandable detail rather than a card per descendant.
3. Add retry/reprocess distinctions and root/parent/record return navigation.
4. Collapse workflow children under their root in ordinary task navigation with aggregated attention; reveal only the ancestor path when a child is opened.
5. Retain ordinary individual archive actions and handle archived/missing task links without losing run history.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test zero matches vs all skipped, completed-with-failures, gated child with active siblings, explicit retry retaining identities, cancelled unstarted work, disconnected stale state, 500-row rendering, focus restoration, and manual task ordering.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read current task hierarchy and run projection/event code. Preserve unrelated task drag ordering and lifecycle changes; do not add automatic or group archive behavior.
