/* @refresh reload */
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { Route, Router } from '@solidjs/router'
import App from './App'
import './styles.css'

// TanStack Query is the client cache (SWR + optimistic updates). App is the layout root and
// renders the panes from useParams(); these routes exist only to populate the params.
const queryClient = new QueryClient()
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
