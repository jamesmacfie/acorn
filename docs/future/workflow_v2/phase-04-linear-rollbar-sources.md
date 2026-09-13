# Slice 04: Linear and Rollbar source adapters

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./data-contract.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 02. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

The generic source API selects exact Linear states and newly created Rollbar error groups.

## Work

1. Add Linear issue descriptions and connection/project-dependent options with actual state IDs and labels; retain categories only as additional metadata.
2. Implement project/state/date queries with pagination and explicit failure/completeness handling. Do not collapse distinct states with the same category.
3. Add Rollbar error-group source identity, first/last occurrence fields, declared filters, and detail reads through the existing provider resource layer.
4. Keep occurrence details distinct from independently queryable records. The initial example selects groups by first occurrence.
5. Share only generic helpers; keep each provider's translation and response normalization in its own plugin.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test two Linear states in the same category, project changes invalidating a state, account scope, empty vs failed results, and pagination. Test an old Rollbar group with new activity is excluded by first-seen filtering, plus details failures and size limits.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Verify provider API capabilities and existing safe detail projections. Implement Linear and Rollbar as separate bounded edits within this slice; do not introduce provider-specific UI.
