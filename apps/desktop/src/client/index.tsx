/* @refresh reload */
import { PaneModelHost } from '@acorn/client-core/host/registries/panes/PaneModelHost.tsx'
import { reportResponsiveness } from '@acorn/client-core/infra/platform'
import { startPageFacts, startResponsivenessMonitor } from '@acorn/client-core/infra/telemetry'
import { render } from 'solid-js/web'
import { applyNodePlugins, startClientPlugins } from './activate'
import { createEffect, createRoot, Show } from 'solid-js'
import { QueryCacheProvider } from '@acorn/client-core/infra/persistence/QueryCacheProvider.tsx'
import { Route, Router } from '@solidjs/router'
import App from './App'
import '@acorn/client-core/infra/styles/styles.css'
import { activeCacheId, activeNodeId, nodeReady, selectActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
import { clientFor, nodes, nodeState } from '@acorn/client-core/infra/node/fleet.ts'
import { wsOnReconnect } from '@acorn/client-core/infra/node/wsClient.ts'
import { sourceRouteContributions } from '@acorn/client-core/host/registries/sources'
import { projectSurfaceRoutes } from '@acorn/client-core/host/registries/panes'
import { startClientRuntime } from '@acorn/client-core/host/clientRuntime.ts'
import { emitError, flushTelemetry } from '@acorn/client-core/infra/telemetry/emitter.ts'
import { bootMark, emitBootSpans } from './boot'
import { markFirstFrame } from './startupMilestones'
import { startDesktopLinks } from './links'
import { setRegionPlaceholder } from '@acorn/client-core/host/layouts'
import { RegionLoading } from '@acorn/client-core/host/layouts/RegionLoading.tsx'

const noop = () => null

// The runtime both clients share: telemetry, the node event watchers, notices, client schedules and
// device config sync (client-core/host/clientRuntime.ts). First, so a seam that fires during boot has
// somewhere to put its record (docs/telemetry/renderer.md § The emitter). Nothing here waits on it, and
// it lives as long as the window does.
void startClientRuntime({ runtime: 'renderer', app: 'desktop', client: () => clientFor(activeCacheId()).client })
const stopResponsiveness = startResponsivenessMonitor(reportResponsiveness)
window.addEventListener('pagehide', stopResponsiveness, { once: true })
// Counts about the page every thirty seconds while collecting, read against the memory the shell
// measures from outside (docs/shell/node-child.md § What the shell reports).
const stopPageFacts = startPageFacts(() => clientFor(activeCacheId()).client)
window.addEventListener('pagehide', stopPageFacts, { once: true })

// The two failures nothing in the app catches. Without these handlers, an error thrown outside a
// component's boundary is a line in a devtools console nobody has open.
//
// Fatal and unhandled, with the stack, which is the one place a client record carries one: an
// uncaught error with no stack is not worth sending anywhere (docs/telemetry/model.md § What never leaves
// the machine).
window.addEventListener('error', (event) => {
  emitError('core', {
    name: event.error instanceof Error ? event.error.name || 'Error' : 'Error',
    message: event.message,
    ...(event.error instanceof Error && event.error.stack ? { stack: event.error.stack } : {}),
    level: 'fatal',
    handled: false,
    attrs: { seam: 'window.error' },
  })
})
window.addEventListener('unhandledrejection', (event) => {
  const reason: unknown = event.reason
  emitError('core', {
    name: reason instanceof Error ? reason.name || 'Error' : 'Error',
    message: reason instanceof Error ? reason.message : String(reason),
    ...(reason instanceof Error && reason.stack ? { stack: reason.stack } : {}),
    level: 'fatal',
    handled: false,
    attrs: { seam: 'window.unhandledrejection' },
  })
})

// The last chance a window gets. `pagehide` rather than `beforeunload`, because a webview being
// closed does not always fire the latter, and the post is fire-and-forget either way: whatever does
// not make it out is a batch the queue has already dropped.
window.addEventListener('pagehide', () => void flushTelemetry())

// The first mark of the cold-start account (./boot.ts).
bootMark('script start')
// What a pane draws while its code loads. The DOM's layouts are the pane registry's default, but its
// placeholder is the host's to supply (client-core/host/layouts/table.ts).
setRegionPlaceholder(RegionLoading)
void startDesktopLinks()

// A WS drop means the client missed events, and there is no cursor into history to replay from, so
// the remedy is to mark everything stale and let whatever is on screen refetch
// (docs/api-reference/websocket.md § Events). `refetchType: 'active'` is what keeps that from fanning out
// across every cached query the user cannot currently see. It is also why only the active node's
// client needs invalidating: no other node has a mounted query to refetch.
wsOnReconnect(() => void clientFor(activeCacheId()).client.invalidateQueries({ refetchType: 'active' }))

// Which node to talk to, started and not awaited. The device remembers the last one
// (node/activeNode.ts), so `activeNodeId()` already answers on this tick and the cache partition below
// is the right one before the helper has said a word; this call confirms it against the fleet and
// re-homes the window if that node has gone. A first-ever launch has nothing to remember, and
// `nodeGateHolds()` puts the onboarding screen up until this resolves.
void selectActiveNode().then(() => bootMark('node selected'))

// Membership can arrive after the loader's first paint. On a first-ever launch the fleet is empty
// when the call above reads it, because the local node has not been adopted yet, and `fleet.ts`
// re-reads membership when the first status for an unknown node lands. This is what turns that into a
// selection; once there is one it is a no-op.
createRoot(() => {
  createEffect(() => {
    if (nodes().length && !activeNodeId()) void selectActiveNode()
  })
})

// Waits for post-paint registration. A failed node read remains retryable when App sees it online.
void applyNodePlugins(activeNodeId() ?? undefined).then(() => bootMark('plugins applied'))

// The node's arrival is behind the loader's first paint. Startup work can still have asked for data
// while nothing was listening, and the first usable status is when those reads are worth asking
// again. `wsOnReconnect` above cannot do this: it deliberately ignores a node's first connect.
//
// `cancelRefetch: false` leaves a request that is already out alone. The shell's own queries wait on
// `nodeReady()`, which turns true on this same status, so they can already be fetching when this runs.
// Cancelling them costs a cancelled request and a duplicate for each one that had cached data.
createRoot(() => {
  createEffect(() => {
    const nodeId = activeNodeId()
    if (!nodeId || nodeState(nodeId) === 'offline') return
    void clientFor(activeCacheId()).client.invalidateQueries({ refetchType: 'active' }, { cancelRefetch: false })
  })
})

render(
  () => (
    // `keyed` is load-bearing: switching nodes must remount the provider and the shell under it, so a
    // query started against node A cannot resolve into node B's cache (activeNode.ts's invariant).
    <Show when={activeCacheId()} keyed>
      {(nodeId) => {
        const cache = clientFor(nodeId)
        return (
          <QueryCacheProvider cache={cache}>
            <PaneModelHost nodeId={activeNodeId()}>
              <Router root={App}>
                <Route path="/" component={noop} />
                <Route path="/t/:taskId" component={noop} />
                <Route path="/settings/projects" component={noop} />
                {sourceRouteContributions().map((route) => (
                  <Route path={route.path} component={noop} />
                ))}
                {/* A loaded plugin's project-scoped surfaces, whose patterns the host minted from the plugin
                    id (client-core/host/registries/commands/corePaths.ts). Read here rather than folded into the line above
                    because they belong to a surface rather than to a rail source, and they arrive later than
                    compiled routes do. The distribution pass settles after the first paint, and this
                    expression is inside the Router's `children` memo, so a route registered then is picked up
                    rather than missed. */}
                {projectSurfaceRoutes().map((route) => (
                  <Route path={route.path} component={noop} />
                ))}
              </Router>
            </PaneModelHost>
          </QueryCacheProvider>
        )
      }}
    </Show>
  ),
  document.getElementById('root')!,
)

// The tree the first frame will draw, finished. `render` returns once Solid has built it, so this is
// the last mark the renderer's own work is responsible for, and it is the one to read when a launch is
// watched from a terminal: a background window never records `first paint` below.
bootMark('tree built')

// After the frame the tree above produced, which is the first thing the owner sees, and separately the
// moment the node could answer. The two are far apart on purpose: nothing between `script start` and
// this frame waits on the helper or the node (docs/frontend/data-and-startup.md § Startup readiness).
// macOS pauses `requestAnimationFrame` while the window is occluded, so this mark is the compositor's
// and not the renderer's: a launch watched from behind another window prints every other mark and not
// this one, which is why `tree built` above exists (docs/local-development/profiling.md § Timing a cold start).
// A task queued from rAF lets this paint finish before importing and registering the roster.
// Occluded windows do not receive rAF on macOS, so they get a bounded fallback as well.
let pluginsStarted = false
const fillIn = () => {
  if (pluginsStarted) return
  pluginsStarted = true
  clearTimeout(pluginFallback)
  void startClientPlugins().then((registered) => {
    if (!registered) return
    bootMark('roster registered')
    return applyNodePlugins(activeNodeId() ?? undefined)
  })
}
const pluginFallback = setTimeout(fillIn, 250)
requestAnimationFrame(() => {
  bootMark('first paint')
  markFirstFrame()
  setTimeout(fillIn, 0)
})
createRoot((dispose) => {
  createEffect(() => {
    if (!nodeReady()) return
    bootMark('nodeReady')
    emitBootSpans()
    // One mark, not a subscription: the interesting event is the first time it goes ready, and a
    // reconnect later is not a cold start. Deferred so the effect is not disposed from inside itself.
    queueMicrotask(dispose)
  })
})
