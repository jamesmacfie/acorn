import { setManagedAgentReferenceHandler } from '../../../core/client/agent/reference'
import { appendManagedDraft } from './managedDrafts'
import { managedAgentStore } from './managedStore'
import { openManagedSession } from './managedSelection'

export function activateManagedAgentReferences(): void {
  setManagedAgentReferenceHandler(async (taskId, reference) => {
    const deactivate = managedAgentStore.activate()
    try {
      const sessions = await managedAgentStore.loadTask(taskId)
      const target = sessions.find((session) =>
        session.controller === 'acorn' && !session.archivedAt && session.runtimeState !== 'failed')
      if (!target) return null
      appendManagedDraft(target.id, `@${reference}`)
      openManagedSession(taskId, target.id)
      return { ok: true }
    } finally {
      deactivate()
    }
  })
}
