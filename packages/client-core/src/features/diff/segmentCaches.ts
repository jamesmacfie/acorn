import type { QueryClient } from '@tanstack/solid-query'
import type { SegmentCache } from './segmentCache'

// Which node holds which segment cache, kept apart from the cache itself because infra/node/fleet.ts
// drops a node's entry and is on the renderer's startup graph. Importing ./segmentCache there put the
// diff model, jsdiff and the patch parser on that graph too.
//
// Keyed by the query client rather than by node id, so a pane reads the partition it is already
// drawing from, the provider's, and two nodes cannot share one by construction.
export const segmentCaches = new WeakMap<QueryClient, SegmentCache>()

/** Forget a node's segments, synchronously. Called with the rest of the node's cache. */
export function dropSegmentCache(client: QueryClient): void {
  segmentCaches.get(client)?.clear()
  segmentCaches.delete(client)
}
