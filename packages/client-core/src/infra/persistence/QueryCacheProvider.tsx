import { createSignal, onCleanup, onMount, type ParentProps } from 'solid-js'
import { IsRestoringProvider, QueryClientProvider } from '@tanstack/solid-query'
import type { NodeCache } from '../node/fleet'

// Restoration gates queries through TanStack's public context. The partition owns durability;
// this mounted host owns only its selection lease.
export function QueryCacheProvider(props: ParentProps<{ cache: NodeCache }>) {
  const [restoring, setRestoring] = createSignal(true)
  let disposed = false
  onMount(() => {
    const lease = props.cache.persistence.acquire()
    onCleanup(lease.release)
    void lease.restored.catch(() => {}).finally(() => {
      if (!disposed && !props.cache.persistence.retired()) setRestoring(false)
    })
  })
  onCleanup(() => { disposed = true })
  return (
    <QueryClientProvider client={props.cache.client}>
      <IsRestoringProvider value={restoring}>{props.children}</IsRestoringProvider>
    </QueryClientProvider>
  )
}
