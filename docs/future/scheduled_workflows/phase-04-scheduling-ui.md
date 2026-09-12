# Build the user scheduling flow

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Phase 3. Scope: Host schedule settings, workflow entry point, forms, and Node cache.

Read [background](./background.md), [scheduling contract](./reference.md), and [scope](./refused.md).
The prerequisite is the completed [workflow tasks programme](../workflow_tasks/README.md), including its AI-authoring and safety gates.

## Implementation

1. Extend `packages/client-core/src/features/settings/SchedulesSettings.tsx` with workflow target selection and a reusable cadence editor. Keep schedule approval host-owned.
2. Add a Schedule entry from a saved workflow through a typed host contribution or capability. Prefill a draft with owning Node, project, and definition, then obtain explicit user approval in the host form.
3. Render all declared workflow inputs, required markers, and resolved defaults. Show validation beside fields. Explain finite limits, selected project, task-per-occurrence behavior, overlap skipping, and the Node-local next run time.
4. Support save paused, arm, pause, edit/review, run-now, and delete. Show definition changes requiring review. Do not let AI generation or saving a workflow arm anything.
5. Preserve drafts when offline or when validation fails. Use owning-Node cache keys and mutation routes. Keep frame permissions and the closed UI kit intact.

## Tests and acceptance

Test required input forms, no-input workflows, changed schemas, invalid cadence, review/rearm, Node switching with identical IDs, unavailable Nodes, and preservation of entered text. Manually verify keyboard access and narrow layouts. Generate a workflow with child input mappings, save it, then schedule it through the same form.

Add colocated tests beside the changed modules. Run `pnpm --filter @acorn/node-core test`,
`pnpm --filter @acorn/plugin-workflows test`, and `pnpm lint`; each must exit zero.
For client changes also run `pnpm --filter @acorn/client-core test`. For migrations run
`pnpm db:check`. Phase 5 additionally requires `pnpm test` and
`pnpm --filter @acorn/arch-tests test`.

## Stop conditions

If a workflow plugin UI cannot open the host action through a supported seam, add a narrow descriptor contract. Do not grant raw host HTTP or DOM access to frames.

## Verify before building

Compare scoped changes with `git diff 8cb7ce45..HEAD -- packages/node-core packages/protocol packages/client-core plugins/workflows apps/node`.
Read the implementation and preceding phase evidence before editing. Amend this plan when a
contract has drifted. Keep unrelated source changes intact and record evidence in the [phase status](./README.md).
