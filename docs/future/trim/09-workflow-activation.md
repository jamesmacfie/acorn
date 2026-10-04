# Phase 09: move workflow behavior out of activation

Date: 2026-10-04. Status: TODO. Risk: medium to high; capabilities and readiness are order-sensitive.
Prerequisite: accepted [phase 08](./08-agent-composer.md). Next: [phase 10](./10-plugin-host.md).
Planning revision: `2ae55abb5`; phase 06 changed definition helper owners.

## Task and context

Make `plugins/workflows/src/node/index.ts` a composition root: instantiate feature services, register
routes/capabilities/events/schedules, and dispose them. The audited 689-line file embeds runner
adapters, policy/check queries, context assembly, handoff behavior, definition publication, and
schedule/control domain operations. Existing server feature services should own that behavior.

Definitions originate in repository/user files or published drafts. Resolution produces a frozen
graph for dispatch. Runner admission creates tasks and managed sessions, evaluates gates, records
processing, and publishes events. Cross-plugin operations use capability seams; unavailable providers
must retain today's graceful outcomes. Ready/reconciliation precedes mutations that need restored state.

## Starting points

- `plugins/workflows/src/node/index.ts` and `node/schema.ts` are the permitted Node entry files.
- Existing server owners: `runs/deps.ts`, `runs/admission.ts`, `definitions/`, `publication/service.ts`,
  `publication/draftQueries.ts`, `schedules/service.ts`, `authoring/generationRequest.ts`, `dispatch/`.
- Contract files under `plugins/workflows/src/contract/` and managed execution capabilities under
  `plugins/agents/src/contract/`. Use public contracts, never another plugin's server implementation.
- `apps/node/test/integration/plugins/workflowRunner.test.ts`, `workflowTasks.test.ts`, and
  `workflowFiles.test.ts` prove the installed Node/plugin wiring.

Read [plugin map](../../plugin-map.md), [workflows](../../workflows.md),
[workflow routes](../../api-reference/workflow-routes.md), and [conventions](../../conventions.md).

## Implementation steps

1. Classify each activation closure: construction, registration, runner adapter, definition command,
   schedule command, context/handoff, or lifecycle. List captured variables and whether the value is
   read once, read per call, or becomes available after `ready()`.
2. Move runner dependency adapters into a workflow server feature module/factory. Pass capability
   lookup, scoped internal environment, core ports, and publishing explicitly. Keep managed-agent
   lookup per call where it is currently late-bound; do not cache an absent capability at init.
3. Preserve managed execution/headless fallback, profile selection, abort propagation, scoped tools,
   context HTTP behavior, policy result/failing-check semantics, and optional notes handoffs. A missing
   provider or failed context read must return its existing result, not a new blanket exception.
4. Move definition and publication domain commands to their existing service owners, or add narrowly
   named modules there. Keep routes parsing/authenticating inputs and delegating. Preserve file vs
   published provenance, read-only revision zero, conflicts, fingerprints, and trust checks.
5. Move schedule/control behavior beside existing schedule/run services. Keep capability IDs, route
   paths, event names, trigger deduplication, and timer ownership unchanged. Keep nested child task
   and workflow lifecycle in dispatch owners rather than copying it into activation adapters.
6. Wire construction and registration in `node/index.ts`. Keep runner initialization explicit and
   ensure callbacks cannot use a half-constructed runner. Reconciliation/readiness barriers and
   disposal order stay visible here. Avoid new barrels or extra entry files under `node/`.
7. Use integration tests to prove adapters through actual capabilities, routes, and emitted state.
   Add missing-provider or held-ready tests only where current behavior lacks proof. Keep domain
   tests beside services; don't replace integration proof with tests of mocked registrations.

## Verification

```sh
pnpm test:focus @acorn/node test/integration/plugins/workflowRunner.test.ts
pnpm test:focus @acorn/node test/integration/plugins/workflowTasks.test.ts
pnpm test:focus @acorn/node test/integration/plugins/workflowFiles.test.ts
pnpm lint
pnpm test --filter=@acorn/plugin-workflows --filter=@acorn/node --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
```

Also run focused publication, schedules, processing, and nested-dispatch tests for the moved owners.
Exercise a fixture workflow that starts a managed session, a policy gate, a nested child, and a
schedule. Verify cancellation/teardown and absent optional provider behavior without live network.

## Acceptance and handoff

- The entrypoint explains composition, registration, readiness, and disposal. Domain operations have
  feature-owned typed modules with no import cycles or hidden globals.
- Routes/capabilities, published/file definition semantics, dispatch, and fallback behavior are unchanged.
- Reconciliation blocks dependent mutations; timers and callbacks stop before storage closes.
- Public surface/architecture checks and actual Node integration suites pass. Update owning docs only
  where the internal owner map needs correction; do not describe a new product feature.
- Record moved paths and lifecycle ordering in task/table/evidence. Rollback restores activation and
  feature adapters together, preserving database history and fingerprints.

## Verify before building

Inspect current runner dependencies, capability registration timing, reconciliation, and disposal.
Stop if this refactor requires a cross-plugin implementation import or a new public contract.
