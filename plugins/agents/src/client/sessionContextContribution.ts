import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { managedAgentApi } from './sessions/managedClient'

export const sessionContextContribution: AgentContextContribution = {
  id: 'agents.sessions',
  source: 'agents.sessions',
  label: 'Agent sessions',
  description: 'Attach a snapshot of another agent session in this task to the next message.',
  async options(scope) {
    const page = await managedAgentApi.sessions({ taskId: scope.taskId, limit: 50 })
    return page.sessions
      .filter((session) => session.id !== scope.sessionId)
      .map((session) => ({
        id: session.id,
        label: session.title,
        description: `${session.providerId} · ${new Date(session.lastEventAt ?? session.updatedAt).toLocaleString()}`,
      }))
  },
  async capture(scope, optionIds) {
    if (!optionIds?.length) return []
    return Promise.all(
      optionIds.filter((id) => id !== scope.sessionId).map((id) => managedAgentApi.referenceContext(id, scope.taskId)),
    )
  },
}
