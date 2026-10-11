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
| The startup milestones | `apps/desktop/src/client/startupMilestones.ts` | Spans `renderer.startup.first_frame`, `.restored`, and `.usable` ([startup milestones](#startup-milestones)) |
| Every pane, source, and Settings opening | `infra/telemetry/featureOpening.ts` | Span `ui.feature.open` ([feature openings](#feature-openings)) |
| Uncaught error or rejection | `apps/desktop/src/client/index.tsx` | A fatal error with its stack |
| Console lines | Everywhere under client-core and the desktop client and shell | Log records through `createLogger(tag)` |

`@acorn/protocol/telemetry` owns `apiRouteNamespace`. The request seam and the desktop bridge both use
it to group `/v1/p/<plugin>` requests by plugin without recording full paths.

The `ui.scroll.place` causes are `opened`, a list mounting or swapping, `unasked`, a move neither the
reader nor the timeline made, and `took`, the reader's place changing without them, which happens only
when their turn has left the list. The diff cache histograms are `.hit`, `.miss`, `.insert`, `.evict`,
`.evicted_rows`, `.evicted_bytes`, `.oversize`, and the resident `.documents`, `.segments`, `.rows`,
`.plain_bytes`, and `.enrichment_bytes` ([resident segments](../diff-rendering/loading.md#resident-segments)).

## Startup milestones

`apps/desktop/src/client/startupMilestones.ts` records four moments of a desktop launch. Each is a
span from the document's navigation, measured with `performance.now()`, recorded once, and in the
same trace as `renderer.boot`:

| Span | Ends when |
| --- | --- |
| `renderer.startup.first_frame` | The first frame the owner could see. The browser's `first-contentful-paint` entry when there is one, labelled `method: 'paint'`. Otherwise the first animation frame callback, labelled `method: 'frame'` and `proxy: true` |
| `renderer.startup.shell` | The startup screen gave way to the shell: the rail, the top bar, and the content region. The first time in the document, whichever Node it was for |
| `renderer.startup.restored` | The saved state has hydrated and the shell has chosen where to land |
| `renderer.startup.usable` | Every feature open at that landing has reported usable, or the landing had none open. Two `renderer.startup.phase` children split it into `restore` and `content`. A launch that stops on a failure or offline screen before it restores ends here too, because that screen is what the person can act on |

`renderer.boot` keeps its endpoint at `nodeReady`. The milestones are separate spans rather than a
redefinition of it.

Every milestone carries `visibility`. It reads `hidden` when the window was hidden at any point before
the milestone. macOS runs no animation frames for an occluded window, so a hidden launch's first frame
lands when the owner uncovers it. Filter on `visibility: visible` before you quote a launch time. The
roster's 250 ms fallback timer in `apps/desktop/src/client/index.tsx` never counts as a frame.

`usable` carries `features`, the number of features it waited for, `proxy`, true when any of them
closed on mount, and `outcome`, the worst of `usable`, `cancelled`, and `timeout`. When the launch
stopped before restoring, `outcome` is `error` or `offline`, `startup.step` names what stopped it
(`node`, `registration`, `reads`, or `offline`), and `features` is 0. An `error` outcome sets the span's
status to `error`. A launch that stopped and then restored after **Try again** still records
`restored`, but keeps the stopped screen as its `usable`.

Each startup failure is also an error record with `seam: 'renderer.startup'` and the same
`startup.step`, sent once per failure by `apps/desktop/src/client/startupStage.ts`.

The milestones are local numbers until the switch turns on. They're emitted then, the same retroactive
rule `renderer.boot` follows. The restored and usable milestones belong to the first shell the window
mounts. A Node switch remounts the shell, which drops any that weren't emitted and records nothing for
the second Node.

## Feature openings

`packages/client-core/src/infra/telemetry/featureOpening.ts` times how long a feature takes to become
usable after the host opens it. The host opens a record where it mounts the feature, and the feature
closes it. The span is `ui.feature.open`, with these attributes:

- `feature.id` and `feature.kind`: a pane ID, a rail source ID, or `settings`.
- `first`: whether this document has opened that feature before. A first opening also loads the
  feature's code. Query-cache warmth is a separate fact, reported as `cached` when the feature knows it.
- `state`: `content`, `empty`, `offline`, or `error`. Each is a usable state. A spinner isn't.
- `proxy: 'mount'`: the feature doesn't report for itself, so the host closed the record when the
  feature's first content mounted. Don't read a proxy as usable time.
- `outcome: 'timeout'`, with status `error`, when nothing closed the record within 30 seconds.

An opening that's closed before it reports, by a task switch or a closed pane, emits nothing. The
module holds one pending record per feature ID and at most 16 in all, never one per task.

These features report for themselves:

| Feature | Owner | Usable when |
| --- | --- | --- |
| Agent pane | `plugins/agents/src/client/sessions/AgentPane.tsx` | The session list answered, and the open session's transcript, the start cards, or an error is on screen |
| Editor pane | `plugins/editor/src/client/editorController.ts` | The checkout answered and the remembered document is editable, or there's no document or no checkout |
| Changes tab | `plugins/git/src/client/changes/ChangesPane.tsx` | The first status read answered, with changes or a clean tree, or the project isn't Git |
| Settings | `packages/client-core/src/features/settings/SettingsView.tsx` | The page's code and the data it read have arrived. The record starts at the request in `apps/desktop/src/client/App.tsx` |

Every other pane and every rail source is a mount proxy. A pane declares `reportsUsable` and calls
`featureUsable` to join the table ([pane contributions](../panes/contributions.md#contributions)).

