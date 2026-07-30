import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { refreshSessions, sessions } from '../../../core/client/tasks/agentSessions'

export const terminalAgentContextContribution: AgentContextContribution = {
  id: 'acorn-terminals',
  label: 'Terminal sessions',
  description: 'Capture bounded terminal session status without silently importing screen history.',
  async capture(scope) {
    await refreshSessions()
    const rows = sessions().filter((session) => session.taskId === scope.taskId).slice(0, 50)
    const content = [
      '# Terminal sessions',
      ...rows.map((session) =>
        `- ${session.title} · ${session.kind}/${session.profileId} · ${session.status} · ${session.agentState}`),
      '',
      'Terminal output is excluded. Select and attach output explicitly when that capability is available.',
    ].join('\n')
    return [contextSnapshot({
      contextId: `terminals:${scope.taskId}:${Date.now()}`,
      label: `Terminals · ${rows.length} session${rows.length === 1 ? '' : 's'}`,
      content,
      source: 'terminal',
      resourceId: scope.taskId,
      provenance: 'Live task-scoped terminal metadata; no screen scraping',
      deepLink: { pane: 'terminal' },
      freshness: 'live',
      sensitivity: 'workspace',
    })]
  },
}
