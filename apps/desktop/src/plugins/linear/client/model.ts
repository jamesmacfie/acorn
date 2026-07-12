import type { LinearProjectIssue } from '../../../core/shared/api'

// Pure list model for the Linear Source browse (mirrors rollbar/client/model.ts). Filters/sorts/groups
// the loaded active set locally — Linear is one GraphQL call per browse load, so triage is all
// client-side. Kept side-effect-free so it is trivially unit-tested.

export type LinearFilter = { search: string; assignee: string; label: string }
export const emptyLinearFilter: LinearFilter = { search: '', assignee: '', label: '' }

export function filterLinearIssues(issues: readonly LinearProjectIssue[], filter: LinearFilter): LinearProjectIssue[] {
  const q = filter.search.trim().toLowerCase()
  const idQ = q.replace(/^#/, '')
  return issues.filter((it) => {
    if (filter.assignee && (it.assignee ?? '') !== filter.assignee) return false
    if (filter.label && !it.labels.some((l) => l.name === filter.label)) return false
    if (!q) return true
    return it.title.toLowerCase().includes(q) || it.identifier.toLowerCase().includes(idQ)
  })
}

// Linear priority is 0 (none) / 1 (urgent) … 4 (low). Urgent first, "none" sinks to the bottom, then
// most-recently-updated within equal priority.
const priorityRank = (p: number | null) => (p == null || p === 0 ? 5 : p)
export function sortLinearIssues(issues: readonly LinearProjectIssue[]): LinearProjectIssue[] {
  return [...issues].sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
    if (byPriority !== 0) return byPriority
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  })
}

// Board-style grouping by workflow-state type (matches how Linear presents columns). Preserves the
// incoming order within each group, so feed it the already-sorted list.
const STATE_ORDER = ['started', 'unstarted', 'backlog', 'triage']
const STATE_LABEL: Record<string, string> = { started: 'In Progress', unstarted: 'Todo', backlog: 'Backlog', triage: 'Triage' }
export type LinearGroup = { key: string; label: string; issues: LinearProjectIssue[] }
export function groupLinearIssuesByState(issues: readonly LinearProjectIssue[]): LinearGroup[] {
  const byType = new Map<string, LinearProjectIssue[]>()
  for (const it of issues) {
    const type = it.state?.type ?? 'other'
    const list = byType.get(type)
    if (list) list.push(it)
    else byType.set(type, [it])
  }
  const rank = (type: string) => {
    const i = STATE_ORDER.indexOf(type)
    return i === -1 ? STATE_ORDER.length : i
  }
  return [...byType.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([key, list]) => ({ key, label: STATE_LABEL[key] ?? `${key.charAt(0).toUpperCase()}${key.slice(1)}`, issues: list }))
}

export type LinearFacets = { assignees: string[]; labels: string[] }
export function linearFacets(issues: readonly LinearProjectIssue[]): LinearFacets {
  const assignees = new Set<string>()
  const labels = new Set<string>()
  for (const it of issues) {
    if (it.assignee) assignees.add(it.assignee)
    for (const l of it.labels) labels.add(l.name)
  }
  return { assignees: [...assignees].sort(), labels: [...labels].sort() }
}

// Maps Linear's numeric priority to a stable level key (drives the bar glyph via a data attribute)
// and a display label (prefers Linear's own priorityLabel when present).
export type PriorityLevel = 'urgent' | 'high' | 'medium' | 'low' | 'none'
const PRIORITY_FALLBACK: Record<PriorityLevel, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' }
export function priorityMeta(priority: number | null | undefined, priorityLabel?: string | null): { level: PriorityLevel; label: string } {
  const level: PriorityLevel =
    priority === 1 ? 'urgent' : priority === 2 ? 'high' : priority === 3 ? 'medium' : priority === 4 ? 'low' : 'none'
  return { level, label: priorityLabel || PRIORITY_FALLBACK[level] }
}
