// Core's rail status markers: one source of truth for the icons overlaid on a task row and the
// legend in its hover tooltip. Each entry shows only while its condition holds. RailTab places
// them and renders the same glyph beside its meaning in the tooltip, so a hover both reports state
// and teaches the icon. Pure; callers resolve the reactive inputs.
//
// "An agent is working here" is not in this list. That belongs to the agents plugin, which knows about
// both managed sessions and terminal harnesses, and it publishes it through the same marker registry
// (plugins/agents/src/client/railMarkerContribution.ts).
//
// Priorities here sit above the range contributed markers are clamped to
// (RAIL_MARKER_PLUGIN_MAX_PRIORITY), so a plugin marker can never push a core lifecycle state out of
// its corner. The numbers are policy, not data: depend on the relative order, not the literals.
import type { TaskStatus } from '@acorn/protocol/terminal.ts'
import { CHECK_TONE } from '../kit/lib/displayMeta'
import type { RailMarker } from '../tabs/railMarkers'

export type RailChecks = 'success' | 'failure' | 'pending' | 'mixed'

export type RailStatusInputs = {
  checks: RailChecks | null // null when the task has no PR / no checks
  unread: boolean // an unread notice for this task, from any source
  status: TaskStatus | undefined // live worktree status (dirty / missing)
  archiving: boolean // guarded teardown in flight for this task
  pinned: boolean // held at the top of the rail
}

const CHECKS_LABEL: Record<RailChecks, string> = {
  success: 'CI checks passing',
  failure: 'CI checks failing',
  pending: 'CI checks running',
  mixed: 'CI checks: some failed, some still running',
}

export function railStatusMarkers({ checks, unread, status, archiving, pinned }: RailStatusInputs): RailMarker[] {
  const markers: RailMarker[] = []
  // Teardown owns the slot under the task's glyph on its own. It used to blank every other marker
  // while it ran; now anything it outranks stays in the tooltip rather than vanishing.
  if (archiving)
    markers.push({ id: 'archiving', label: 'Archiving — removing the worktree', icon: 'loader-circle', tone: 'accent', busy: true, placements: ['bottom-center'], priority: 300 })
  if (unread)
    markers.push({ id: 'needs', label: 'Unread notifications', icon: 'circle-alert', tone: 'warn', placements: ['top-end', 'bottom-start'], priority: 280 })
  // Dirty and missing are mutually exclusive: a vanished worktree can't report a file count.
  if (status?.missing)
    markers.push({ id: 'repair', label: 'Worktree missing — needs repair', icon: 'triangle-alert', tone: 'danger', placements: ['bottom-end', 'bottom-start'], priority: 260 })
  if (pinned)
    markers.push({ id: 'pinned', label: 'Pinned to top', icon: 'pin', tone: 'warn', placements: ['top-start', 'bottom-start'], priority: 240 })
  if (checks)
    markers.push({ id: 'checks', label: CHECKS_LABEL[checks], dotTone: CHECK_TONE[checks], placements: ['top-end', 'bottom-end'], priority: 200 })
  if (!status?.missing && status?.dirty)
    markers.push({ id: 'dirty', label: `Uncommitted changes (${status.dirtyCount})`, icon: 'pencil', tone: 'warn', placements: ['bottom-end', 'bottom-start'], priority: 180 })
  return markers
}
