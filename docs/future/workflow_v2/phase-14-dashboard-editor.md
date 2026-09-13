# Slice 14: Dashboard publication and persistent preview editor

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ux-authoring.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 05, 12. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A panel is composed and published using the same source/query controls as a workflow.

## Work

1. Add core-owned dashboard draft/publication services while retaining panel/placement/layout separation.
2. Replace wizard/modal-only composition with Data/Display sections and a persistent preview.
3. Adapt pure display projections to nested source fields and exact status IDs; retain explicit cross-source mappings and source badges.
4. Make presentation changes redraw locally while query changes require refresh. Preserve incompatible mappings for repair.
5. Integrate shared-query impact, local customization, draft recovery, publication, and placement selection. Keep rollout gated until every old source is migrated.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test display changes do not change query semantics, two query instances of the same source have independent mappings, state-category suggestions do not collapse identities, unavailable views explain prerequisites, and publishing updates placements correctly.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read dashboard definition/placement storage, mapping, aggregation, and sampler consumers. Presentation-specific filtering must not masquerade as complete upstream query execution.
