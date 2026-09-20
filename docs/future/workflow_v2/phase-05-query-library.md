# Slice 05: Workspace query drafts and published revisions

Date: 2026-09-14. Status: complete.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./publication.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 02. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A saved query can be recovered, published, parameterized, and referenced from two consumers.

## Work

1. Add core-owned query draft/revision storage and validated CRUD/publish/read routes with workspace scope and optional project restriction.
2. Use immutable published revisions and compare-and-swap draft updates; verify affected-row counts on races.
3. Represent inline queries and saved references with typed parameter bindings. Resolve published content for consumers and retain exact resolved revision for runs.
4. Track consumer references for shared-edit impact and refuse deleting referenced published queries.
5. Add recovery-state/client service contracts without constructing the full editor. Preserve source-unavailable drafts and invalid references for repair.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Use temporary SQLite stores to cover concurrent saves, revision immutability, unpublished query refusal, deleted/unavailable dependencies, parameter type errors, and two consumers resolving the same published query.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Implemented core query drafts, immutable revisions, scoped routes, typed inline and saved references,
consumer tracking, metadata publication validation, and client recovery services. The shipped contract
is [workspace query library](../../data-sources.md#workspace-query-library).

Checks run on September 14, 2026:

- `rtk pnpm lint`: passed all 33 package tasks. Pre-existing lint warnings and cache-write permission
  warnings remain; no type errors.
- `rtk pnpm --filter @acorn/node-core test src/server/queries/runtime.test.ts`: eight tests passed.
  Real temporary SQLite connections cover stale saves, a save during publication metadata I/O,
  immutable revisions, two consumers, deletion refusal, retained history, unavailable sources,
  removed dynamic choices, typed arguments, and workspace/project authorization.
- `rtk pnpm --filter @acorn/protocol test src/dataQueryResolution.test.ts`: three tests passed.
- `rtk pnpm --filter @acorn/client-core test src/features/queries/recoveryStore.test.ts`: three tests
  passed, including reopening across a changed base revision and a late acknowledgment after edits.
- `rtk pnpm db:check`: all 11 migration chains passed. After merging main's integration-name
  migration, the workflow tables are consolidated in core migration 0007.
- `rtk pnpm --filter @acorn/arch-tests test`: 63 tests passed. The first run found the route's
  `parse` spelling; the route uses `safeParse` and the rerun passed.
- `rtk proxy env UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test src/surface.test.ts`: one test
  passed and the additive public API snapshot was updated.
- `rtk pnpm --filter acorn-plugin-types test src/contract.test.ts`: three tests passed.

No renderer UI changed. Editor autosave integration and visible conflict review belong to phase 12.
Consumer publication returns impact links; workflow publication coordination and schedule review
notifications remain owned by their planned phases. No branch or commit was created.

## Verify before building

Read preference/storage ownership and workflow revision precedents. The query library is core-owned; it must not depend on the workflows plugin implementation.
