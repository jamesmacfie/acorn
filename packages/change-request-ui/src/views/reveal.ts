import { onCleanup } from 'solid-js'
import { clientEvents, consumePaneIntent, type DiffPlace, type Task } from '@acorn/plugin-api/client'

/**
 * Hands a task's change request pane each place the host asked it to show in its diff: one held while
 * the pane was closed, then each that arrives while it's open. The host sends it to the pane the task
 * names, when a plugin asks for a line (docs/plugins/frames.md § Showing a line in the change request).
 */
export function onChangeRequestReveal(task: Task, reveal: (place: DiffPlace) => void): void {
  const pane = task.changeRequest?.pane
  if (!pane) return
  const held = consumePaneIntent(task.id, pane, 'change-request:reveal')
  if (held?.kind === 'change-request:reveal') reveal(held.place)
  onCleanup(
    clientEvents.on('presentation:pane-intent', (event) => {
      if (event.taskId !== task.id || event.paneId !== pane || event.intent.kind !== 'change-request:reveal') return
      consumePaneIntent(task.id, pane)
      reveal(event.intent.place)
    }),
  )
}
