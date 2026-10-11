# 04: Core seams at construction

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
