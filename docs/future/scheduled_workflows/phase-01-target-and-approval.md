# Add the workflow target and approval lifecycle

> Superseded on 2026-09-13 by [workflow v2](../workflow_v2/README.md).
> Do not implement this historical plan. Its original text is retained for background; the new
> [scheduling contract](../workflow_v2/scheduling.md) and implementation slices are authoritative.

Date: 2026-09-12. Status: implementation proposal, not started.
Baseline: `8cb7ce45`. Paths describe the surveyed code, not a promise that it has stayed unchanged.

Depends on: Completed workflow_tasks programme. Scope: Scheduler contracts, routes, workflow capability, and application composition.

Read [background](./background.md), [scheduling contract](./reference.md), and [scope](./refused.md).
The prerequisite is the completed [workflow tasks programme](../workflow_tasks/README.md), including its AI-authoring and safety gates.

## Implementation

1. Define a narrow workflow scheduling capability in the workflow plugin's public contract: prepare scoped binding, dispatch with intended identities, and read lifecycle by recorded identity. Connect it in application composition; core must not import plugin implementation.
2. Extend scheduler target registration with async preparation where required. Keep synchronous shape parsing separate from database-backed validation. Preserve node-action behavior.
3. Extend `packages/protocol/src/schedules.ts` target discovery with discriminated descriptors that host UI can validate. Do not expose raw plugin objects or executable callbacks across the wire.
4. Add paused creation, target editing, and explicit arming semantics to `packages/node-core/src/server/routes/schedules.ts` and scheduler storage. Editing execution-affecting configuration invalidates approval.
5. Use workflow_tasks resolution to validate and fingerprint the entire referenced graph, resolve defaults, and require finite unattended limits. Recheck approval/trust before dispatch. Return structured field errors and needs-review reasons.

## Tests and acceptance

Test missing and blank inputs, unknown names, changed defaults, child definition edits, unchanged approved graphs, revoked trust, invalid project, absent plugin, unauthorized callers, and create/arm races. Legacy node-action schedules keep working.

Add colocated tests beside the changed modules. Run `pnpm --filter @acorn/node-core test`,
`pnpm --filter @acorn/plugin-workflows test`, and `pnpm lint`; each must exit zero.
For client changes also run `pnpm --filter @acorn/client-core test`. For migrations run
`pnpm db:check`. Phase 5 additionally requires `pnpm test` and
`pnpm --filter @acorn/arch-tests test`.

## Stop conditions

If the workflow adapter cannot be registered without a core-to-plugin dependency, fix composition. Do not add plugin-specific imports to core or broaden the plugin context.

## Verify before building

Compare scoped changes with `git diff 8cb7ce45..HEAD -- packages/node-core packages/protocol packages/client-core plugins/workflows apps/node`.
Read the implementation and preceding phase evidence before editing. Amend this plan when a
contract has drifted. Keep unrelated source changes intact and record evidence in the [phase status](./README.md).
