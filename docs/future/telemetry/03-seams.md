# The seams: where a hook goes, per runtime

Part of [docs/future/telemetry/](./README.md). Four reads of the tree on 2026-09-10 found every place
acorn already logs, times, or catches, and every choke point where one edit sees all the traffic of a
kind. This file is that map, with what each seam emits and which phase adds it. Line numbers were true
on that date; run each phase's verify list before trusting them.

## What exists today

There is no logger. Every log line in the repo is a `console.*` call with a hand-written `[tag]`
prefix, about 200 sites, and nothing is written to a file except the terminal client's key trace.
There is no `window.onerror`, no `unhandledrejection` handler, no `process.on('uncaughtException')`,
and no Rust panic hook. There is no `AsyncLocalStorage` anywhere.

What does exist, and what the programme builds on:

- `packages/node-core/src/server/perf.ts`: `timed(seam, run)` and per-seam histograms behind
  `ACORN_PERF=1`, zero cost when off, dumped on `SIGUSR2`. Three seams use it: the request
  middleware, `core/git.ts`, and `storage/sqlite.ts`. Phase 0 folds it into the collector and keeps
  its console output byte for byte.
- `packages/node-core/src/server/respond.ts` `requestIdMiddleware`: the outermost middleware, mints
  or honours `x-request-id`, already wraps `next()` in try/finally with `hrtime`, and reads
  `c.req.routePath` so a hundred task ids read as one route.
- `packages/node-core/src/server/audit.ts`: a closed action vocabulary, allowlisted scalar details,
  fire-and-forget writes. The privacy template for every record here.
- `packages/node-core/src/server/pluginHost/hooks.ts` `note()`: already records `{at, ms, outcome}`
  per hook handler for the developer view. A span in all but name.
- `packages/node-core/src/server/schedules/scheduler.ts` `#runOnce`: already brackets
  `startedAt`/`finishedAt` and a closed status set. Same.
- The renderer boot marks in `apps/desktop/src/client/index.tsx` (`performance.mark`, first paint on
  a `requestAnimationFrame`) and the helper's `packages/custody/src/bootMarks.ts`. The template for a
  page-change span.
- The terminal client's `ACORN_TUI_KEYS_TRACE` in `apps/tui/src/keys/install.ts`: a `key:after`
  intercept that writes through an appending stream because a synchronous write on the loop that
  draws "is a trace that measures itself". The template for anything on the paint path.

## Node

