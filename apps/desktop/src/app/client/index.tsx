/* @refresh reload */
import { render } from 'solid-js/web'
import './activate'
import { QueryClient } from '@tanstack/solid-query'
import { PersistQueryClientProvider } from '@tanstack/solid-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { Route, Router } from '@solidjs/router'
import { del, get, set } from 'idb-keyval'
import App from './App'
import '@acorn/client-core/styles.css'
import { shouldPersistQuery } from '@acorn/client-core/persistence/queryPersistence.ts'
import { selectActiveNode } from '@acorn/client-core/node/activeNode.ts'
import { wsOnReconnect } from '@acorn/client-core/wsClient.ts'

// TanStack Query is the client cache (SWR). App is the layout root and renders the panes from
// useParams(); these routes exist only to populate the params.
//
// There is no global 401 handler any more. A 401 used to mean "the GitHub session expired, bounce to
// OAuth"; with bearer auth held by the broker it means the device was revoked, which the broker itself
// observes and reports as a node state (nodeBroker.ts) — not something a query error should navigate on.
const queryClient = new QueryClient({
  // Keep focus refreshes useful without turning every quick app switch into a fan-out across every
  // active query. Domain queries that genuinely need fresher data override this (running checks,
  // integration detail, the one-minute PR-list poll).
  // gcTime must outlive a session so persisted entries survive reload (docs/caching.md 3-tier).
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 30_000,
      gcTime: 1000 * 60 * 60 * 24,
    },
  },
})

// Persist the cache to IndexedDB → instant render from last-known data + offline browsing of
// recently-seen PRs. All user-scoped/private (private data never goes to a shared cache).
const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: 'acorn-cache',
  // Persistence serializes the whole dehydrated cache. A slightly wider coalescing window keeps a
  // burst of PR-prefetch/query updates from repeatedly stringifying the same growing snapshot.
  throttleTime: 5_000,
})
const noop = () => null

// A WS drop means the client missed events, and there is no cursor into history to replay from — so
// the remedy is to mark everything stale and let whatever is on screen refetch
// (docs/vNext/protocol.md § Events). `refetchType: 'active'` is what keeps that from fanning out
// across every cached query the user cannot currently see.
wsOnReconnect(() => void queryClient.invalidateQueries({ refetchType: 'active' }))

// Resolve which node to talk to BEFORE the first render. Every request is node-addressed now, and the
// shell's onMount side effects (session tracking, pollers) do not sit behind NodeGate's <Show>, so
// rendering first would fire requests with no node selected.
await selectActiveNode()

render(
  () => (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24,
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
  ),
  document.getElementById('root')!,
)
