# Slice 05: Workspace query drafts and published revisions

Date: 2026-09-13. Status: not started.

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

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read preference/storage ownership and workflow revision precedents. The query library is core-owned; it must not depend on the workflows plugin implementation.
