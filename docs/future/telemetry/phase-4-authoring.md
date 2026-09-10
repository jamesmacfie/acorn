# Phase 4: plugin authoring

Status: not started. Waits on phase 1.

## Goal

A plugin author at any level of effort is served, as [04-plugin-dx.md](./04-plugin-dx.md) describes.
A frame or worker emits through one bridge verb. A compiled client plugin imports `telemetry` from
`@acorn/plugin-api/client`. A plugin test reads what its plugin emitted from the testkit context. The
`plugin_authoring` agent tool and the authoring docs describe all of it. A Settings → Telemetry page
shows the user what is being collected, per owner, so the switch is legible.

## Why this phase, and why now

Phase 0 gave the node half its verbs; phase 1 gave the host its seams. Frames and workers still have
no way to emit, tests have no way to assert, and the switch in Settings is a checkbox with no
evidence beside it.

## Scope

In:

- `packages/client-core/src/host/frames/sdk.ts` and `broker.ts`: a `telemetry` verb carrying one
  record minus the owner; the host stamps the owner from the binding; the existing rate window
  applies.
- `packages/plugin-api/src/client.ts`: `telemetry` export for compiled client plugins, taking the
  plugin id `makeContext` checked.
- `packages/plugin-api/src/testkit.ts` and `packages/node-core/src/testkit/`: `makeTestNodeContext`
  gets a recording collector; `ctx.telemetry` and `ctx.log` write to `ctx.recorded`; `ctx.core.telemetry`
  present when the permissions name the token.
- `packages/node-core/src/server/agentTools/pluginAuthoring.ts`: the projection names the token and
  the two `ctx` members.
- A Settings → Telemetry page in `packages/client-core/src/features/settings/` reading a
  `GET /v2/core/telemetry/summary` (new route) in `packages/node-core/src/server/routes/telemetry.ts` (new in phase 1): records per owner and kind since boot, drops, last
  flush, subscribed sinks by plugin id. Read from the ring's counters, not from a store.
- The 13 console sites under `plugins/`.
- `packages/create-acorn-plugin/` template: one `ctx.log.info` in the scaffold's `init`.

Out: a history view (refused with SQLite persistence); a per-plugin consent toggle (refused).

## Design detail

**The bridge verb is the frame's whole telemetry API.** Frames already have `ui`, `state`,
`subscribe`, and `api`. One more verb with the record shape keeps the sandbox SDK small, and the rate
window means a frame in a loop kills itself before the ring notices.

**The summary is counters, not records.** The ring is 5,000 records and a sink may have drained it.
The collector keeps per-owner, per-kind counts since boot and a drop count, which cost one map
increment per record and answer the question the page asks: is it on, what is it seeing, who is
reading it.

**The recorder is a sink.** `makeTestNodeContext` subscribes an array-pushing sink and exposes the
array. Nothing in the collector is test-specific.

## Code touched

- `packages/client-core/src/host/frames/sdk.ts`, `broker.ts`, `frameServices.ts`.
- `packages/plugin-api/src/client.ts`, `packages/plugin-api/src/testkit.ts`,
  `packages/plugin-api/src/surface.snapshot.txt`.
- `packages/node-core/src/testkit/pluginContext.ts`.
- `packages/node-core/src/server/agentTools/pluginAuthoring.ts`.
- `packages/node-core/src/server/routes/telemetry.ts` (new in phase 1) for the summary route;
  `packages/protocol/src/api.ts`; the route registry golden.
- `packages/client-core/src/features/settings/TelemetrySettings.tsx` (new) and the settings page
  registration.
- `packages/create-acorn-plugin/index.mjs` template.
- The console sites under `plugins/`.

## Tests

- Bridge: a frame's `telemetry` message produces a record with the binding's plugin id; an owner in
  the message is overwritten; the rate window kills a flooding frame.
- Testkit: a plugin test asserts a span from `ctx.telemetry.measure` and a log from `ctx.log`.
- Summary route: counts match records emitted; a task-scoped token gets 404.
- The Settings page renders in the jsdom host with a fixture summary.
- `pluginAuthoring.test.ts` asserts the token and members appear in the projection.

## Docs owed

`docs/plugin-authoring.md` (the client half and the bridge), `docs/plugin-map.md` (the client API),
`docs/telemetry.md` (new in phase 0; the summary and the page), `docs/state-ownership.md` (the page).

## Doors left open

1. The summary route's shape is the one a "slow plugins" page would extend with p95 per owner.
2. The recorder exposes raw records, so a snapshot test of a plugin's telemetry is possible.

## Done when

- A loaded plugin's frame calls the `telemetry` verb and a node sink receives the record with the
  plugin's id.
- A plugin test asserts on `ctx.recorded` with no sink of its own.
- Settings → Telemetry shows counts that move when a command runs, and lists the exporter as a sink
  once phase 5 ships.
- `rg "console\." plugins` finds nothing.
- `pnpm lint` and `pnpm test` are green.

## Verify before building

- `sdk.ts` and `broker.ts` switch on `shape.kind` over a closed set of verbs and `overBudget()`
  exists.
- `makeTestNodeContext` in `packages/plugin-api/src/testkit.ts` builds a context through
  `buildPluginContext`.
- `pluginAuthoring.ts` derives the core token list from `NODE_CORE_FACETS`.
