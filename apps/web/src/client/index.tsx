/* @refresh reload */
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { Route, Router } from '@solidjs/router'
import App from './App'
import PullList from './PullList'
import './styles.css'

// TanStack Query is the client cache (SWR + optimistic updates). App is the layout root;
// the route param drives which repo's PRs render in the left pane.
const queryClient = new QueryClient()

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Router root={App}>
        <Route path="/" component={() => <p class="placeholder">Select a repo.</p>} />
        <Route path="/:owner/:repo" component={PullList} />
      </Router>
    </QueryClientProvider>
  ),
  document.getElementById('root')!,
)
