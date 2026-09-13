# Persist schedule occurrences before dispatch

> Superseded on 2026-09-13 by [workflow v2](../workflow_v2/README.md).
> Do not implement this historical plan. Its original text is retained for background; the new
> [scheduling contract](../workflow_v2/scheduling.md) and implementation slices are authoritative.

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 1. Scope: Core scheduler persistence and dispatch lifecycle.

Read [background](./background.md), [scheduling contract](./reference.md), and [scope](./refused.md).
The prerequisite is the completed [workflow tasks programme](../workflow_tasks/README.md), including its AI-authoring and safety gates.

## Implementation

1. Add additive core migrations for durable occurrence claims, generation identity, reserved task/run IDs, dispatch states, and per-schedule admission ownership. Keep recent-history projection separate.
2. Refactor `packages/node-core/src/server/schedules/scheduler.ts` to claim due work before effects and advance cadence against the claimed due instant. Preserve catch-up once and existing node-action semantics.
3. Pass an invocation context to targets without making existing handlers workflow-aware. Record request identity for manual run-now and enforce duplicate-payload consistency.
4. Recover unfinished claims at startup before admitting another occurrence for that schedule. Use durable state, not just in-memory inflight sets.
5. Define tombstone/retention behavior for delete and recent-history pruning. Do not purge identity while retries or an active workflow can still reference it.

## Tests and acceptance

Use a controllable clock and persistent database. Crash before/after claim and cadence advancement; race two runners and run-now; retry after a handler timeout; prune over 20 history records; restart after several missed periods. Assert no duplicate claim and no unbounded catch-up.

Add colocated tests beside the changed modules. Run `pnpm --filter @acorn/node-core test`,
`pnpm --filter @acorn/plugin-workflows test`, and `pnpm lint`; each must exit zero.
For client changes also run `pnpm --filter @acorn/client-core test`. For migrations run
`pnpm db:check`. Phase 5 additionally requires `pnpm test` and
`pnpm --filter @acorn/arch-tests test`.

## Stop conditions

Do not use startedAt in the 20-row history ring as the only identity. If recovery needs to guess whether a task exists, the reserved-ID contract is incomplete.

## Verify before building

Compare scoped changes with `git diff 8cb7ce45..HEAD -- packages/node-core packages/protocol packages/client-core plugins/workflows apps/node`.
Read the implementation and preceding phase evidence before editing. Amend this plan when a
contract has drifted. Keep unrelated source changes intact and record evidence in the [phase status](./README.md).
