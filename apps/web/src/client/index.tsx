/* @refresh reload */
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/solid-query'
import { Route, Router } from '@solidjs/router'
import App from './App'
import './styles.css'

// A revoked/expired token surfaces as a 401 / reauth / unauthenticated error from any read or
// write → bounce to the OAuth login (docs/api-structure.md error layer). The `me` query returns
// null on 401 (logged-out) so it never trips this.
const onError = (err: unknown) => {
  const msg = err instanceof Error ? err.message : ''
  if (/\b401\b|reauth|unauthenticated/.test(msg)) window.location.href = '/auth/login'
}

// TanStack Query is the client cache (SWR). App is the layout root and renders the panes from
// useParams(); these routes exist only to populate the params.
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: { queries: { refetchOnWindowFocus: true } },
})
const noop = () => null

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Router root={App}>
        <Route path="/" component={noop} />
        <Route path="/:owner/:repo" component={noop} />
        <Route path="/:owner/:repo/:number" component={noop} />
      </Router>
    </QueryClientProvider>
  ),
  document.getElementById('root')!,
)
