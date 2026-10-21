import { createQuery, useQueryClient } from '@tanstack/solid-query'
import type { AppState, SavedState } from '../embed/appState'

/** The saved state every view of an app in this window shares, a card and the pane at once included,
 *  kept in one query cache entry (docs/agent-built-apps.md § App state). */
export function createSavedState(nodeId: string, appId: string, load: () => Promise<AppState>): SavedState {
  const queryClient = useQueryClient()
  const key = ['trellis-state', nodeId, appId]
  const query = createQuery(() => ({
    queryKey: key,
    queryFn: load,
    // Views of this window write the cache themselves; another window's ticks arrive on the next open.
    staleTime: Infinity,
  }))
  return {
    loading: () => query.isPending,
    current: () => (query.isSuccess ? query.data : undefined),
    set: (state) => queryClient.setQueryData(key, state),
  }
}
