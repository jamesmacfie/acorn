# Complete history, recovery, and release acceptance

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 4. Scope: Schedule history projection, run navigation, integration tests, and documentation.

Read [background](./background.md), [scheduling contract](./reference.md), and [scope](./refused.md).
The prerequisite is the completed [workflow tasks programme](../workflow_tasks/README.md), including its AI-authoring and safety gates.

## Implementation

1. Show schedule dispatch history with task/root-run links and independent workflow status. Derive child attention and active-tree status from the workflow capability; do not duplicate step execution state in core.
2. Update history on events and reconcile on reconnect. Keep pause/delete explanations accurate and provide explicit navigation to workflow cancellation.
3. Add Node composition tests for boot without a desktop, recovery before dispatch, plugin absence, and adapter re-registration. Test catch-up, timezone boundaries, and overlapping manual runs with a controlled clock.
4. Exercise the full ticket fixture: a scheduled root obtains structured fixture data, maps eligible items, and passes each ticket string into an independent child workflow. Restart between task creation and run start.
5. Update `docs/schedules.md`, `docs/workflows.md`, and the owning API, data, security, and testing docs with shipped behavior and limitations. Keep the Linear query and business-dedup policy explicitly deferred.

## Tests and acceptance

Run all programme gates. Verify one task per admitted occurrence, no task for invalid/blocked/skipped occurrences, valid supplied inputs, durable recovery, no overlap while descendants run, review on definition changes, retained history after deletion, and no privilege expansion.

Add colocated tests beside the changed modules. Run `pnpm --filter @acorn/node-core test`,
`pnpm --filter @acorn/plugin-workflows test`, and `pnpm lint`; each must exit zero.
For client changes also run `pnpm --filter @acorn/client-core test`. For migrations run
`pnpm db:check`. Phase 5 additionally requires `pnpm test` and
`pnpm --filter @acorn/arch-tests test`.

## Stop conditions

Do not call the programme complete on a UI-only demo. Completion requires persistent-database crash tests, ordinary node-action regression tests, and AI-authored workflow acceptance.

## Verify before building

Compare scoped changes with `git diff 8cb7ce45..HEAD -- packages/node-core packages/protocol packages/client-core plugins/workflows apps/node`.
Read the implementation and preceding phase evidence before editing. Amend this plan when a
contract has drifted. Keep unrelated source changes intact and record evidence in the [phase status](./README.md).
