# Expose child runs and complete the handoff

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 6. Scope: Workflow run UI, task links, regression tests, and owning documentation.

Read [background](./background.md), [execution contract](./reference.md), and [scope](./refused.md) before implementing. This phase is not independently releasable before the programme's final gate.

## Implementation

1. Extend `plugins/workflows/src/client/runs/` and `workflowsClient.ts` to show parent/root links, child task/run links, map progress, gate attention, failures, and aggregate usage. Use explicit lineage, not inferred task titles.
2. Keep run history and task navigation Node-scoped. Invalidate the relevant parent and child queries on run events and reconcile on reconnect. Do not depend on receiving every event.
3. Make retry and cancellation copy explain their tree-wide effects. Preserve child tasks after completion and show their final status without auto-archiving worktrees.
4. Add end-to-end Node integration fixtures for the ticket example, using a structured fixture producer. Prove generated and hand-authored definitions execute identically.
5. Update `docs/workflows.md`, `docs/workspaces-and-tasks.md`, `docs/security.md`, and the owning API/data/event docs for implemented contracts. Record remaining limitations, including cross-run business deduplication.
6. Verify the scheduled-workflows programme can consume the internal idempotent start contract. Mark this programme complete only after the gates below pass.

## Tests and acceptance

Run the complete regression suite. Manually inspect a gated child, mixed-result map, cancel/retry, offline reconnect, and identical resource IDs on different Nodes. Verify legacy fan-out and static inline composition still behave as before.

Add colocated `.test.ts` or `.test.tsx` tests beside the changed module, following its neighboring tests. Run `pnpm --filter @acorn/plugin-workflows test` and `pnpm lint`; both must exit zero. For core changes also run `pnpm --filter @acorn/node-core test`. For migrations run `pnpm db:check`. Phase 7 additionally requires `pnpm test` and `pnpm --filter @acorn/arch-tests test`.

## Stop conditions

Do not expose scheduling early through an unguarded button. Hand off the internal contract and evidence to scheduled_workflows only after runtime, AI authoring, and UI acceptance pass.

## Verify before building

Compare the scoped implementation with `git diff 8cb7ce45..HEAD -- plugins/workflows packages/node-core`. Re-read changed contracts and tests; amend this phase if assumptions have drifted. Keep core/plugin imports, task authentication, and unrelated work untouched. Record test evidence and update the [phase status](./README.md) on completion.
