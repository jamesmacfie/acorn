/* @refresh reload */
import { render } from 'solid-js/web'
import { applyNodePlugins } from './activate'
import { createEffect, createRoot, Show } from 'solid-js'
import { PersistQueryClientProvider } from '@tanstack/solid-query-persist-client'
import { Route, Router } from '@solidjs/router'
import App from './App'
import '@acorn/client-core/infra/styles/styles.css'
import { PERSISTED_QUERY_MAX_AGE_MS, shouldPersistQuery } from '@acorn/client-core/infra/persistence/queryPersistence.ts'
import { activeCacheId, activeNodeId, nodeReady, selectActiveNode } from '@acorn/client-core/infra/node/activeNode.ts'
import { clientFor } from '@acorn/client-core/infra/node/fleet.ts'
import { wsOnReconnect } from '@acorn/client-core/infra/node/wsClient.ts'
import { sourceRouteContributions } from '@acorn/client-core/host/registries/sources/sources.ts'
import { projectSurfaceRoutes } from '@acorn/client-core/host/registries/panes/projectSurfaces.ts'
import { syncPluginDistribution } from '@acorn/client-core/host/plugins/distribution.ts'
import { syncPluginContributions } from '@acorn/client-core/host/plugins/syncContributions.ts'
import { watchPluginChanges } from '@acorn/client-core/host/plugins/reload.ts'
import { watchTaskChanges } from '@acorn/client-core/features/tasks/watchTaskChanges.ts'
import { watchConnectionChanges } from '@acorn/client-core/features/integrations/watchConnectionChanges.ts'
import { watchProjectChanges } from '@acorn/client-core/features/projects/watchProjectChanges.ts'
import { watchNodeEvents } from '@acorn/client-core/infra/node/watchNodeEvents.ts'

const noop = () => null

// The renderer's half of a cold-start timeline. `performance.mark` always, because it costs nothing and
// puts the same labels in the devtools performance panel; the console line only when asked, because this
// console is the one a developer has open while using the app.
//
// The switch is localStorage rather than `ACORN_PERF`, which is the environment variable the node and
// the helper read: there is no environment in a webview, and the renderer is loaded by Rust's custom
// scheme rather than spawned. `localStorage.setItem('acorn.perf', '1')` and reload
// (docs/local-development.md § Timing a cold start).
//
// `performance.now()` counts from this document's navigation, so these offsets are the renderer's own
// and start where the helper's ready line left off.
const bootPerf = (() => {
  try {
    return localStorage.getItem('acorn.perf') === '1'
  } catch {
    // A webview with site data blocked. Not a reason to fail a boot over.
    return false
  }
})()
const bootMark = (label: string): void => {
  performance.mark(`acorn:${label}`)
  if (bootPerf) console.log(`[renderer:boot] ${label} +${performance.now().toFixed(0)}ms`)
}
bootMark('script start')

// A WS drop means the client missed events, and there is no cursor into history to replay from, so
// the remedy is to mark everything stale and let whatever is on screen refetch
// (docs/api-reference.md § Events). `refetchType: 'active'` is what keeps that from fanning out
// across every cached query the user cannot currently see. It is also why only the active node's
// client needs invalidating: no other node has a mounted query to refetch.
wsOnReconnect(() => void clientFor(activeCacheId()).client.invalidateQueries({ refetchType: 'active' }))

// Resolve which node to talk to before the first render. Every request is node-addressed now, and the
// shell's onMount side effects (session tracking, pollers) do not sit behind NodeGate's <Show>, so
// rendering first would fire requests with no node selected.
await selectActiveNode()
bootMark('node selected')

// …and then which of that node's plugins are on, before anything renders a pane switcher. A node switch
// re-applies it (App.tsx), which is safe because the plugin host replaces a plugin's contributions rather
// than appending them. Not awaited-and-fatal: `applyNodePlugins` swallows a read failure and leaves the
// full contribution set active, because a node that cannot answer must not cost the owner their UI.
await applyNodePlugins(activeNodeId() ?? undefined)
bootMark('plugins applied')

