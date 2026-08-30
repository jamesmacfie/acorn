import { createSignal } from 'solid-js'
import { clientEvents } from '../../host/registries/commands/clientEvents'

// Which tasks are mid-teardown. The guarded archive takes seconds and either the task pane's close
// button or the rail row's menu can start it, so the flag lives here and both surfaces show the
// same spinner whichever door was used.
const [archivingIds, setArchivingIds] = createSignal<readonly string[]>([])

export const isArchiving = (taskId: string): boolean => archivingIds().includes(taskId)

// Marks the task for the duration of `run`. Clears in a `finally`: a failed archive leaves the row
// in the rail, so a flag left set would spin forever.
export async function withArchiving<T>(taskId: string, run: () => Promise<T>): Promise<T> {
  setArchivingIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]))
  try {
    return await run()
  } finally {
    setArchivingIds((prev) => prev.filter((id) => id !== taskId))
  }
}

// The durable archive mutation has already succeeded when this runs. End the active UI scope first
// so component cleanup can publish its final session state, then make eviction the last writer.
export function completeTaskArchive(taskId: string, leaveActiveScope: () => void): void {
  try {
    leaveActiveScope()
  } finally {
    clientEvents.emit('runtime:task-archived', { taskId })
  }
}
