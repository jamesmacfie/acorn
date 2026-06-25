/* @refresh reload */
import { render } from 'solid-js/web'
import { QueryClient, QueryCache, MutationCache } from '@tanstack/solid-query'
import { PersistQueryClientProvider } from '@tanstack/solid-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { Route, Router } from '@solidjs/router'
import { clear, del, get, set } from 'idb-keyval'
import App from './App'
import './styles.css'

// A revoked/expired token surfaces as a 401 / reauth / unauthenticated error from any read or
// write → bounce to the OAuth login (docs/api-structure.md error layer). The `me` query returns
// null on 401 (logged-out) so it never trips this.
const onError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : ''
  if (/\b401\b|reauth|unauthenticated/.test(msg)) window.location.href = '/auth/login?return_to=' + encodeURIComponent(window.location.pathname + window.location.search)
}

// TanStack Query is the client cache (SWR). App is the layout root and renders the panes from
// useParams(); these routes exist only to populate the params.
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  // gcTime must outlive a session so persisted entries survive reload (docs/caching.md 3-tier).
  defaultOptions: { queries: { refetchOnWindowFocus: true, gcTime: 1000 * 60 * 60 * 24 } },
})

// Persist the cache to IndexedDB → instant render from last-known data + offline browsing of
// recently-seen PRs. All user-scoped/private (private data never goes to a shared cache).
const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: 'acorn-cache',
})
const noop = () => null

render(
  () => (
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}>
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

// Wipe the persisted cache on logout so the next user can't read it (logout posts then reloads).
window.addEventListener('acorn:logout', () => void clear())

// Offline app shell. The SW caches the shell + static assets; data stays in IndexedDB (above).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
