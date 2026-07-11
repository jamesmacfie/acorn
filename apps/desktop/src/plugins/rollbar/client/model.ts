import type { RollbarItemSummary } from '../../../core/shared/api'

// Pure list model for the Rollbar Source browse (docs/frontend.md). P1 filters the loaded active set
// locally; server-side query syntax is P2. Kept side-effect-free so it is trivially unit-tested.

export type RollbarFilter = { search: string; connectionId: string; level: string; environment: string }
export const emptyRollbarFilter: RollbarFilter = { search: '', connectionId: '', level: '', environment: '' }

export function filterRollbarItems(items: readonly RollbarItemSummary[], filter: RollbarFilter): RollbarItemSummary[] {
  const q = filter.search.trim().toLowerCase()
  const counterQ = q.replace(/^#/, '')
  return items.filter((it) => {
    if (filter.connectionId && it.integrationId !== filter.connectionId) return false
    if (filter.level && it.level !== filter.level) return false
    if (filter.environment && it.environment !== filter.environment) return false
    if (!q) return true
    return it.title.toLowerCase().includes(q) || (counterQ.length > 0 && it.identifier.includes(counterQ))
  })
}

// Latest occurrence first; null timestamps sink to the bottom. Stable across equal timestamps.
export function sortRollbarItems(items: readonly RollbarItemSummary[]): RollbarItemSummary[] {
  return [...items].sort((a, b) => (b.lastOccurrenceAt ?? 0) - (a.lastOccurrenceAt ?? 0))
}

export type RollbarFacets = {
  connections: Array<{ id: string; label: string }>
  levels: string[]
  environments: string[]
}

export function rollbarFacets(items: readonly RollbarItemSummary[]): RollbarFacets {
  const connections = new Map<string, string>()
  const levels = new Set<string>()
  const environments = new Set<string>()
  for (const it of items) {
    connections.set(it.integrationId, it.integrationLabel || it.integrationId)
    if (it.level) levels.add(it.level)
    if (it.environment) environments.add(it.environment)
  }
  return {
    connections: [...connections].map(([id, label]) => ({ id, label })),
    levels: [...levels].sort(),
    environments: [...environments].sort(),
  }
}
