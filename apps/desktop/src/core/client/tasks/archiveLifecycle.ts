import { clientEvents } from '../registries/clientEvents'

// The durable archive mutation has already succeeded when this runs. End the active UI scope first
// so component cleanup can publish its final session state, then make eviction the last writer.
export function completeTaskArchive(taskId: string, leaveActiveScope: () => void): void {
  try {
    leaveActiveScope()
  } finally {
    clientEvents.emit('runtime:task-archived', { taskId })
  }
}
