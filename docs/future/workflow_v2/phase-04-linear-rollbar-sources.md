# Slice 04: Linear and Rollbar source adapters

Date: 2026-09-13. Status: implemented and verified with controlled provider fixtures.

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

Implemented provider-owned `linear/issues` and `rollbar/error-groups` through portable Node handlers.
The shared selection pager retains bounded selections; it contains no provider query translation.
The owning behavior and upstream reference links are in [typed data sources](../../data-sources.md).

Verification on September 13, 2026:

- `rtk pnpm lint`: passed, 33 package tasks. Existing oxlint warnings and sandbox cache-write warnings remain.
- `rtk pnpm --filter @acorn/plugin-linear --filter @acorn/plugin-rollbar --filter @acorn/plugin-api test`: passed 46 Linear tests, 59 Rollbar tests, and 12 plugin API tests. This final run includes cancellation and the updated additive export snapshot.
- `rtk pnpm --filter @acorn/node-core test src/server/dataSources/selection.test.ts src/server/integrations/providerRoutes.test.ts`: passed five tests. The added memory-ceiling test subsequently passed with the pager suite, three tests.
- `rtk pnpm --filter @acorn/arch-tests test`: passed 63 tests.
- `rtk pnpm --filter @acorn/plugin-api --filter acorn-plugin-types test`: public types passed four tests. The plugin API snapshot required the three additive helper exports; the corrected snapshot passed in the final run above.
- `rtk pnpm --filter @acorn/plugin-github test src/server/data/pullSourceHandler.test.ts`: passed 16 tests.

Fixtures cover same-category states, project-scoped state invalidation, exact connection credentials,
project and issue pagination, date translation, empty versus failed reads, first-seen exclusion,
stable take, candidate caps, foreign or expired continuations, direct task denial, strict refresh
failure with cached data, safe details, and oversize or truncated data. No UI changes belong to this
slice. Connected-account UI journeys remain programme acceptance work; no live credential was used.

## Verify before building

Verify provider API capabilities and existing safe detail projections. Implement Linear and Rollbar as separate bounded edits within this slice; do not introduce provider-specific UI.
