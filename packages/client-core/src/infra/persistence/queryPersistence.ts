import { defaultShouldDehydrateQuery, type Query, type QueryKey } from '@tanstack/solid-query'

const DAY_MS = 24 * 60 * 60 * 1000

// How old a whole snapshot may be and still be restored: the persister's `maxAge`, measured from its
// last write, which is roughly when the app was quit. A week, so the first launch after a weekend
// away draws last-known rows rather than an empty shell. The per-entry age below bounds what a
// snapshot holds, and it stays at a day.
export const PERSISTED_SNAPSHOT_MAX_AGE_MS = 7 * DAY_MS

// How long one entry is carried from snapshot to snapshot without being refetched. It matches the
// QueryClient's `gcTime` (infra/node/fleet.ts), so an entry nobody has looked at for a day leaves
// memory and the snapshot together. A restored week-old entry is drawn once and then dropped at the
// next write unless its screen refetched it.
export const PERSISTED_QUERY_MAX_AGE_MS = DAY_MS

// File bodies and patch-bearing file queries are reconstructable from the loopback API/blob cache
// and dominate IndexedDB size. Summaries remain useful offline because they contain no patch body.
export const shouldPersistQueryKey = (key: QueryKey): boolean => {
  if (key[0] === 'blob') return false
  if (key[0] === 'files' && key[4] !== 'summary') return false
  return true
}

// Supplying a custom TanStack dehydration predicate replaces its default predicate. Preserve the
// success-state gate explicitly: pending queries contain live Promises that cannot survive JSON
// persistence, while failed queries are not useful offline cache entries. The persister's maxAge
// applies to the snapshot as a whole; without this per-entry gate, opening Acorn regularly refreshes
// the snapshot timestamp and can carry years-old PRs forward forever.
export const shouldPersistQuery = (query: Query): boolean =>
  defaultShouldDehydrateQuery(query)
  && shouldPersistQueryKey(query.queryKey)
  && query.state.dataUpdatedAt >= Date.now() - PERSISTED_QUERY_MAX_AGE_MS
