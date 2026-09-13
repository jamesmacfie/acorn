# Slice 12: Shared source/query editor and field picker

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./ux-authoring.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 03, 04, 05. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A user builds and previews a query and selects a nested field with the same controls used by both features.

## Work

1. Implement host-kit source selection, visible connection scope, dependent parameters, searchable options, all/any groups, and typed operands.
2. Add explicit Refresh preview, prior-result retention, query-digest staleness, and nested record inspection.
3. Implement the shared typed binding picker with origins, compatibility ordering, observed/optional labels, explicit conversions, and fallbacks.
4. Add saved-query selection and explicit shared-edit/local-customization choices.
5. Cover cold/empty/loading/error/incomplete/schema-change states, keyboard focus restoration, and narrow/terminal region behavior.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Component tests cover stale response races, project/state invalidation, no automatic record fetch on typing, missing examples, incompatible fields, and safe rendering. Demonstrate an unfamiliar installed source in the real Tauri window and terminal.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read the closed kit support table and existing picker/field components. Expand a shared kit component only when required for both consumers; do not build provider-owned form components.
