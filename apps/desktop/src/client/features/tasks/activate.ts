import type { Task } from '../../queries'
import { markTaskRead } from '../notifications/notifications'
import { dispatchLayout, layoutForTask, setActiveTaskId, setSelectedSource } from './tasks'
import type { PaneId } from './layout'

// Where a task lives in the router (repo browse, or the PR when it has one).
export function pathForTask(t: Task): string {
  return `/${t.repoOwner}/${t.repoName}${t.pullNumber != null ? `/${t.pullNumber}` : ''}`
}

// Make a task the active one (signals only — the caller navigates to pathForTask). Shared by the
// rail (row click, ⌘1–9, new-task), the browse promotes, the notification bell and the command
// palette so the select behaviour lives once. `options.pane` forces a pane (e.g. a Linear promote
// lands on its ticket); otherwise the task's saved layout is restored and only the FIRST activation
// picks a default.
export function activateTaskSignals(t: Task, options?: { pane?: PaneId }): void {
  setSelectedSource(null)
  setActiveTaskId(t.id)
  markTaskRead(t.id) // viewing acknowledges its notices (docs/terminal-and-agents.md)
  if (options?.pane) return dispatchLayout(t.id, { type: 'show', pane: options.pane })
  // First open: a PR-less task with a Linear link starts on 'linear'; everything else on 'pr'
  // (also the reducer's default, but seeding it keeps the persisted layout explicit).
  if (layoutForTask(t.id) == null) {
    const hasLinear = t.links.some((l) => l.providerId === 'linear')
    dispatchLayout(t.id, { type: 'show', pane: !t.pullNumber && hasLinear ? 'linear' : 'pr' })
  }
}