// Third-party plugin bundles, across the whole fleet rather than just the active node
// (docs/plugins.md). Not awaited: it talks to every remembered node, and a fleet with an offline
// machine in it must not hold up the first paint. The trust dialog is an overlay contribution, so
// whatever it queues renders whenever this settles.
// …and once it settles, register the surfaces every accepted plugin declared
// (docs/plugins.md). Chained rather than awaited for the same reason: a fleet
// with an offline machine in it must not hold up the first paint, and a plugin pane appearing a moment
// after the shell does is the correct trade. Panes read the active node at render, so a node switch needs
// no second pass.
// Chrome (docs/plugins.md) rides the same settle: it is registered from
// the same roster rows, and a plugin that ships descriptors but no client bundle has nothing else to
// wait for.
void syncPluginDistribution().then(syncPluginContributions)

// …and stay reconciled: a node that reloads a plugin in place broadcasts `plugins:changed`, and the
// shell re-runs the two passes above rather than waiting for a restart (docs/plugins.md § The dev loop).
watchPluginChanges()

// The same shape for the task list: every task write on the node broadcasts `tasks:changed`, and this
// window invalidates its cached list whether or not it was the one that wrote
// (docs/plugins.md § Hearing a core event).
watchTaskChanges()

// …and for connected accounts. A credential that stops working demotes itself on the node mid-request,
// so Settings → Integrations and the Sources rail hear about it here rather than at the next 401
// (docs/plugins.md § Hearing a core event).
watchConnectionChanges()
// The rest of the core catalogue (docs/plugins.md § Hearing a core event): projects invalidate their query;
// HEAD, run targets and agent sessions are re-emitted on the client bus for whoever listens.
watchProjectChanges()
watchNodeEvents()

render(
  () => (
    // `keyed` is load-bearing: switching nodes must remount the provider and the shell under it, so a
    // query started against node A cannot resolve into node B's cache (activeNode.ts's invariant).
    <Show when={activeCacheId()} keyed>
      {(nodeId) => {
        const { client, persister } = clientFor(nodeId)
        return (
          <PersistQueryClientProvider
            client={client}
            persistOptions={{
              persister,
              maxAge: PERSISTED_QUERY_MAX_AGE_MS,
              dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
            }}
          >
            <Router root={App}>
              <Route path="/" component={noop} />
              <Route path="/t/:taskId" component={noop} />
              <Route path="/settings/projects" component={noop} />
              {sourceRouteContributions().map((route) => <Route path={route.path} component={noop} />)}
              {/* A loaded plugin's project-scoped surfaces, whose patterns the host minted from the plugin
                  id (client-core/host/registries/commands/corePaths.ts). Read here rather than folded into the line above
                  because they belong to a surface rather than to a rail source, and they arrive later than
                  compiled routes do. The distribution pass settles after the first paint, and this
                  expression is inside the Router's `children` memo, so a route registered then is picked up
                  rather than missed. */}
              {projectSurfaceRoutes().map((route) => <Route path={route.path} component={noop} />)}
            </Router>
          </PersistQueryClientProvider>
        )
      }}
    </Show>
  ),
  document.getElementById('root')!,
)

// After the frame the tree above produced, which is the first thing the owner sees, and separately the
// moment the node answered — the two are far apart today and phase 2 of the performance programme is
// what pulls them apart further on purpose (docs/future/performance/decisions.md § Every host draws
// first).
requestAnimationFrame(() => bootMark('first paint'))
createRoot((dispose) => {
  createEffect(() => {
    if (!nodeReady()) return
    bootMark('nodeReady')
    // One mark, not a subscription: the interesting event is the first time it goes ready, and a
    // reconnect later is not a cold start. Deferred so the effect is not disposed from inside itself.
    queueMicrotask(dispose)
  })
})
