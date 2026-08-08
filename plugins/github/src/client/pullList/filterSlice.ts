import { parseJson, PersistedSliceKeys, type PersistedStateSlice, PrefKeys } from '@acorn/plugin-api/client'
import { hydratePrFilter, prFilters, type PrFilter } from './filterState'

// The PR list's own persisted-state descriptor: tab + text filter, per workspace. Owned here rather
// than in core so core never has to know which features persist state (docs/plugins.md); registered
// by this plugin's own ClientPlugin init (client/index.ts).
const parsePrFilter = (raw: unknown): PrFilter => {
  const value = parseJson(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { tab: 'open', filter: '' }
  const source = value as { tab?: unknown; filter?: unknown }
  return {
    tab: source.tab === 'closed' ? 'closed' : 'open',
    filter: typeof source.filter === 'string' ? source.filter : '',
  }
}

export const prFiltersSlice: PersistedStateSlice<PrFilter> = {
  id: 'github.pr-filters',
  key: PersistedSliceKeys.prFilters,
  scope: 'workspace',
  restore: 'view',
  version: 1,
  codec: { parse: parsePrFilter, serialize: (filter) => filter },
  empty: () => ({ tab: 'open', filter: '' }),
  unknownIds: 'drop',
  maxBytes: 4 * 1024,
  binding: { values: prFilters, hydrate: hydratePrFilter },
  legacy: (prefs) => {
    const value = parseJson(prefs[PrefKeys.prFilters])
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  },
}
