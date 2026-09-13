# Slice 09: Durable selections and repeat decisions

Date: 2026-09-13. Status: not started.

Read [context and decisions](./context.md) first, then the owning
[contract or UX reference](./scheduling.md) and [verification](./verification.md).
The [programme index](./README.md) links every related contract and implementation slice.
Prerequisites: 08. Do not start dependent work until those slices' acceptance checks pass.

## Outcome

Two occurrences of one automation skip unchanged work while a different automation remains independent.

## Work

1. Add workflow-owned selection, record-state, and attempt records with unique schedule/epoch/loop-path/record keys.
2. Implement every-match, unseen, and selected-field-change decisions against canonical retained projections.
3. Atomically reserve eligible dispatch intents and persist selection decisions with a committed incremental boundary where supported.
4. Implement baseline, explicit retry/reprocess, history retention across edits, and explicit fresh epoch behavior.
5. Expose a paged read model for selected/skipped/failed/active records and per-record attempt history. Scheduling can use a fixture scope until its runtime lands.

## Boundaries

Implement this slice within its owning runtime and public contribution/capability seams. Keep pure
rules separate from I/O and UI state. Preserve unrelated behavior and worktree edits. Do not widen
scope to exclusions in [refused alternatives](./refused.md). Update the owning reference docs when
this slice exposes shipped behavior, and keep the programme status accurate during gated rollout.

## Verification

Test A → B → A, same IDs across sources/connections, nested parent identity, renamed loops, changed tracked fields, failed unchanged projections, fresh manual scopes, concurrent admission, and crashes before/after selection commit.

Run `pnpm lint` and the relevant owning-package tests before handoff. Include architecture tests
when public exports, plugin contracts, or runtime boundaries change. Follow the real-window checks
for UI changes. Record actual evidence rather than copying expected results into a completion claim.

## Evidence

Not run. Fill in commands, results, UI artifacts where applicable, and any remaining failures during
implementation. Mark complete only when the outcome and all required checks are demonstrated.

## Verify before building

Read the checkpoint restrictions, retry semantics, and dispatcher transaction ownership. Keep the workflow processing ledger in one database so selection/intent/boundary commit is atomic.
