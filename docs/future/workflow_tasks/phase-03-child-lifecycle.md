# Execute and reconcile child workflow runs

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 2. Scope: Runner lifecycle, built-in handler registration, and run projections.

Read [background](./background.md), [execution contract](./reference.md), and [scope](./refused.md) before implementing. This phase is not independently releasable before the programme's final gate.

## Implementation

1. Add the single-child workflow handler beside `plugins/workflows/src/server/workflowBuiltins.ts`, using the dispatch ledger rather than copying the fan-out agent loop.
2. Add durable waiting-for-children state and resume it from persisted child-run state. Events are wake-ups, not the only source of truth. Keep the coordinator outside the agent semaphore.
3. Extend `plugins/workflows/src/server/workflowRunner.ts` reconciliation, retry, and terminal transitions. A retry reuses the invocation and observes or resumes its child; it does not create a fresh child by default.
4. Propagate cancellation to descendant workflow runs and sessions, not only task status. Stop further admission first. Define parent completion as all admitted children settled.
5. Preserve gates, child failure detail, and ordinary graph readiness. Publish typed parent/child summaries through `plugins/workflows/src/shared/api.ts` and the plugin's events. Keep task ownership checks on every lookup.

## Tests and acceptance

Test success, child failure, child gate, approval after reconnect, parent cancellation during reservation, cancellation during an agent turn, duplicate terminal events, and recovery with an already-terminal child. Waiting parents must not consume agent slots.

Add colocated `.test.ts` or `.test.tsx` tests beside the changed module, following its neighboring tests. Run `pnpm --filter @acorn/plugin-workflows test` and `pnpm lint`; both must exit zero. For core changes also run `pnpm --filter @acorn/node-core test`. For migrations run `pnpm db:check`. Phase 7 additionally requires `pnpm test` and `pnpm --filter @acorn/arch-tests test`.

## Stop conditions

Do not auto-approve gated workflows to make dispatch unattended. Keep the feature disabled until phase 4's limits and authorization tests pass.

## Verify before building

Compare the scoped implementation with `git diff 8cb7ce45..HEAD -- plugins/workflows packages/node-core`. Re-read changed contracts and tests; amend this phase if assumptions have drifted. Keep core/plugin imports, task authentication, and unrelated work untouched. Record test evidence and update the [phase status](./README.md) on completion.
