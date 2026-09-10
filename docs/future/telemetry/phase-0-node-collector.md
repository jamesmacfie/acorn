# Phase 0: the node collector

Status: in progress, 2026-09-10. Waits on nothing.

## Goal

The node has a telemetry collector, a logger, and a scrubber. Every plugin context on both tiers
carries `ctx.telemetry` and `ctx.log` with the owner bound by the host. A plugin that declares the
`telemetry` core token can subscribe to batches. The `telemetry.enabled` pref is the switch, off by
default, and off costs one boolean read. The `ACORN_PERF=1` request line and histograms still print,
now as a built-in console sink. Every HTTP request, scheduled run, hook handler, and plugin dispatch
is a span with an owner; every uncaught route error and every process-level crash is an error record.
The node's own `console.*` sites log through the logger, and a rule keeps them there.

## Why this phase, and why now

Everything else in the folder is either a producer feeding this collector or a consumer reading from
it. It also carries the one change of stance, `ctx.log` coming back, and the migration that is
cheapest to do before more console sites are written.

## Scope

In:

- `packages/protocol/src/telemetry.ts` (new): the record and batch schemas, `TELEMETRY_PREF_KEY`,
  `parseTraceparent`. An exports-map line in `packages/protocol/package.json`.
- `packages/node-core/src/server/telemetry/collector.ts` (new): ring, sinks, flush, histograms,
  `PERF`, `SIGUSR2`, start and stop, the emit verbs, `telemetryFor(owner)`.
- `packages/node-core/src/server/telemetry/logger.ts` (new): `createLogger`, `describeError`, the
  `ACORN_PERF` console sink.
- `packages/node-core/src/server/telemetry/scrub.ts` (new): token patterns, path collapsing, control
  characters, the 2,000-character cap.
- `packages/node-core/src/server/perf.ts` deleted; its three importers repointed.
- Instrumentation at the request middleware, `onServerError`, the scheduler, the hook runner, the
  plugin dispatcher, and background refresh failures.
- `ctx.telemetry` and `ctx.log` on `NodePluginContext`; `CoreServices.telemetry` behind the
  `telemetry` token; the trust prompt line; the published twin; the facade surface.
- Crash handlers in `apps/node/src/composition/crash.ts` (new), installed once per process.
- The console migration in `packages/node-core/src` and `apps/node/src`, and the architecture rule.

Out: the renderer, the route that receives its batches, and every other runtime (phases 1 and 3);
ambient context (phase 2); the frame verb and the testkit recorder (phase 4); the exporter (phase 5).

## Design detail

As [02-model.md](./02-model.md) and [03-seams.md](./03-seams.md). The points that need a decision
at build time:

**The collector is a module singleton.** `packages/node-core/src/server/pluginHost/capabilities.ts`
gives two reasons the capability registry is not one: a second boot would throw "already provided",
and `Env` reaches every route. Neither applies. A second `startTelemetry()` resets the ring and
re-reads the pref, and the collector stays off `Env`: plugins reach it only through `ctx.telemetry`
and `ctx.core.telemetry`. It has the same lifecycle shape as `wsHub`'s channel slots and the hooks
maps. Threading it would not work anyway: `requestIdMiddleware` is a module-level middleware,
`createApp()` takes no arguments, and `perf.ts` is already a singleton imported at load by the
request middleware, `core/git.ts`, and `storage/sqlite.ts`.

**Zero cost when off.** `telemetryEnabled()` is `PERF || (sinks.size > 0 && prefEnabled)`. The flush
timer, unref'd like the scheduler's, runs only while a sink is subscribed or `PERF` is on, and the
pref is re-read once per tick because `PUT /v2/core/prefs` writes the table directly and cannot
notify. With no sink there is no timer and no SELECT. A flipped switch is seen within five seconds.

**The pref needs a user.** `core.prefs.read(userId, key)` with `userId` from `ACTIVE_IDENTITY.get()`,
which is bound in `makeRuntime`. `startTelemetry` runs after `createCoreServices` and before
`initPlugins`, so a plugin can subscribe in `init`. A null identity means disabled, never a throw.

**Emit verbs are safe before start.** `respond.ts` is imported before any composition root runs.
Every verb defaults to disabled and never throws.

**The request span owns by path.** `c.req.routePath` is reliable only in `finally`, which is where
the middleware already reads it. The owner comes from `c.req.path` matching `/v2/p/<id>`, never from
a header, because a plugin route can 404 before it matches and a header is attacker input.

**`onServerError` keeps withholding.** Its comment explains why `err.message` never reaches the log:
drivers embed bound values. The error record carries `name` and `code` and no message or stack.

