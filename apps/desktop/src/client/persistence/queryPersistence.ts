import { defaultShouldDehydrateQuery, type Query, type QueryKey } from '@tanstack/solid-query'

// File bodies and patch-bearing file queries are reconstructable from the loopback API/blob cache
// and dominate IndexedDB size. Summaries remain useful offline because they contain no patch body.
export const shouldPersistQueryKey = (key: QueryKey): boolean => {
  if (key[0] === 'blob') return false
  if (key[0] === 'files' && key[4] !== 'summary') return false
  return true
}

// Supplying a custom TanStack dehydration predicate replaces its default predicate. Preserve the
// success-state gate explicitly: pending queries contain live Promises that cannot survive JSON
// persistence, while failed queries are not useful offline cache entries.
export const shouldPersistQuery = (query: Query): boolean =>
  defaultShouldDehydrateQuery(query) && shouldPersistQueryKey(query.queryKey)
