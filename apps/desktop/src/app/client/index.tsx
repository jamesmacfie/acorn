/* @refresh reload */
import { render } from 'solid-js/web'
import { applyNodePlugins } from './activate'
import { Show } from 'solid-js'
import { PersistQueryClientProvider } from '@tanstack/solid-query-persist-client'
import { Route, Router } from '@solidjs/router'
import App from './App'
import '@acorn/client-core/styles.css'
// Monaco's worker wiring, once, before any pane can construct an editor.
import '@acorn/client-core/editor/monacoSetup.ts'
import { PERSISTED_QUERY_MAX_AGE_MS, shouldPersistQuery } from '@acorn/client-core/persistence/queryPersistence.ts'
import { activeCacheId, activeNodeId, selectActiveNode } from '@acorn/client-core/node/activeNode.ts'
import { clientFor } from '@acorn/client-core/node/fleet.ts'
import { wsOnReconnect } from '@acorn/client-core/wsClient.ts'
import { sourceRouteContributions } from '@acorn/client-core/registries/sources.ts'
import { syncPluginDistribution } from '@acorn/client-core/plugins/distribution.ts'

const noop = () => null

// A WS drop means the client missed events, and there is no cursor into history to replay from — so
// the remedy is to mark everything stale and let whatever is on screen refetch
// (docs/api-reference.md § Events). `refetchType: 'active'` is what keeps that from fanning out
// across every cached query the user cannot currently see — and it is also why only the active node's
// client needs invalidating: no other node has a mounted query to refetch.
wsOnReconnect(() => void clientFor(activeCacheId()).client.invalidateQueries({ refetchType: 'active' }))

// Resolve which node to talk to BEFORE the first render. Every request is node-addressed now, and the
// shell's onMount side effects (session tracking, pollers) do not sit behind NodeGate's <Show>, so
// rendering first would fire requests with no node selected.
await selectActiveNode()

// …and then which of that node's plugins are on, before anything renders a pane switcher. A node switch
// re-applies it (App.tsx), which is safe because the plugin host replaces a plugin's contributions rather
// than appending them. Not awaited-and-fatal: `applyNodePlugins` swallows a read failure and leaves the
// full contribution set active, because a node that cannot answer must not cost the owner their UI.
await applyNodePlugins(activeNodeId() ?? undefined)

// Third-party plugin bundles, across the whole fleet rather than just the active node
// (docs/third-party/phase-2-distribution-trust.md). Deliberately NOT awaited: it talks to every
// remembered node, and a fleet with an offline machine in it must not hold up the first paint. The
// trust dialog is an overlay contribution, so whatever it queues renders whenever this settles.
void syncPluginDistribution()

render(
  () => (
    // `keyed` is load-bearing: switching nodes must REMOUNT the provider and the shell under it, so a
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
            </Router>
          </PersistQueryClientProvider>
        )
      }}
    </Show>
  ),
  document.getElementById('root')!,
)
