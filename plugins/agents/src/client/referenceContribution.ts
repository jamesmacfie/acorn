import type { ReferenceTargetContribution } from '@acorn/plugin-api/client'
import { appendManagedDraft } from './sessions/managedDrafts'
import { managedAgentStore } from './sessions/managedStore'
import { openManagedSession } from './sessions/managedSelection'

// Ahead of core's terminal-session fallback, so a task with a managed session gets the draft there.
export const managedReferenceTarget: ReferenceTargetContribution = {
  id: 'agents.managed-session',
  priority: 100,
  deliver: async (taskId, reference) => {
    const deactivate = managedAgentStore.activate()
    try {
      const sessions = await managedAgentStore.loadTask(taskId)
      const target = sessions.find(
        (session) => session.controller === 'acorn' && !session.archivedAt && session.runtimeState !== 'failed',
      )
      if (!target) return null
      appendManagedDraft(target.id, `@${reference}`)
      openManagedSession(taskId, target.id)
      return { ok: true }
    } finally {
      deactivate()
    }
  },
}
