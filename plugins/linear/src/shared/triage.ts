// Ordering and the priority projection for the browse list. A rail row is data the host renders, with
// no filter inputs, facet selects, or state columns, so the filter, group, and facet halves are gone
// (docs/integrations.md § Linear). Ordering stays, because the rail is still a list.
//
// Both runtimes use both halves: the node sorts and labels rows, the frame labels the open ticket. So
// this sits in shared/.

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

// Status is a toned badge with a word (docs/ui-design/states.md § States). The tone comes from Linear's fixed
// state type, never the colour a team picked, so "In Progress" reads the same in every workspace. The
// word stays the team's own name. `Badge` has no muted tone, so canceled is neutral.
export type StatusTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'
const STATE_TONE: Record<string, StatusTone> = { triage: 'warn', started: 'accent', completed: 'ok' }
export const stateTone = (type: string | undefined): StatusTone => (type && STATE_TONE[type]) || 'neutral'
export const priorityTone = (level: PriorityLevel): StatusTone =>
  level === 'urgent' ? 'danger' : level === 'high' ? 'warn' : 'neutral'
