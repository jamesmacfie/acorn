// Core's rail status markers: one source of truth for the icons overlaid on a task row and the
// legend in its hover tooltip. Each entry shows only while its condition holds. RailTab places
// them and renders the same glyph beside its meaning in the tooltip, so a hover both reports state
// and teaches the icon. Pure; callers resolve the reactive inputs.
//
// "An agent is working here" is not in this list. That belongs to the agents plugin, which knows about
// both managed sessions and terminal harnesses, and it publishes it through the same marker registry.
// Uncommitted changes are not here either: the git plugin publishes its added/removed dot. Nor are CI
// checks, which the code host's plugin publishes for its change requests.
//
// Priorities here sit above the range contributed markers are clamped to
// (RAIL_MARKER_PLUGIN_MAX_PRIORITY), so a plugin marker can never push a core lifecycle state out of
// its corner. The numbers are policy, not data: depend on the relative order, not the literals.
import type { TaskStatus } from '@acorn/protocol/task.ts'
import type { RailMarker } from '../tabs/railMarkers'

export type RailStatusInputs = {
  unread: boolean // an unread notice for this task, from any source
  status: TaskStatus | undefined // live worktree status (missing)
  archiving: boolean // guarded teardown in flight for this task
  settingUp: boolean // the project's setup script is still running in this task's new worktree
  pinned: boolean // held at the top of the rail
}

export function railStatusMarkers({ unread, status, archiving, settingUp, pinned }: RailStatusInputs): RailMarker[] {
  const markers: RailMarker[] = []
  // Teardown owns the slot under the task's glyph on its own. Anything it outranks stays in the
  // tooltip rather than vanishing.
  if (archiving)
    markers.push({
      id: 'archiving',
      label: 'Archiving — removing the worktree',
      icon: 'loader-circle',
      tone: 'danger',
      busy: true,
      placements: ['bottom-center'],
      priority: 300,
    })
  // The other end of the same life cycle, in the same slot: a worktree being prepared rather than
  // removed. A pulsing dot rather than a spinner, because setup is the task's own first job and not
  // something being done to it. Ranked under teardown, which is the allocator's job to settle if the
  // two ever overlap.
  if (settingUp)
    markers.push({
      id: 'setup',
      label: 'Setup script running',
      dotTone: 'ok',
      busy: true,
      placements: ['bottom-center'],
      priority: 290,
    })
  if (unread)
    markers.push({
      id: 'needs',
      label: 'Unread notifications',
      icon: 'circle-alert',
      tone: 'warn',
      placements: ['top-end', 'bottom-start'],
      priority: 280,
    })
  if (status?.missing)
    markers.push({
      id: 'repair',
      label: 'Worktree missing — needs repair',
      icon: 'triangle-alert',
      tone: 'danger',
      placements: ['bottom-end', 'bottom-start'],
      priority: 260,
    })
  if (pinned)
    markers.push({
      id: 'pinned',
      label: 'Pinned to top',
      icon: 'pin',
      tone: 'warn',
      placements: ['top-start', 'bottom-start'],
      priority: 240,
    })
  return markers
}
