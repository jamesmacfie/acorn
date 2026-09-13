# Slice 10: Workflow draft recovery and dependency publication

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./publication.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 05, 06, 08. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

A parent and its new child/query drafts can be reviewed and published as one recoverable operation.

## Work

1. Add workflow draft and immutable revision storage, autosave services, base revisions, and device recovery contracts.
2. Resolve and validate selected dependency revisions, detect cycles, and produce a consumer-impact review.
3. Implement prepared/publishing/complete/needs-reconciliation publication state and idempotent dependency-first writes across owning stores.
4. Block admission through incomplete publication sets and expose landed revisions/remaining work after interruption.
5. Add semantic conflict reconciliation by stable IDs and preserve unresolved drafts. Make Run resolve only published definitions.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test unfinished draft recovery, save conflicts, merge/delete/reorder conflicts, unpublished dependencies, concurrent dependency edits, crash after each publication write, idempotent resume, and refusal to execute an incomplete set.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read source scope validation and existing graph freezing. Use feature-owned coordination through core capabilities; do not import workflow implementation into core or promise multi-database atomicity.
