# Create root tasks and enforce workflow overlap

> Superseded on 2026-09-13 by [workflow v2](../workflow_v2/README.md).
> Do not implement this historical plan. Its original text is retained for background; the new
> [scheduling contract](../workflow_v2/scheduling.md) and implementation slices are authoritative.

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 2. Scope: Core task operation, workflow adapter, and scheduler admission.

Read [background](./background.md), [scheduling contract](./reference.md), and [scope](./refused.md).
The prerequisite is the completed [workflow tasks programme](../workflow_tasks/README.md), including its AI-authoring and safety gates.

## Implementation

1. Extract root creation from `packages/node-core/src/server/routes/projects/tasks.ts` into the core task operation used by that route. Preserve project validation, branch rules, external-link checks, events, and response behavior.
2. Add internal intended-ID creation with seed verification. The scheduled caller supplies title/project and reserved identity, not arbitrary filesystem paths or credentials.
3. Implement the workflow adapter using the durable occurrence and workflow_tasks start contract. Reconcile task-created/run-not-started interruptions by identity. Return after durable run start, within scheduler handler limits.
4. Implement skip-overlap against persisted workflow-tree lifecycle. Acquire admission atomically across automatic and manual starts. Clear the lock only when the admitted tree settles or dispatch definitely failed before start.
5. Keep skipped, dispatch-failed, started, and workflow-terminal outcomes distinct. Revalidate approval before task creation, and fail closed if dependencies disappear. Preserve partially created tasks with an actionable diagnostic rather than deleting them.

## Tests and acceptance

Crash at every cross-database boundary and assert one root task/run. Run a workflow longer than 300 seconds without keeping its scheduler handler alive. Test a child gate blocking the next occurrence, independent schedules, plugin disable/re-enable, cancellation, and ambiguous start acknowledgement.

Add colocated tests beside the changed modules. Run `pnpm --filter @acorn/node-core test`,
`pnpm --filter @acorn/plugin-workflows test`, and `pnpm lint`; each must exit zero.
For client changes also run `pnpm --filter @acorn/client-core test`. For migrations run
`pnpm db:check`. Phase 5 additionally requires `pnpm test` and
`pnpm --filter @acorn/arch-tests test`.

## Stop conditions

Do not mark the workflow complete when dispatch returns. Do not release overlap solely because the scheduler handler timed out.

## Verify before building

Compare scoped changes with `git diff 8cb7ce45..HEAD -- packages/node-core packages/protocol packages/client-core plugins/workflows apps/node`.
Read the implementation and preceding phase evidence before editing. Amend this plan when a
contract has drifted. Keep unrelated source changes intact and record evidence in the [phase status](./README.md).
