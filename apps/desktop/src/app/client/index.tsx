/* @refresh reload */
import { render } from 'solid-js/web'
import { applyNodePlugins } from './activate'
import { Show } from 'solid-js'
import { PersistQueryClientProvider } from '@tanstack/solid-query-persist-client'
import { Route, Router } from '@solidjs/router'
import App from './App'
import '@acorn/client-core/styles.css'
import { PERSISTED_QUERY_MAX_AGE_MS, shouldPersistQuery } from '@acorn/client-core/persistence/queryPersistence.ts'
import { activeCacheId, activeNodeId, selectActiveNode } from '@acorn/client-core/node/activeNode.ts'
import { clientFor } from '@acorn/client-core/node/fleet.ts'
import { wsOnReconnect } from '@acorn/client-core/wsClient.ts'

// TanStack Query is the client cache (SWR). App is the layout root and renders the panes from
// useParams(); these routes exist only to populate the params.
//
// There is no global 401 handler any more. A 401 used to mean "the GitHub session expired, bounce to
// OAuth"; with bearer auth held by the broker it means the device was revoked, which the broker itself
// observes and reports as a node state (nodeBroker.ts) — not something a query error should navigate on.
//
// The QueryClient and its IndexedDB persister are no longer built here: there is one of each PER NODE,
// built by node/fleet.ts, and only the active node's provider is mounted. See that file for why the
// partition lives in the client rather than in a nodeId-prefixed query key.
const noop = () => null

// A WS drop means the client missed events, and there is no cursor into history to replay from — so
// the remedy is to mark everything stale and let whatever is on screen refetch
// (docs/vNext/protocol.md § Events). `refetchType: 'active'` is what keeps that from fanning out
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
              <Route path="/:owner/:repo" component={noop} />
              <Route path="/:owner/:repo/new" component={noop} />
              <Route path="/:owner/:repo/:number" component={noop} />
            </Router>
          </PersistQueryClientProvider>
        )
      }}
    </Show>
  ),
  document.getElementById('root')!,
)
