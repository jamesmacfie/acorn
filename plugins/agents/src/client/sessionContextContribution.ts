import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import type { AgentSession } from '../contract/wire.ts'
import { managedAgentApi } from './sessions/managedClient'

export const sessionContextContribution: AgentContextContribution = {
  id: 'agents.sessions',
  source: 'agents.sessions',
  keyword: 'agent',
  label: 'Agent sessions',
  description: 'Attach a snapshot of another agent session in this task to the next message.',
  async options(scope) {
    const page = await managedAgentApi.sessions({ taskId: scope.taskId, limit: 50 })
    const lastActivity = (session: AgentSession) => session.lastEventAt ?? session.updatedAt
    // Top-level conversations only. A delegated child or a workflow step is part of the session that
    // started it, and referencing the parent already carries it.
    return page.sessions
      .filter((session) => session.id !== scope.sessionId && !session.parentSessionId && session.kind !== 'workflow')
      .sort((left, right) => lastActivity(right) - lastActivity(left))
      .map((session) => ({
        id: session.id,
        label: session.title,
        description: `${session.providerId} · ${new Date(lastActivity(session)).toLocaleString()}`,
      }))
  },
  async capture(scope, optionIds) {
    if (!optionIds?.length) return []
    return Promise.all(
      optionIds.filter((id) => id !== scope.sessionId).map((id) => managedAgentApi.referenceContext(id, scope.taskId)),
    )
  },
}
