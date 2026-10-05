# Phase 10: separate plugin contribution registration from host lifecycle

Completion note, October 6, 2026: `host.ts` retains boot, the all-init-before-ready barrier,
loaded containment, the reload transaction, storage handles, and reverse disposal. Manifest work
routes moved to `manifestWork.ts`; data sources, node actions, and audit declarations moved to
`manifestCatalog.ts`; harness and custom-agent translation moved to `manifestAgents.ts`; tool and
context-section registration joined their existing `runtimeContributions.ts` owner. Each adapter
receives the binding, a narrow context projection, and only the host binding it needs. Context
registration methods bind the plugin identity and feed the host's undo or owner-scoped clear path.

Lifetime map: `initPlugins` owns per-boot contexts, opened database handles, the mutable roster, and
the active loaded binding map. Shutdown revokes held contexts after disposing each instance.
`undoRegistrations` holds per-plugin schedule, event, and emits
disposers for module-level registries; `clearRegistrations` removes those and the owner-bound registry
entries. A loaded pre-init or post-init contribution failure follows the same contained `init`
failure path as its plugin code. A compiled pre-init registration failure aborts boot after clearing
partial declarations; an init or ready failure also disposes every instance that ran. The loaded
reload buffer keeps the previous instance live through
candidate `init` and `ready`; commit removes old registrations, disposes the old instance, closes its
database, then replays the candidate. Hook, extension-point, schedule, and emits disposers check the
registration instance before removal, so a late old disposer cannot remove a successor.

No API, permission, task scope, provider scope, or migration contract changed. The reload replay
window retains its documented limit: an invalid buffered registration fails after commit begins and
cannot restore the previous instance. Phase 11 can start from the accepted host and adapter owners;
phase 15 owns the combined root test, build, and pack gates.

Date: 2026-10-06. Status: DONE. Risk: high; failure isolation and permission binding are contracts.
Prerequisite: accepted [phase 09](./09-workflow-activation.md). Next: [phase 11](./11-agent-admission.md).
Planning revision: `2ae55abb5`; verify the current plugin host and workflow integration handoff.

## Task and context

Extract coherent manifest-to-registry adapters from `packages/node-core/src/server/pluginHost/host.ts`.
The audited 805-line file includes a large `initPlugins` function with contribution implementations.
Keep boot, ready, storage lifetime, loaded reload, failure rollback, and teardown owned by the host.
Make it possible to understand those lifetimes without reading each schedule/tool/context adapter.

The host receives compiled and loaded bindings, builds permission-shaped contexts, opens declared
storage, registers contributions, runs initialization, then crosses the all-initialized ready barrier.
Built-in failures abort boot; loaded failures are contained and reported. Reload stages a candidate
while the previous loaded instance continues serving. Cleanup must remain associated with its binding.

## Starting points and invariants

- `packages/node-core/src/server/pluginHost/host.ts`, `host.test.ts`, `context.ts`, `types.ts`, `state.ts`.
- Existing adapter owners: `runtimeContributions.ts`, `schedules.test.ts`, `taskChecks.ts`, `hooks.ts`,
  `harnesses.ts`, `customAgents.ts`, `search.ts`, `extensionPoints.ts`, `capabilities.ts`.
- `apps/node/test/integration/plugins/runtimeContributions.test.ts` crosses the real Node/plugin seam.
- [Node security](../../security/node-plugin-security.md), [plugin storage](../../security/plugin-storage-and-supply-chain.md),
  [Node extensions](../../plugins/node-side-extension-points.md), and [plugin map](../../plugin-map.md).

Preserve shared capability graph identity, duplicate-provider rejection, plugin-bound context and
permission checks, disabled/required behavior, one DB handle per owner, all-init-before-ready,
reverse disposal, rollback, cleanup after failures, and old-instance service during failed reload.

## Implementation steps

1. Trace init, ready, loaded failure, boot failure, successful reload, failed candidate reload, and
   disposal. Record which owner stores undo functions, contexts, binding identity, opened DB handles,
   and registry entries. Identify module-lifetime vs boot-lifetime state; don't change it casually.
2. Extract contribution families in small batches using existing feature modules where possible:
   schedules/checks/hooks; data/actions/tools/context; harness/custom-agent/audit registrations.
   Name modules by responsibility rather than a catch-all helpers file.
3. Give each adapter a typed binding/context, explicit required services, and a registration cleanup
   sink or returned disposer. The host retains the actual lifetime/rollback owner. Preserve immediate
   undo registration so partial adapter failure cannot leave half a manifest installed.
4. Keep permission gates at the same authoritative boundary. Adapters must not accept arbitrary
   plugin IDs from input, bypass loaded context carriers, borrow another plugin's DB, or weaken
   provider/task-scoped access. Do not create ambient access to the active context or host services.
5. Leave `initPlugins` describing lifecycle and ordering. Do not parallelize previously ordered work,
   serialize the existing async init barrier, or close storage before plugin disposal. Keep registries
   ready for re-registration after disposal and clean disabled contributions on each boot.
6. Preserve reload transaction semantics: candidate failure leaves the previous instance and its
   registrations live; success transfers serving ownership and retires old resources once. A
   registration disposer must remove its own generation, not a successor's same-named entry.
7. Keep existing tests through the host and real manifests. Add only unproved partial registration,
   cleanup-generation, or DB lifetime cases. Test resulting registry behavior/closed handles rather
   than asserting which private helper the host called.

## Verification

```sh
pnpm test:focus @acorn/node-core src/server/pluginHost/host.test.ts
pnpm test:focus @acorn/node-core src/server/pluginHost/schedules.test.ts
pnpm test:focus @acorn/node test/integration/plugins/runtimeContributions.test.ts
pnpm lint
pnpm test --filter=@acorn/node-core --filter=@acorn/node --filter=@acorn/cli --filter=@acorn/tui --filter=@acorn/desktop
pnpm --filter @acorn/arch-tests test
```

Run focused tests for each moved adapter's family, including hooks, checks, search, and extension
points. Exercise a loaded fixture through startup, contribution invocation, failed reload, successful
reload, disable, and shutdown. Verify cleanup using observable registrations and process/storage exit.

## Acceptance and handoff

- Host lifecycle is readable independently of contribution implementation. Adapters have explicit
  binding and services; cleanup remains under one host owner.
- Compiled fatal failure vs loaded containment, ready barrier, DB lifetime, and reload semantics pass.
- Permissions, routes, plugin API major 3, and contribution contracts remain unchanged.
- Existing Node/CLI/TUI/desktop consumers and architecture checks pass. No new lifecycle global or
  parallel registration path remains alongside the extracted adapters.
- Record owner/cleanup maps and tests in task/table/evidence. Rollback is coordinated host/adapter
  restoration; retain all plugin databases and migration history.

## Verify before building

Re-read host lifecycle and reload tests, actual cleanup storage, and current permission-shaped
contexts. Stop if an extraction weakens a gate or makes two owners responsible for disposal.