**The guard loop is left alone.** `pluginHost/context.ts` wraps every function member of the
registry groups so a revoked context throws. `telemetry` and `log` are not added to that list: a
logger that throws after a reload breaks the fire-and-forget rule. The comment there says so.

**The logger writes through `console.error` and `console.warn`.** Thirty-one node tests spy on those
(`pluginHost/host.test.ts`, `server/plugins/loader.test.ts`, `pluginHost/hooks.test.ts`, `respond.test.ts`,
and the plugin loader integration test). A logger that wrote to `process.stderr` would pass them
vacuously. `info` and `debug` go to `console.error` too, because stdout is a wire in the standalone
entry and the helper. The collector never imports the logger; the logger imports the collector.

**Crash handlers change exit behaviour by existing.** Any `uncaughtException` listener suppresses
Node's default stack print and exit. `installCrashHandlers` prints the stack as Node would, races a
flush against one second, and calls `process.exit(1)` for both `uncaughtException` and
`unhandledRejection`. It is installed once per process from `apps/node/src/entries/service.ts` and
`apps/node/src/entries/standalone.ts`, not from `startServiceRuntime`, which boots three times per
process in its own test.

**Two files stay off the logger.** `apps/node/src/entries/standalone.ts` prints the handshake JSON on
stdout and the lifecycle tests read it; it stays in the rule's baseline with a comment. The
`[service:boot]` marks in `apps/node/src/composition/runtime.ts` move from stdout to stderr, which
the desktop boot test does not read (it reads the helper's `[helper:boot]` lines).

## Code touched

- `packages/protocol/src/telemetry.ts` (new), `packages/protocol/src/telemetry.test.ts` (new),
  `packages/protocol/package.json` exports.
- `packages/node-core/src/server/telemetry/collector.ts` (new), `logger.ts` (new), `scrub.ts` (new),
  and a test beside each.
- `packages/node-core/src/server/perf.ts`: deleted. `packages/node-core/src/server/respond.ts`,
  `packages/node-core/src/server/core/git.ts`, `packages/node-core/src/server/storage/sqlite.ts`:
  repointed, comments fixed.
- `packages/node-core/src/server/respond.ts`: the span, `traceparent`, `c.set('trace', …)`, the
  error record in `onServerError`. `packages/node-core/src/server/middleware/auth.ts`: `AppEnv`
  gains `trace?`.
- `packages/node-core/src/server/schedules/scheduler.ts` `#runOnce`;
  `packages/node-core/src/server/pluginHost/hooks.ts` `note()`;
  `packages/node-core/src/server/pluginHost/dispatch.ts`; `packages/node-core/src/server/background.ts`.
- `packages/node-core/src/server/pluginHost/types.ts`, `context.ts`: the two members.
  `packages/node-core/src/server/core/index.ts` and `core/telemetry.ts` (new): the read facet.
  `packages/node-core/src/server/plugins/permissions.ts`: `SIMPLE_FACETS.telemetry`.
  `packages/client-core/src/host/trust/permissions.ts`: the trust line.
- `packages/plugin-types/src/public.ts`, `contract.test.ts`; `packages/plugin-api/src/node.ts`;
  `packages/plugin-api/src/surface.snapshot.txt` regenerated.
- `apps/node/src/composition/runtime.ts`, `apps/node/src/entries/standalone.ts`: start, flush, stop.
  `apps/node/src/composition/crash.ts` (new) and its test; `apps/node/src/entries/service.ts`.
- The 81 console sites under `packages/node-core/src` and `apps/node/src`.
- `tools/arch/boundaries.test.ts`: the console rule.
- `docs/contribution-kinds.md`: two rows.

## Tests

- `packages/protocol/src/telemetry.test.ts` (new): each kind parses; a nested attribute is refused;
  `parseTraceparent` accepts the W3C form and rejects wrong lengths and versions.
- `packages/node-core/src/server/telemetry/collector.test.ts` (new), fake timers: disabled means no
  record and no timer and an inert span handle; enabled needs a sink and the pref; the ring drops
  oldest and counts drops; flush at 500 and at five seconds; `measureMs` aggregates to the six
  numbers; `owner` from attrs is overwritten by the host's; a throwing or rejecting sink is contained;
  `stopTelemetry` flushes; `PERF` enables with no sink and installs `SIGUSR2` once.
- `packages/node-core/src/server/telemetry/logger.test.ts` (new): the line format; `warn` goes to
  `console.warn`; a record is emitted only when enabled; `describeError` has no stack.
- `packages/node-core/src/server/telemetry/scrub.test.ts` (new): a bearer token, a `ghp_` token, a
  home path, a data-root path, a control character, a 3,000-character message.
- `apps/node/src/composition/crash.test.ts` (new): records, flushes, prints, exits 1; the flush
  timeout is honoured.
- `packages/node-core/src/server/respond.test.ts`: the `http.request` span carries the route pattern,
  status, `owner: 'core'` for a core route and the id for `/v2/p/<id>`, and the request id;
  `traceparent` is honoured and a malformed one ignored; the existing "`db exploded` never reaches the
  log" case extends to the sink.
- `packages/node-core/src/server/schedules/scheduler.test.ts`: a `schedule.run` span with the owner
  from the key. `packages/node-core/src/server/pluginHost/hooks.test.ts`: a `hook.run` span per
  handler with `handler.pluginId`.
- `packages/node-core/src/testkit/pluginContext.test.ts`: `ctx.telemetry` is owner-bound and
  `ctx.log` present on both tiers; `ctx.core.telemetry` is absent without the token and present with
  `permissions: { core: ['telemetry'] }`.
- `packages/node-core/src/server/plugins/permissions.test.ts`,
  `packages/node-core/src/server/agentTools/pluginAuthoring.test.ts`,
  `packages/plugin-types/src/contract.test.ts` (the member count moves from 10 to 12),
  `packages/client-core/src/host/trust/permissionLines.test.ts`.
- `tools/arch/boundaries.test.ts`: the console rule with its baseline and an anti-vacuity floor.
  `tools/arch/contributionKinds.test.ts` passes once the two rows exist. The plugin goldens record
  routes, tools, sections, providers, and databases, so they stay green; run them without
  `UPDATE_PLUGIN_GOLDENS` to confirm.

## Docs owed

Per [docs-migration.md](./docs-migration.md), the phase 0 rows: `docs/telemetry.md` (new) and its
`docs/README.md` row, `docs/plugins.md` (three sections), `docs/plugin-authoring.md` (two),
`docs/plugin-map.md`, `docs/contribution-kinds.md`, `docs/performance.md`,
`docs/local-development.md`, `docs/security.md`, `docs/state-ownership.md`, `docs/api-reference.md`,
`docs/architecture-overview.md`, `docs/testing.md`.

## Doors left open

1. Against [02-model.md](./02-model.md): the batch schema does not require `owner` on a record, so a
   renderer batch can be stamped on arrival in phase 1.
2. Against [03-seams.md](./03-seams.md): `measure` takes an owner argument, so phase 2's ambient
   context replaces `'core'` at the git and SQL seams without changing the call shape.
3. The collector's `onBatch` is the whole sink contract. Phase 4's testkit recorder and phase 5's
   exporter are both sinks.
4. `TelemetryBatch` carries `node` and `version`, so a fleet with several nodes reads apart.

## Done when

- A vitest sink registered through `onBatch` receives an `http.request` span with `owner: 'core'`
  for a core route and the plugin id for a plugin route, a `schedule.run` span, a `hook.run` span,
  and a `log` record written through `ctx.log`.
- With the pref off and no sink, a request produces no record and `measure` costs one boolean read.
- `ACORN_PERF=1 pnpm dev:node` prints the same `[perf:request]` lines as before, and `kill -USR2`
  prints the same histogram table.
- `rg "console\.(log|warn|error|info|debug)" packages/node-core/src apps/node/src` finds only the
  logger and the standalone handshake.
- The trust prompt for a plugin declaring `core: ['telemetry']` shows the high line, not "1 node
  permission request this version of acorn does not recognise".
- `pnpm lint` and `pnpm test` are green.

## Verify before building

- `packages/node-core/src/server/perf.ts` exists, exports `PERF`, `recordDuration`, `timed`,
  `dumpPerf`, and is imported by `respond.ts`, `core/git.ts`, `storage/sqlite.ts`, and
  `apps/node/src/composition/runtime.ts`.
- `respond.ts` `requestIdMiddleware` reads `x-request-id` through `requestIdSchema` and prints the
  `[perf:request]` line with `routePath || path`, status, ms, bytes, and the request id.
- `pluginHost/context.ts` has a guard loop over a fixed list of registry group names, and
  `buildPluginContext` receives the plugin name in `options.plugin`.
- `server/plugins/permissions.ts` has `SIMPLE_FACETS`, `NODE_CORE_FACETS`, and `scopeCore`;
  `packages/client-core/src/host/trust/permissions.ts` has `NODE_CORE_DESCRIPTIONS` and a fallback
  line for an unknown token.
- `packages/plugin-types/src/contract.test.ts` hard-codes the published member count.
- `apps/node/src/composition/runtime.ts` calls `createCoreServices` before `initPlugins` and
  `dumpPerf('drain')` in `stop()`; `NODE_DRAIN_ORDER` is asserted by a parity test.
- `apps/node/src/entries/standalone.ts` prints the handshake JSON with `console.log`.
