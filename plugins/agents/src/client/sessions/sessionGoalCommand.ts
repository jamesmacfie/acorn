import { createSignal } from 'solid-js'
import { selectedManagedSession } from './managedSelection'

const [pendingSessionId, setPendingSessionId] = createSignal<string>()

export function requestSessionGoalEditor(taskId: string | null): void {
  const sessionId = taskId && selectedManagedSession(taskId)
  if (!sessionId) throw new Error('Open an interactive agent session to set a goal.')
  setPendingSessionId(sessionId)
}

export function consumeSessionGoalEditor(sessionId: string): boolean {
  if (pendingSessionId() !== sessionId) return false
  setPendingSessionId(undefined)
  return true
}
