import type { RollbarItemSummary, RollbarOccurrenceDetail, RollbarOccurrenceSummary } from '../../../core/shared/api'

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

// Sort orders: latest occurrence (default), raw volume, or severity. Null timestamps sink to the
// bottom; unknown levels rank below debug. Stable across equal keys.
export type RollbarSortOrder = 'recent' | 'occurrences' | 'level'
const LEVEL_RANK: Record<string, number> = { critical: 0, error: 1, warning: 2, info: 3, debug: 4 }
const levelRank = (level: string) => LEVEL_RANK[level] ?? 5
export function sortRollbarItems(items: readonly RollbarItemSummary[], order: RollbarSortOrder = 'recent'): RollbarItemSummary[] {
  return [...items].sort((a, b) => {
    if (order === 'occurrences') return b.totalOccurrences - a.totalOccurrences
    if (order === 'level') {
      const byLevel = levelRank(a.level) - levelRank(b.level)
      if (byLevel !== 0) return byLevel
    }
    return (b.lastOccurrenceAt ?? 0) - (a.lastOccurrenceAt ?? 0)
  })
}

// An item regressed when Rollbar reactivated it after a resolve: last_activated later than first seen.
export const isRegressed = (item: RollbarItemSummary): boolean =>
  item.lastActivatedAt != null && item.firstOccurrenceAt != null && item.lastActivatedAt > item.firstOccurrenceAt

// Who/where rollup over the cached occurrence sample (at most the last 50 — label it honestly).
export type RollbarImpact = {
  sample: number
  users: number
  environments: Array<{ name: string; count: number }>
  versions: Array<{ name: string; count: number }>
  last24h: number
}
const countBy = (values: Array<string | null>): Array<{ name: string; count: number }> => {
  const counts = new Map<string, number>()
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}
export function rollbarImpact(occurrences: readonly RollbarOccurrenceSummary[], now: number): RollbarImpact {
  return {
    sample: occurrences.length,
    users: new Set(occurrences.map((o) => o.personUsername).filter(Boolean)).size,
    environments: countBy(occurrences.map((o) => o.environment)),
    versions: countBy(occurrences.map((o) => o.codeVersion)),
    last24h: occurrences.filter((o) => o.occurredAt != null && now - o.occurredAt <= 86_400_000).length,
  }
}

// Map a stack-frame filename to a worktree-relative path for the editor. Build tooling prefixes the
// real path; strip the common ones and refuse absolute paths we cannot anchor.
// ponytail: naive prefix heuristic; upgrade path is verifying candidates against the repo file listing.
const FRAME_ROOTS = ['/app/', '/usr/src/app/', '/var/task/']
export function frameRepoPath(filename: string): string | null {
  let path = filename.replace(/^webpack:\/{2,3}/, '').replace(/\?.*$/, '')
  path = path.replace(/^\.\//, '')
  if (path.startsWith('/')) {
    const root = FRAME_ROOTS.find((prefix) => path.startsWith(prefix))
    if (!root) return null
    path = path.slice(root.length)
  }
  return path && !path.startsWith('<') ? path : null
}

// Plain-text block for pasting an error into a task terminal / agent prompt: exception, in-project
// frames first, then the environment facts. Pure so the exact shape is unit-tested.
export function agentContext(item: RollbarItemSummary | undefined, occurrence: RollbarOccurrenceDetail): string {
  const lines: string[] = []
  if (item) lines.push(`Rollbar #${item.identifier} [${item.level}] ${item.title}`, '')
  if (occurrence.exceptionClass || occurrence.message) {
    lines.push(`${[occurrence.exceptionClass, occurrence.message].filter(Boolean).join(': ')}`)
  }
  const frames = occurrence.frames.filter((f) => f.inProject !== false).slice(0, 15)
  for (const frame of frames) {
    lines.push(`  at ${frame.filename}${frame.line != null ? `:${frame.line}` : ''}${frame.method ? ` (${frame.method})` : ''}`)
  }
  const facts = [
    occurrence.environment && `environment: ${occurrence.environment}`,
    occurrence.codeVersion && `version: ${occurrence.codeVersion}`,
    occurrence.request?.url && `request: ${[occurrence.request.method, occurrence.request.url].filter(Boolean).join(' ')}`,
    occurrence.context && `context: ${occurrence.context}`,
    item?.totalOccurrences != null && `occurrences: ${item.totalOccurrences}`,
    (item?.url ?? occurrence.url) && `link: ${item?.url ?? occurrence.url}`,
  ].filter(Boolean)
  if (facts.length) lines.push('', ...(facts as string[]))
  return lines.join('\n')
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
