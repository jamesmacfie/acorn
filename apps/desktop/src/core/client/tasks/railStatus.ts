// Rail status markers — one source of truth for the small icons overlaid on a task row AND the
// legend in its hover tooltip (docs/workspaces-and-tasks.md). Each entry is a marker shown only
// while its condition holds: the rail overlay renders it positioned (`overlayCls`), the tooltip
// re-renders the same glyph next to what it means, so hovering both reports the task's live state
// and teaches the icon. Pure/view-only — callers resolve the reactive inputs and pass them in.
import type { TaskStatus } from '../../shared/terminal'

export type RailChecks = 'success' | 'failure' | 'pending' | 'mixed'

export type RailStatusInputs = {
  checks: RailChecks | null // null when the task has no PR / no checks
  working: number // agents currently running in the task
  unread: boolean // an agent left an unread notification
  status: TaskStatus | undefined // live worktree status (dirty / missing)
}

export type RailStatusItem = {
  key: string
  label: string
  overlayCls: string // positioned class(es) for the rail overlay
  glyph?: string // text glyph; omitted for the CI dot (which is a coloured circle)
  dotCls?: string // 'checks-dot checks-dot-…' — the CI dot, self-coloured
  tone?: 'accent' | 'warn' | 'del' // legend glyph colour
}

const CHECKS_LABEL: Record<RailChecks, string> = {
  success: 'CI checks passing',
  failure: 'CI checks failing',
  pending: 'CI checks running',
  mixed: 'CI checks: some failed, some still running',
}

export function railStatusItems({ checks, working, unread, status }: RailStatusInputs): RailStatusItem[] {
  const items: RailStatusItem[] = []
  if (checks)
    items.push({ key: 'checks', label: CHECKS_LABEL[checks], overlayCls: `tabrail-checks checks-dot checks-dot-${checks}`, dotCls: `checks-dot checks-dot-${checks}` })
  if (working) items.push({ key: 'working', label: `${working} agent${working > 1 ? 's' : ''} working`, overlayCls: 'tabrail-spinner spin', glyph: '⠿', tone: 'accent' })
  if (unread) items.push({ key: 'needs', label: 'An agent needs you — unread notifications', overlayCls: 'tabrail-needs', glyph: '‼', tone: 'warn' })
  // Dirty and missing are mutually exclusive: a vanished worktree can't report a file count.
  if (status?.missing) items.push({ key: 'repair', label: 'Worktree missing — needs repair', overlayCls: 'tabrail-dirty tabrail-repair', glyph: '⚠', tone: 'del' })
  else if (status?.dirty) items.push({ key: 'dirty', label: `Uncommitted changes (${status.dirtyCount})`, overlayCls: 'tabrail-dirty', glyph: '✎', tone: 'warn' })
  return items
}