| Seam | File | Emits | Owner from | Phase |
| --- | --- | --- | --- | --- |
| Every HTTP request | `packages/node-core/src/server/respond.ts` `requestIdMiddleware` | span `http.request` {method, route, status, bytes, request.id}; parses `traceparent` | `/v2/p/<id>` in the path, else `core` | 0 |
| Every uncaught route error | `respond.ts` `onServerError` | error {name, code}, no message, no stack | the request's | 0 |
| Every error envelope | `respond.ts` `respondError` | nothing in phase 0; 5xx are already the span's status | | |
| Every scheduled run | `packages/node-core/src/server/schedules/scheduler.ts` `#runOnce` | span `schedule.run` {schedule.key, schedule.reason, status} | key prefix via `keyOwner` | 0 |
| Every hook handler | `packages/node-core/src/server/pluginHost/hooks.ts` `note()` | span `hook.run` {hook.point, hook.handler, hook.outcome} | `handler.pluginId` | 0 |
| Every in-process plugin dispatch (schedules, hooks, task checks, collections, run sources) | `packages/node-core/src/server/pluginHost/dispatch.ts` `dispatchPluginRoute` | span `plugin.dispatch` {method, path, status} | the `pluginId` argument | 0 |
| Every loaded-plugin HTTP request | `packages/node-core/src/server/pluginHost/fetchRoute.ts` `servePluginFetch` | nothing extra; the middleware's span already owns it by path | | |
| Every `ctx.*` call a plugin makes | `packages/node-core/src/server/pluginHost/context.ts` guard loop | nothing. Left alone on purpose: the guard throws on a revoked context, and `ctx.log` must never throw | | |
| Every background refresh failure | `packages/node-core/src/server/background.ts` `trackBackgroundRefresh` | error {label}, handled | `core` until phase 2 | 0 |
| Every git spawn | `packages/node-core/src/server/core/git.ts` | histogram `git.<subcommand>` | `core` until phase 2, then the ambient owner | 0, 2 |
| Every SQL statement | `packages/node-core/src/server/storage/sqlite.ts` | histogram `sql.<verb>` | same | 0, 2 |
| Every process spawn | `packages/node-core/src/server/core/proc.ts` `runProcess` | histogram `proc.spawn`; event on timeout or truncation | ambient | 2 |
| Every sync decision | `packages/node-core/src/server/sync/engine.ts` `serveThenRevalidate` | count `sync.<fresh\|stale\|cold>` {resource} | ambient, plus the provider id in the label | 2 |
| Every outbound WebSocket frame and every shed | `packages/node-core/src/server/transport/wsHub.ts` `wsBroadcast`, `sendFrame` | histogram `ws.frame` {channel prefix}; event `ws.shed` | `core`, or the plugin id from a `plugin:` channel | 2 |
| Every agent tool call | `packages/node-core/src/server/routes/plugins/agentTools.ts` `invoke()` | span `tool.call` {tool, outcome} | the tool's owner | 2 |
| Every audit row | `packages/node-core/src/server/audit.ts` `recordAudit` | event `audit.<action>` | the row's | 2 |
| Every workflow run and step | `plugins/workflows/src/server/workflowRunner.ts` `start`, `execute`, `finishRun` | spans `workflow.run`, `workflow.step` {run.id, step.id, status} | `workflows`, via `ctx.telemetry` | 2 |
| Every agent session and turn | `plugins/agents/src/server/sessions/sessionExecute.ts`, `runtimeEngine.ts` | spans `agent.turn`, `agent.session` {session.id, provider, outcome} | `agents`, via `ctx.telemetry` | 2 |
| Uncaught exception, unhandled rejection | `apps/node/src/composition/crash.ts` (new), installed from the two entries | error, fatal, unhandled, with stack; flush; exit 1 as Node would | `core` | 0 |
| Console lines | 81 sites in `packages/node-core/src` and `apps/node/src` | log records through `createLogger(tag)` | `core` | 0 |

## Renderer

| Seam | File | Emits | Owner from | Phase |
| --- | --- | --- | --- | --- |
| Every request that leaves the renderer | `packages/client-core/src/infra/node/apiClient.ts` `send()` and `raise()` | span `api.request` {method, route, status}; sets `traceparent` and `x-request-id` | the current interaction's trace; owner `core` unless called through a frame's `fetch` | 1 |
| Every query and mutation failure | `packages/client-core/src/infra/node/fleet.ts` `clientFor` | error {query.key prefix}, handled, via `QueryCache`/`MutationCache` `onError` | `core` | 1 |
| Every inbound WebSocket frame | `packages/client-core/src/infra/node/wsClient.ts` `dispatch` | histogram `ws.inbound` {channel prefix} | | 1 |
| Every command | `packages/client-core/src/host/registries/commands/commands.ts` `executeCommand` | span `command` {command.id, outcome}; opens an interaction trace | `command.ownerId`, else `core` | 1 |
| Every page change | `packages/client-core/src/features/tasks/activate.ts` `activateTaskSignals`, `features/tasks/tasks.ts` `setSelectedSource` | span `nav.change` {to: task\|source, source.id}; ends on the second `requestAnimationFrame` after the switch; opens an interaction trace | `core`, or the source's owner | 1 |
| Every pane region mount | `packages/client-core/src/host/registries/panes/panes.ts` `drawLayout` per-region `Suspense` | span `pane.region` {pane.id, pane.region} from region creation to the child's `onMount`, so a suspended region is measured to content | the pane's owner from the registry side-map | 1 |
| Every pane model build | `packages/client-core/src/host/registries/panes/paneModels.ts` `paneModel` | span `pane.model` {pane.id} | same | 1 |
| Every plugin frame boot | `packages/client-core/src/host/frames/PluginFrame.tsx` handshake | span `frame.boot` {plugin.surface}; error on the 10 s deadline | `binding.pluginId` | 1 |
| Every bridge message | `packages/client-core/src/host/frames/broker.ts` `port.onmessage` | histogram `bridge.message` {kind}; event `bridge.overbudget` | `binding.pluginId` | 1 |
| Every remote tree apply | `packages/client-core/src/host/tree/treeState.ts` `TreeScheduler.schedule` | histogram `tree.apply` | `pluginId` | 1 |
| Every plugin channel frame | `packages/client-core/src/host/plugins/pluginChannel.ts` `route` | histogram `plugin.frame` | `parsePluginChannel` | 1 |
| Every contribution that throws while rendering | `packages/client-core/src/kit/components/content/ContributionBoundary.tsx` | error {contribution.id}, handled | registry side-map | 1 |
| Every client contribution registration | `packages/client-core/src/kit/lib/registry.ts` `Registry.register` | nothing; gains an `ownerOf(id)` side-map filled by `host/chrome/chromeRegister.ts`, `host/frames/register.ts`, and `host/registries/extensionPoints/plugin.ts` `makeContext`, so the seams above can name an owner | | 1 |
| Every delivered notice | `packages/client-core/src/features/notifications/deliver.ts` `deliverNotice` | event `notice.delivered` {kind, seen} | | 1 |
| Uncaught error, unhandled rejection | `apps/desktop/src/client/index.tsx` | error, unhandled, with stack | `core` | 1 |
| Console lines | 52 sites in `packages/client-core/src`, 12 in `apps/desktop/src` | log records | `core` | 1 |

