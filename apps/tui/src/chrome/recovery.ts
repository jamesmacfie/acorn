import { createEffect, type Accessor } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'

// An error boundary can unmount the observer of the query that made its pane fail. The normal
// reconnect invalidation only refetches active queries, so that failed read needs a second pass
// before the boundary is reset. Keep the pass inside this node's cache partition.
export async function refreshNodeQueries(client: QueryClient): Promise<void> {
  await client.invalidateQueries({ refetchType: 'active' }, { cancelRefetch: false })
  await client.refetchQueries({ type: 'inactive', predicate: (query) => query.state.status === 'error' })
}

export async function retryFailedPane(client: QueryClient, reset: () => void): Promise<void> {
  try {
    await client.refetchQueries({ predicate: (query) => query.state.status === 'error' })
  } finally {
    // A render error may not have come from a query. If the read still fails, the boundary will
    // show the error and its Retry control again.
    reset()
  }
}

export function resetPaneAfterRecovery(recovery: Accessor<number>, reset: () => void): void {
  const failedAt = recovery()
  createEffect(() => {
    if (recovery() > failedAt) reset()
  })
}
