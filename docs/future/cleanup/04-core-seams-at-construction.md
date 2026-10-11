# 04: Core seams at construction

> **Completion note, October 11, 2026.** No core service is assigned after construction.
> `git grep -n "core\.nodeKeys =\|core\.pluginSecurity ="` returns nothing. `pnpm lint`, the arch
> tests, and the `@acorn/node-core`, `@acorn/node`, `@acorn/plugin-agents`, `@acorn/plugin-http`, and
> `@acorn/plugin-api` suites pass on Node 26.8.1. In `pnpm dev:agent`, **Check this node** showed
> plugin permissions (7 installed plugins, 1 allowed to run code) and the key custody finding (keys
> sealed by the desktop app, no plain key files).
>
> What landed:
>
> - `createCoreServices` takes two more required inputs: `nodeKeys`, the key custody report built
>   from the session key check, and `capabilities`, the boot's capability registry. `bootNode()` in
>   `apps/node/src/composition/boot.ts` passes both. The key check already ran before core services
>   were built, so no step moved.
> - `core.pluginSecurity.snapshot()` reads `PLUGIN_STATE` from the registry each time it runs, with
>   `require`. Before the plugins start, it rejects, and the diagnostic reports the read as failed.
>   Both the state module and the snapshot module load on first call, so the boot graph doesn't grow.
>   A test in `pluginHost/state.test.ts` provides the bridge after core is built and reads the count.
> - Both fields are required in `CompiledCoreServices`.
> - `withOwnedTelemetry` in `pluginHost/context.ts` is a plain spread again. `context.test.ts` held
>   only the late-assignment test, so the file is deleted.
> - `securityDiagnostics.ts` drops the optional checks. The "Passive plugin host facts are
>   unavailable" branch is gone, because a snapshot either arrives or throws. `host.keys` always
>   appears. The test that expected no `host.keys` finding without a custody report is deleted.
> - The `./server/pluginHost/pluginSecurity.ts` export in `packages/node-core/package.json` served
>   only the old boot assignment, so it's removed.
>
> Decisions:
>
> - **Core reads the registry. No new capability.** Core can reach the registry, so requirement 2's
>   fallback wasn't needed.
> - **A testkit helper for the two inputs.** About 45 test call sites build core services directly.
>   Each one spreads `testCoreSeams()` from `@acorn/node-core/testkit`, which `@acorn/plugin-api/testkit`
>   re-exports. It returns a sealed key report and an empty registry. The plugin-api surface snapshot
>   gains that one name, and `docs/testing/layers.md` § The testkit describes it. `makeTestCoreServices`
>   and `makeTestNodeContext` use it too.
>
> For later phases: nothing in this phase changes plugin teardown or the agents runtime.

This proposal stops the Node from assigning core services after plugins have started. Each seam
arrives when core services are built, or a plugin reads it through the capability registry.

Date: October 11, 2026. Status: proposed. Depends on: [02: one Node boot](./02-one-node-boot.md).
Part of the [cleanup programme](./README.md).

## Problem

Both Node entries assign two fields on the shared core object after `initPlugins` returns:
`core.nodeKeys` and `core.pluginSecurity`. See `apps/node/src/composition/runtime.ts` lines 259 and
260, and `apps/node/src/entries/standalone.ts` lines 132 and 133. `CompiledCoreServices` in
`packages/node-core/src/server/core/index.ts` declares both as optional for that reason.

Each plugin's context took a copy of core when it was built, so no plugin saw either field. The
agents plugin's **Check this node** reported plugin host facts as unavailable on every Node. Commit
`beb47f514` on October 11 fixed the symptom. `withOwnedTelemetry` in
`packages/node-core/src/server/pluginHost/context.ts` builds each plugin's core with the shared
object as its prototype, then copies its fields on top, so a later assignment shows through. The
next reader has to decode that trick, and the seams stay optional, so a reader still has to handle a
missing value that only exists because of boot order.

The repository already has a mechanism for values that arrive after construction: the capability
registry. `PLUGIN_STATE` is provided on the line before the two assignments.

## Goal

No core service is assigned after construction. Each seam has one owner and one way to reach it.

## Requirements

1. Pass `nodeKeys` into `createCoreServices`. The session key check runs before core services are
   built, so the value exists in time.
2. Make `pluginSecurity` read `PLUGIN_STATE` from the capability registry when called, instead of
   taking the bridge at assignment. If core can't reach the registry, move `pluginSecurity` to a
   capability the agents plugin reads directly.
3. Make both fields required in `CompiledCoreServices`.
4. Revert `withOwnedTelemetry` to a plain copy and delete the test that asserts a late assignment
   shows through.
5. Simplify the optional checks in `plugins/agents/src/server/securityDiagnostics.ts` lines 259 and
   281.

## Acceptance

- `git grep -n "core\.nodeKeys =\|core\.pluginSecurity ="` returns nothing.
- **Check this node** in `pnpm dev:agent` shows plugin host facts and the key custody finding.
- `pnpm test --filter=@acorn/node-core`, `--filter=@acorn/plugin-agents`, and
  `--filter=@acorn/node` pass.
