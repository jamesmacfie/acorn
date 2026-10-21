import { defaultShouldDehydrateQuery, type Query, type QueryKey, type QueryMeta } from '@tanstack/solid-query'
import {
  integrationsKey,
  modelBackendsKey,
  prefsKey,
  projectsKey,
  runTargetsKey,
  tasksKey,
  workspacesKey,
} from '@acorn/protocol/api.ts'
import { taskScriptsKey } from '@acorn/protocol/taskScripts.ts'

const DAY_MS = 24 * 60 * 60 * 1000

// How old a whole snapshot may be and still be restored: the persister's `maxAge`, measured from its
// last write, which is roughly when the app was quit. A week, so the first launch after a weekend
// away draws last-known rows rather than an empty shell. The per-entry age below bounds what a
// snapshot holds, and it stays at a day.
export const PERSISTED_SNAPSHOT_MAX_AGE_MS = 7 * DAY_MS

// How long one entry is carried from snapshot to snapshot without being refetched. It matches the
// QueryClient's `gcTime` (see `clientFor`), so an entry nobody has looked at for a day leaves
// memory and the snapshot together. A restored week-old entry is drawn once and then dropped at the
// next write unless its screen refetched it.
export const PERSISTED_QUERY_MAX_AGE_MS = DAY_MS

// The first frame draws from these and nothing else: preferences, workspaces, projects, the task list
// with each task's script markers and run buttons, and the lists that name the model backends and
// integrations. Everything else is fetched when its screen opens, so it costs the main thread nothing to
// save and nothing to restore. A key matches by prefix, so a versioned key such as `['tasks', 'v4']`
// follows its constant. A plugin's query that the first frame needs opts in with `meta: { persist: true }`,
// because core can't name a plugin's keys.
const PERSISTED_KEY_PREFIXES: readonly (readonly unknown[])[] = [
  prefsKey,
  workspacesKey,
  projectsKey,
  tasksKey,
  integrationsKey,
  modelBackendsKey,
  runTargetsKey,
  taskScriptsKey,
]

export const shouldPersistQueryKey = (key: QueryKey, meta?: QueryMeta): boolean =>
  meta?.persist === true || PERSISTED_KEY_PREFIXES.some((prefix) => prefix.every((part, at) => key[at] === part))

// Supplying a custom TanStack dehydration predicate replaces its default predicate. Preserve the
// success-state gate explicitly: pending queries contain live Promises that cannot survive JSON
// persistence, while failed queries are not useful offline cache entries. The persister's maxAge
// applies to the snapshot as a whole; without this per-entry gate, opening Acorn regularly refreshes
// the snapshot timestamp and can carry years-old PRs forward forever.
//
// A query that sets `meta: { persist: false }` stays in memory only. Search answers do: restoring one
// after a relaunch would show an old provider answer as though it had just arrived.
export const shouldPersistQuery = (query: Query): boolean =>
  defaultShouldDehydrateQuery(query) &&
  query.meta?.persist !== false &&
  shouldPersistQueryKey(query.queryKey, query.meta) &&
  query.state.dataUpdatedAt >= Date.now() - PERSISTED_QUERY_MAX_AGE_MS
