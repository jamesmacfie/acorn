# 05: Plugin teardown

> **Completion note, October 11, 2026.** `clearRegistrations` in
> `packages/node-core/src/server/pluginHost/host.ts` runs the plugin's undo list, newest first, and
> nothing else. `pnpm lint`, the arch tests, and the `@acorn/node-core`, `@acorn/node`,
> `@acorn/plugin-api`, and `@acorn/plugin-sentry-telemetry` suites pass on Node 26.8.1. The node
> suite includes the reload and disable tests in `apps/node/test/integration/pluginSystem/`.
>
> What landed:
>
> - Every module registry's register function returns a `Disposable` that removes exactly that entry,
>   and only if it's still the same entry. That covers routes, agent tools, context sections, data
>   sources and discoveries, node actions, run sources, audit actions, task checks, search providers,
>   node providers, and the connection, integration, and model provider registries, including
>   provider routes. Extension points, hooks, skills, schedules, harnesses, and custom agents already
>   did this.
> - Each `ctx` member in `pluginHost/context.ts` passes its disposer to `onUndo`. The telemetry read
>   facet on `ctx.core` records its sink the same way. `onUndo` is required, so a context can't be
>   built with nowhere to put an undo.
> - The host's undo list has one writer, `recordRegistrationUndo`. The testkit's
>   `makeTestNodeContext` records into it too, so `clearRegistrations(name)` in a test takes back
>   what a testkit context registered. The testkit's own undo list is gone.
> - A data source discovery's disposer also removes the sources it found. A discovered source carries
>   its discovery's handler, and that's the link.
> - Deleted, because only `clearRegistrations` called them: `clearNodeActions`,
>   `clearTelemetrySinks`, and `ModelProviderRegistry.removeForPlugin` with the owner map only it
>   read. Kept, because tests call them: `removePluginRoutes`, `removeAgentTools`,
>   `removeContextSections`, `clearDataSources`, `clearRunSources`, `clearAuditActions`,
>   `clearExtensionPoints`, `clearHooks`, `clearTaskChecks`, `clearSearchProviders`,
>   `clearNodeProviders`, and `removeForPlugin` on the connection and integration registries.
> - `pluginHost/teardown.test.ts` boots one plugin per context type through `initPlugins`, makes one
>   registration per member, checks each is in its registry, calls `dispose()`, and checks each is
>   gone. It reads the members off the context, so a member with no probe and no entry in the
>   not-a-registration list fails it. I checked that it fails when a member stops recording its undo
>   and when a new member appears.
> - `docs/plugins/activation.md`, `docs/telemetry/plugins-and-sinks.md`, and the "Adding a kind"
>   section of `docs/contribution-kinds.md` describe the undo list.
>
> Decisions and deviations:
>
> - **`capabilities.provide` records no undo.** It already hands the plugin its handle. Shutdown
>   clears each plugin's registrations right after that plugin's dispose, newest plugin first, so
>   recording it would pull a capability out from under an older plugin that may still call it from
>   its own dispose. The test lists it as a plugin-owned handle, beside `storage.open`.
> - **Three reload paths behave better, as a side effect of one list.** A committed reload candidate
>   keeps its telemetry sink; before, the owner-wide sink clear at commit dropped the new instance's
>   sink with the old one. A candidate whose `init` or `ready` throws gives back its event
>   subscriptions and sinks, which used to leak. A committed instance's registrations made after
>   `init`, such as a late `events.on`, now land in the host's list, because the host keeps the
>   candidate's array instead of a copy.
> - **A retired context can't subscribe a telemetry sink.** `ctx.core.telemetry.onBatch` was the one
>   registration a revoked context still allowed. Before this change, the next teardown removed such a
>   sink by plugin name. With per-registration undos, a sink from a failed reload attempt would land in
>   a list nothing runs again and read every record for the life of the process. So it throws after
>   revocation, like every other member, and the revocation test in `host.test.ts` checks it.
> - **One failing undo doesn't stop the rest.** `clearRegistrations` logs it under the plugin's name
>   and carries on. Before, a throw from the old undo loop skipped every clear after it.
> - The reload commit-failure path no longer calls `clearRegistrations` before running the
>   candidate's undos. Each replayed registration recorded its undo as it landed, so the candidate's
>   list is exact.
>
> For later phases: a new Node registration kind needs a registry function that returns a
> `Disposable`, a `recordUndo(...)` at its `ctx` member, and a probe in `teardown.test.ts`. The
> registries are still module singletons, as this proposal's scope says.

This proposal makes every plugin registration on the Node record its own undo, so tearing a plugin
down runs one list. Adding a contribution kind can't then leave a stale registration behind.

Date: October 11, 2026. Status: proposed. Depends on: [01: green the gate](./01-green-the-gate.md).
Part of the [cleanup programme](./README.md).

## Problem

The Node keeps most plugin registrations in module-level registries. When a loaded plugin fails,
reloads, or is turned off, `clearRegistrations` in
`packages/node-core/src/server/pluginHost/host.ts` removes them. It does that by calling one clear
function per registry, about 15 in all: routes, telemetry sinks, agent tools, data sources, Node
actions, run sources, audit actions, extension points, hooks, task checks, search providers,
context sections, model providers, integration providers, connection providers, and Node providers.

A second mechanism runs beside the first. `buildPluginContext` in
`packages/node-core/src/server/pluginHost/context.ts` takes an `onUndo` callback, and 14
registrations record an undo through it. `clearRegistrations` runs those undos as well. Some kinds,
such as extension points, are both undone and cleared.

So a reader has to know two teardown paths, and a contributor who adds a kind has to remember a line
in `host.ts`. The comments beside the clear list describe what goes wrong when a line is missing: a
telemetry sink keeps feeding a disposed plugin, and a stale WebSocket handler keeps claiming its
prefix.

## Goal

Every `ctx` registration returns or records its own disposer. Teardown runs the plugin's undo list
and nothing else.

## Requirements

1. Route every registration a plugin context offers through `onUndo`, including the registries that
   rely on a clear function.
2. Reduce `clearRegistrations` to running the plugin's undo list in reverse.
3. Delete the per-registry clear functions that only `clearRegistrations` calls. Keep a clear
   function that tests or another caller still need.
4. Add a test that registers one of each kind through a plugin context, tears the plugin down, and
   asserts every registry is empty. Drive it from the context's own member list, so a kind added
   later fails the test until it records an undo.

## Out of scope

The registries stay module singletons. Moving them onto an owned object, the way
`CapabilityRegistry` works, is a larger change with more callers. Do it only if this proposal leaves
a real need.

## Acceptance

- `clearRegistrations` holds no per-registry call.
- The teardown test covers every registration member on both context types.
- Reload and disable tests in `packages/node-core/src/server/plugins/` and
  `apps/node/test/integration/pluginSystem/` pass.
