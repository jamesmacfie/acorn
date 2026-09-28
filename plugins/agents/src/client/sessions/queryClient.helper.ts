// Tests only. The pane model reads the custom agents through the query cache, as the host's pane
// models do (client-core paneModels.ts keeps the query client in scope), so a test builds it inside
// one. Queries are off, so nothing reaches for a node.
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'

export function withQueryClient<T>(build: () => T): T {
  let built!: T
  QueryClientProvider({
    client: new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } }),
    get children() {
      built = build()
      return null
    },
  })
  return built
}
