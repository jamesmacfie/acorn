// What survives of the browse's list model, now that the browse is a host-drawn descriptor rail.
//
// `client/model.ts` filtered, sorted, grouped and faceted the loaded issue set client-side. A rail row
// is data the host renders, with no filter inputs, facet selects, or state columns, so the filter,
// group and facet halves lost their only caller and are gone (docs/integrations.md § Linear). Ordering
// and the priority projection did not: the rail is still a list, so something has to decide row order,
// and it moved to the node because that is where the rows are now built.
//
// Both halves are used from both runtimes, the node sorts and labels rows, the frame labels the open
// ticket, so this sits in shared/ rather than in either.

export type LinearPriorityFields = { priority: number | null; updatedAt: number | null }

// Linear priority is 0 (none) / 1 (urgent) … 4 (low). Urgent first, "none" sinks to the bottom, then
// most-recently-updated within equal priority.
const priorityRank = (p: number | null) => (p == null || p === 0 ? 5 : p)

export function sortLinearIssues<T extends LinearPriorityFields>(issues: readonly T[]): T[] {
  return [...issues].sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
    if (byPriority !== 0) return byPriority
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
  })
}

// Maps Linear's numeric priority to a stable level key (drives the bar glyph via a data attribute) and
// a display label (prefers Linear's own priorityLabel when present).
export type PriorityLevel = 'urgent' | 'high' | 'medium' | 'low' | 'none'
const PRIORITY_FALLBACK: Record<PriorityLevel, string> = { urgent: 'Urgent', high: 'High', medium: 'Medium', low: 'Low', none: 'No priority' }

export function priorityMeta(priority: number | null | undefined, priorityLabel?: string | null): { level: PriorityLevel; label: string } {
  const level: PriorityLevel =
    priority === 1 ? 'urgent' : priority === 2 ? 'high' : priority === 3 ? 'medium' : priority === 4 ? 'low' : 'none'
  return { level, label: priorityLabel || PRIORITY_FALLBACK[level] }
}
