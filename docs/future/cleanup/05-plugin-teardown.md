# 05: Plugin teardown

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
