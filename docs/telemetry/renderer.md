# Renderer telemetry

This page covers how the desktop renderer collects and posts records, how one click becomes one
trace, how a contribution gets an owner, and every renderer seam. Read it before you add a client
seam. It's part of [telemetry](../telemetry.md). The terminal client reuses this emitter
([runtimes](./runtimes.md#other-runtimes)).

## The emitter

The renderer collects the same five kinds with the same verbs
(`packages/client-core/src/infra/telemetry/emitter.ts`) and posts them to the Node. It holds at most
1,000 records and flushes at 500 or every five seconds, whichever comes first. A failed post puts its
records back at the front of the queue, so an unreachable Node costs the oldest records first.
Switching off discards the queue, and a late failure can't restore records from an earlier consent
period.

Posts are split by encoded UTF-8 bytes to fit the route's one-mebibyte limit. A single oversized
record is replaced with a drop counter. If a later part fails, a retry may deliver an earlier part
again. Delivery is best effort, without deduplication.

There's no scrubber in the renderer. A browser can't know this machine's home directory or data root,
the two prefixes worth collapsing, so the Node scrubs every posted record again as it arrives.

## One trace per interaction

A command or a page change opens an interaction, and every request the renderer sends while one is open
carries a `traceparent`. A click, the requests it caused, and what the Node did for each are one trace:
the command span is the root, the renderer's `api.request` span its child, and the Node's
`http.request` span a child of that.

A lifecycle operation caused by an open interaction joins it as a child. The same operation opened
directly becomes the interaction root, so requests and render probes still correlate. Agent center,
sidebar, session, and subagent views use this seam, so a session selection that mounts a sidebar stays
one trace.

The interaction is a module variable, not an async context, because the renderer has no
`AsyncLocalStorage`. Work that continues after the span ends gets no parent. That's a known
imprecision. A request made outside an interaction still carries a `traceparent` naming its own
`api.request` span, so the Node's span links back to the window that asked.

### The page change is a signal write, not a navigation

Routes mount a no-op component, and `App.tsx` draws from `selectedSource()` and `activeTaskId()`, so
there's no router event to hang a span on. `nav.change` starts where the signal is written and ends on
the second `requestAnimationFrame`: the first frame is the one the browser was going to paint anyway,
and the second is the first with the new content. Two writes inside one change collapse into one span,
because opening a task writes both signals. A region still fetching at that frame isn't covered.
`pane.region` measures that.

## An owner on a contribution that never declared one

Eight client contribution types carry no plugin id, such as a pane, a source, a slot, and a settings
page. `Registry` in `packages/client-core/src/kit/lib/state/registry.ts` keeps the owner in a side map
instead, filled by the three passes that know it, and `ownerOf(id)` answers for the seams. A field on
each type would have meant changing every registration site for something only telemetry reads.

Compiled plugins are stamped by `makeContext`, and loaded plugins by the descriptor pass in
`host/chrome/chromeRegister.ts` and the frame pass in `host/frames/register.ts`. Core registers without
one, `ownerOf` answers `undefined`, and the seams read that as `core`.

## Renderer seams

Paths are under `packages/client-core/src` unless they start with `apps/`.

| Seam | Where | What it emits |
| --- | --- | --- |
| Every request that leaves the renderer | `infra/node/apiClient.ts` `send()` | Span `api.request` with method, route namespace, status, and `responseBytes`. Sets `traceparent` and `x-request-id` |
| Slow renderer-helper calls | `apps/desktop/src/shell/bridge.ts` `call()` | A `bridge.call` histogram for every call, and a console diagnostic over one second splitting helper, queue, parse, and continuation time |
| Every failed query and mutation | `infra/node/fleet.ts` `clientFor` | A handled error with the first two key segments |
| Every inbound WebSocket frame | `infra/node/wsClient.ts` `dispatch` | Histogram `ws.inbound.<channel prefix>` |
| Every command | `host/registries/commands/commands.ts` `executeCommand` | Span `command`, owner from `ownerId`. Opens an interaction |
| Every page change | `features/tasks/pageChange.ts` | Span `nav.change`. Opens an interaction |
| Consequential view lifecycle | `infra/telemetry/emitter.ts` `startOperation` | A child span under an open interaction, or an interaction root |
| Opted-in state transitions | `infra/telemetry/emitter.ts` `startRenderTransition` | One `ui.render` child span with turn, first-frame, and paint-frame durations |
| Opted-in initial list construction | `infra/telemetry/emitter.ts` `measureRenderBatch` | One `ui.render.batch` span per operation and turn |
| Every pane region | `host/registries/panes/panes.ts` `drawLayout` | Span `pane.region`, from the request to the child's mount |
| Every pane model build | `host/registries/panes/paneModels.ts` | Span `pane.model`. A cache hit isn't timed |
| Every plugin frame boot | `host/frames/PluginFrame.tsx` | Span `frame.boot`, ended on the frame's first message. An error on the ten-second deadline |
| Every bridge message | `host/frames/broker.ts` | Histogram `bridge.message.<kind>`. Event `bridge.overbudget` when the limiter trips |
| Every remote tree apply | `host/tree/treeState.ts` | Histogram `tree.apply`, owned by the tree's plugin |
| Every plugin channel frame | `host/plugins/pluginChannel.ts` | Histogram `plugin.frame` |
| Every contribution that throws while rendering | `kit/components/content/ContributionBoundary.tsx` | A handled error with its stack, contribution id, and owner |
| Every place a followed timeline puts the reader | `kit/components/content/Timeline.tsx` | Event `ui.scroll.place` with the cause, the anchored turn, the offsets, the heights, and whether it was following |
| Every large diff or timeline becoming ready or going away | `kit/lib/telemetry/surfaceHealth.ts` | Histograms `ui.surface.*` ([surface health](./surface-health.md)) |
| Page counts, every 30 seconds while visible | `infra/telemetry/pageFacts.ts` | Gauges `ui.page.*` ([memory over a day](./diagnosis.md#memory-over-a-day)) |
| Every diff segment cache access and change | `features/diff/segmentCache.ts`, `segmentLoader.ts` | Histograms `diff.segment_cache.*`, labelled only by `reason` and with no key, path, or text |
| A diff pane's first plain rows | `features/diff/DiffPane.tsx` | Histogram `diff.first_plain`, labelled only by `cache` |
| Every delivered notice | `features/notifications/deliver.ts` | Event `notice.delivered` with the kind and whether it landed read |
| The boot account | `apps/desktop/src/client/boot.ts` | Span `renderer.boot` with a `renderer.boot.mark` child per mark, built once the switch is on and the Node is ready |
| Uncaught error or rejection | `apps/desktop/src/client/index.tsx` | A fatal error with its stack |
| Console lines | Everywhere under client-core and the desktop client and shell | Log records through `createLogger(tag)` |

`@acorn/protocol/telemetry` owns `apiRouteNamespace`. The request seam and the desktop bridge both use
it to group `/v1/p/<plugin>` requests by plugin without recording full paths.

The `ui.scroll.place` causes are `opened`, a list mounting or swapping, `unasked`, a move neither the
reader nor the timeline made, and `took`, the reader's place changing without them, which happens only
when their turn has left the list. The diff cache histograms are `.hit`, `.miss`, `.insert`, `.evict`,
`.evicted_rows`, `.evicted_bytes`, `.oversize`, and the resident `.documents`, `.segments`, `.rows`,
`.plain_bytes`, and `.enrichment_bytes` ([resident segments](../diff-rendering.md#resident-segments)).