Records leave the renderer in batches to `POST /v2/core/telemetry` (new route) through the same
`send()`, marked so the batch request does not itself produce a span. Offline, the renderer holds at
most 1,000 records and drops the oldest.

## Terminal client

The terminal client paints its own cells and has no frame rate: `apps/tui/src/tree/frames.ts`
`requestFrame` coalesces signal writes into one frame, and `apps/tui/src/renderer.ts` emits a `frame`
event after each. Stderr is the drawing surface, so `apps/tui/src/main.tsx` holds console lines until
exit.

| Seam | File | Emits | Phase |
| --- | --- | --- | --- |
| Every frame | `apps/tui/src/renderer.ts` `frame()` | histogram `tui.frame` {layout, paint, flush split if cheap} | 3 |
| Every key | `apps/tui/src/keys/install.ts` `key:after` intercept | histogram `tui.key` {steps} | 3 |
| Held console lines | `apps/tui/src/main.tsx` | log records through the logger; the held-lines mechanism stays for stderr | 3 |
| Boot marks | `apps/tui/src/main.tsx` `bootMark` | spans, one per mark interval | 3 |

The terminal client is client-core in-process with custody, so it posts batches the same way the
renderer does.

## Desktop helper

| Seam | File | Emits | Phase |
| --- | --- | --- | --- |
| Boot marks | `packages/custody/src/bootMarks.ts` `helperMark` | spans, one per interval, under one `helper.boot` root | 3 |
| Every proxied request | `packages/custody/src/broker/nodeBroker.ts` | histogram `broker.request` {node} | 3 |
| Reconnect, degraded, shed, missed pong | `nodeBroker.ts` | events | 3 |
| Crash budget | `packages/custody/src/supervision/crashBudget.ts` `recordCrash` | event `node.crash` {count}; error when the budget is exhausted | 3 |
| Renderer-to-helper calls | `apps/desktop/src/shell/bridge.ts` `call` | histogram `bridge.call` {method} | 3 |
| Console lines | 26 sites in `packages/custody/src` | log records; stdout stays a wire and is never routed | 3 |

The helper holds the device token and the broker connection, so it posts its own batches to the
node over the same route.

## Rust shell

Nothing today: `apps/desktop/src-tauri/src/lib.rs` has no `panic::set_hook`, and a panic is a
silent process death that only the crash budget notices. Phase 3 installs a panic hook that writes
one JSON record to `<dataRoot>/shell-crash.json`; the helper reads and deletes it on its next boot and
posts it as a fatal error with `runtime: shell`. The shell has no network path of its own and should
not gain one for this.
