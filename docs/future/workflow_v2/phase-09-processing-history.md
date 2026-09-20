# Slice 09: Durable selections and repeat decisions

Date: 2026-09-20. Status: implemented and verified.

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

The workflow-owned ledger shares a transaction with dispatcher reservation. It stores selected
snapshots, admitted/skipped decisions, retained projections, related attempts, and source boundaries.
Source identities exclude retrieval scope. Stable loop paths include ancestor record keys.
Root processing scope is frozen before execution; manual roots remain independent.

SQLite tests cover independent connections, A to B to A, failed unchanged records, active records,
renamed loops, independent schedules/epochs, nested paths, field-set reprojection, baseline checks,
query-edit refusal and explicit rebaseline, zero/all-skipped checkpoints, rollback before commit,
replay after commit, and nested reprocess as an independent root attempt with the original history scope.
Runner tests cover source identity/title defaults, exact-attempt retry without querying again,
all-skipped completion, and cancellation after checkpoint commit. Source conformance tests cover
declared baseline/continuation, zero results, and expired-token refusal.

Verification commands:

- `rtk pnpm lint`: all 33 package tasks passed. Preexisting oxlint warnings and sandbox cache-write
  warnings remain nonfatal.
- `rtk pnpm --filter @acorn/plugin-workflows test`: 391 tests passed, including the 500-descendant
  fixture. Run this suite separately from the full TypeScript build to avoid load-dependent timing.
- `rtk pnpm --filter @acorn/node-core test src/server/dataSources/runtime.test.ts src/server/queries/runtime.test.ts`:
  26 tests passed.
- `rtk pnpm --filter @acorn/node test test/integration/plugins/workflowRunner.test.ts`:
  24 composition tests passed.
- `rtk pnpm --filter @acorn/plugin-workflows test src/server/workflowProcessingStore.test.ts`:
  11 tests passed after the final active-record checkpoint guard change.
- `rtk pnpm --filter @acorn/protocol test`: 173 tests passed.
- `rtk pnpm --filter @acorn/plugin-api test`: 12 tests passed.
- `rtk pnpm --filter acorn-plugin-types test`: four tests passed.
- `rtk pnpm --filter @acorn/arch-tests test`: 63 tests passed.
- `rtk pnpm db:check`: all 11 migration chains applied to fresh databases.
- `rtk git diff --check`: passed.

No UI changed in this slice. Device-only routes expose bounded record summaries, separate retained
snapshots, chronological attempts, and immutable reprocess preparation. Malformed cursors and task
callers are rejected before the read-model bridge.

Slice 16 binds schedule IDs/epochs through the root start options and calls the explicit baseline
transaction before activation. Source baseline reads provide the initial boundary; ledger baseline
decisions suppress child dispatch. Slice 18 connects the paged read model and reprocess review.
`WorkflowProcessingStore.reserveReprocess` accepts only the original run, selected row, immutable
digest, and request identity. It derives the retained scope and payload on the server, requires the
frozen child graph, creates a related attempt and ordinary workflow child task, and starts that child
workflow as an independent root run. Exact replay returns the same reservation. It does not query the
source, reopen the settled parent, or restart successful siblings.
Real-provider incremental support is not claimed; the generic fixture proves that capability.

## Verify before building

Read the checkpoint restrictions, retry semantics, and dispatcher transaction ownership. Keep the workflow processing ledger in one database so selection/intent/boundary commit is atomic.
