# Slice 03: GitHub pull-request source

Date: 2026-09-13. Status: implemented.

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

Implemented `github/pull-requests` with an explicit connection/repository, typed state/author/draft/
timestamps/merge fields, repository options, exact predicates, stable ordering, and bounded search
pagination. The [GitHub reference](../../github-integration.md#typed-pull-request-source) owns shipped
behavior and links the provider documentation checked on September 13, 2026. Details and incremental
reads are not advertised. Legacy dashboard readers remain for their migration phase.

Verification on September 13, 2026:

- `rtk pnpm --filter @acorn/plugin-github test`: 33 files, 166 tests passed before the final take regression was added.
- `rtk pnpm --filter @acorn/plugin-github test src/server/data/pullSourceHandler.test.ts`: 16 tests passed, including paged take, search ceilings, actual state versus readiness, exact time boundaries, qualifier rejection, provider errors, duplicate IDs/cursors, and expired/foreign continuations.
- `rtk pnpm --filter @acorn/node test test/integration/githubDataSource.test.ts`: passed. Exercises the registered source through the host runtime with real connection storage, host provenance, exact bounded take across pages, and preview continuation.
- `rtk pnpm lint`: passed across 33 tasks after the final integration and runtime changes. Existing oxlint warnings and sandbox cache-write warnings remain non-failing.
- `rtk pnpm --filter @acorn/arch-tests test`: 4 files, 63 tests passed after the final integration test export.
- `rtk pnpm --filter @acorn/node-core test src/server/dataSources`: 3 files, 20 tests passed after the preview-count correction.

The integration test exposed a shared-runtime check that compared one preview page with the whole
authored `take`. Full execution still validates the exact total; preview continuation keeps its
preview mode and can end with the provider's bounded marker.

No UI changes in this slice. Connected-account UI journeys remain part of release acceptance.

## Verify before building

Re-read GitHub collection routes, token/resource helpers, and search APIs. Verify live API support before advertising a filter or reliable incremental capability.
