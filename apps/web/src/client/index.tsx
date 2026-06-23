/* @refresh reload */
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import App from './App'
import './styles.css'

// TanStack Query is the client cache (SWR + optimistic updates). Router is omitted until
// there are routes to register (docs/research-stack.md keyboard/nav plan).
const queryClient = new QueryClient()

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  ),
  document.getElementById('root')!,
)
