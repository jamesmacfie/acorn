import type { QueryClient } from '@tanstack/solid-query'
import { clear } from 'idb-keyval'

// Throw away every cached node answer and reload, from the top bar's menu or Settings → Clear cache.
// The persisted IndexedDB copy goes before the reload, or it would rehydrate the cache it was meant to
// empty.
export async function clearCache(queryClient: QueryClient): Promise<void> {
  queryClient.clear()
  await clear()
  window.location.reload()
}
