# Slice 03: GitHub pull-request source

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./data-contract.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 02. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

The generic query route finds open PRs by an arbitrary author in an explicitly selected connection/repository.

## Work

1. Describe actual PR state, author, draft, timestamps, URL, and merge-readiness properties separately.
2. Implement repository scope/options and declared author/state/date/sort capabilities using verified provider APIs.
3. Follow pagination and upstream result caps honestly; report incomplete selection instead of accepting a one-page search as all matches.
4. Use stable record identity independent of titles and display statuses. Add detail reads only for the declared detail capability.
5. Keep provider calls in the existing credential/resource boundary and retain content-link actions.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Provider fixtures include open/closed PRs, drafts, failing checks, several pages, an upstream search ceiling, rate limits, and invalid qualifiers. Verify actual state filtering does not depend on the derived dashboard readiness status.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Re-read GitHub collection routes, token/resource helpers, and search APIs. Verify live API support before advertising a filter or reliable incremental capability.
