# Persist dispatch intent and run lineage

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 1. Scope: Workflow schema, runner start, and core child task creation.

Read [background](./background.md), [execution contract](./reference.md), and [scope](./refused.md) before implementing. This phase is not independently releasable before the programme's final gate.

## Implementation

1. Add additive migrations in `plugins/workflows/src/node/schema.ts` for explicit run lineage and a dispatch ledger with the reference's unique caller key and payload fingerprint. Backfill legacy runs as roots without inventing child-run lineage for synthetic steps.
2. Refactor `plugins/workflows/src/server/workflowRunner.ts` start to accept an internal intended run ID and invocation identity. Atomically insert a run and its initial step roster within the plugin database. Repeated starts return the same run only when identity and payload match.
3. Reserve task and run IDs before calling `createChild` in `packages/node-core/src/server/core/tasks.ts`. Reuse its intended-ID validation. Persist each transition so a restart can complete the next operation.
4. Add reconciliation for reserved and partially completed dispatches. Resolve through typed services; no cross-database SQL or foreign keys. An ambiguous response must be looked up by intended identity before retrying.
5. Expose a narrow internal start contract suitable for a later scheduler caller. Do not add an external route or privileged agent tool.

## Tests and acceptance

Inject crashes after reservation, task creation, run creation, and before acknowledgement. Restart twice and assert one task, one run, one roster. Concurrent identical requests converge; conflicting payloads reject. Migrate a database containing legacy runs without losing history.

Add colocated `.test.ts` or `.test.tsx` tests beside the changed module, following its neighboring tests. Run `pnpm --filter @acorn/plugin-workflows test` and `pnpm lint`; both must exit zero. For core changes also run `pnpm --filter @acorn/node-core test`. For migrations run `pnpm db:check`. Phase 7 additionally requires `pnpm test` and `pnpm --filter @acorn/arch-tests test`.

## Stop conditions

If core's intended-ID semantics no longer support seed verification, extend that core operation explicitly. Do not fake atomicity across the core and plugin databases.

## Verify before building

Compare the scoped implementation with `git diff 8cb7ce45..HEAD -- plugins/workflows packages/node-core`. Re-read changed contracts and tests; amend this phase if assumptions have drifted. Keep core/plugin imports, task authentication, and unrelated work untouched. Record test evidence and update the [phase status](./README.md) on completion.
