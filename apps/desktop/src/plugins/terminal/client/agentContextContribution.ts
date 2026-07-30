import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { refreshSessions, sessions } from '../../../core/client/tasks/agentSessions'

export const terminalAgentContextContribution: AgentContextContribution = {
  id: 'acorn-terminals',
  source: 'terminal',
  label: 'Terminal sessions',
  description: 'Capture bounded terminal session status without silently importing screen history.',
  async options(scope) {
    await refreshSessions()
    return sessions().filter((session) => session.taskId === scope.taskId).slice(0, 50).map((session) => ({
      id: session.id,
      label: session.title,
      description: `${session.kind}/${session.profileId} · ${session.status} · ${session.agentState}`,
    }))
  },
  async capture(scope, optionIds) {
    await refreshSessions()
    const rows = sessions().filter((session) => session.taskId === scope.taskId).slice(0, 50)
    const selected = optionIds ? rows.filter((session) => optionIds.includes(session.id)) : rows
    return selected.map((session) => contextSnapshot({
      contextId: `terminal:${session.id}:${Date.now()}`,
      label: `Terminal · ${session.title}`,
      content: [
        `# Terminal session: ${session.title}`,
        `- ${session.kind}/${session.profileId} · ${session.status} · ${session.agentState}`,
        '',
        'Terminal output is excluded.',
      ].join('\n'),
      source: 'terminal',
      resourceId: session.id,
      provenance: 'Live task-scoped terminal metadata; no screen scraping',
      deepLink: { pane: 'terminal' },
      freshness: 'live',
      sensitivity: 'workspace',
    }))
  },
}
