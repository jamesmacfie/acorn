import type { Task } from '../../infra/queries'
import { markTaskRead } from '../notifications/notifications'
import { markPageChange } from './pageChange'
import { dispatchLayout, layoutForTask, setActiveTaskId, setSelectedSource } from './tasks'
import type { PaneId } from './taskLayout'
import { defaultPaneForTask, taskPathFromSources } from '../../host/registries/sources/sources'
import { taskPath } from '../../host/registries/commands/corePaths'

// Where a task lives in the router. A source may claim it, as GitHub puts a PR-backed task at its PR
// URL, and everything else lands on the generic task route. Core used to encode the PR case itself; the
// claim is the owning plugin's to make now.
export const pathForTask = (t: Task): string => taskPathFromSources(t) ?? taskPath(t.id)

// Make a task the active one, signals only, since the caller navigates to pathForTask. Shared by the
// rail, the browse promotes, the notification bell and the command palette, so the select behaviour
// lives once. `options.pane` forces a pane, such as a Linear promote landing on its ticket; otherwise
// the task's saved layout is restored and only the first activation picks a default.
export function activateTaskSignals(t: Task, options?: { pane?: PaneId }): void {
  // Before the two signal writes, so the `nav.change` span covers both of them and says the task it
  // is going to rather than the source it is leaving (./pageChange.ts).
  markPageChange('core', { to: 'task', 'task.id': t.id, ...(options?.pane ? { 'pane.id': options.pane } : {}) })
  setSelectedSource(null)
  setActiveTaskId(t.id)
  markTaskRead(t.id) // viewing acknowledges its notices (docs/terminal-and-agents.md)
  if (options?.pane) return dispatchLayout(t.id, { type: 'show', pane: options.pane })
  // First open: the source that tracks this task says which pane it starts on. Seeding it keeps the
  // persisted layout explicit. A task no source claims is left alone, which is the reducer's default.
  if (layoutForTask(t.id) == null) {
    const pane = defaultPaneForTask(t)
    if (pane) dispatchLayout(t.id, { type: 'show', pane })
  }
}
