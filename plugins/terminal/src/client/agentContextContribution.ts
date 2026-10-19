import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { contextSnapshot } from '@acorn/plugin-api/client'
import { refreshSessions, sessions } from './sessionStore'
import { terminalApi } from './terminalClient'

export const terminalAgentContextContribution: AgentContextContribution = {
  id: 'acorn-terminals',
  source: 'terminal',
  keyword: 'terminal',
  label: 'Terminal sessions',
  description: 'Attach the last 200 lines of a terminal session’s output, with secret-shaped values redacted.',
  async options(scope) {
    await refreshSessions()
    return sessions()
      .filter((session) => session.taskId === scope.taskId)
      .slice(0, 50)
      .map((session) => ({
        id: session.id,
        label: session.title,
        description: `${session.kind}/${session.profileId} · ${session.status} · ${session.agentState}`,
      }))
  },
  async capture(scope, optionIds) {
    await refreshSessions()
    const rows = sessions()
      .filter((session) => session.taskId === scope.taskId)
      .slice(0, 50)
    const selected = optionIds ? rows.filter((session) => optionIds.includes(session.id)) : rows
    const api = terminalApi()
    return Promise.all(
      selected.map(async (session) => {
        const { text } = await api.output(session.id)
        return contextSnapshot({
          contextId: `terminal:${session.id}:${Date.now()}`,
          label: `Terminal · ${session.title}`,
          content: [
            `# Terminal session: ${session.title}`,
            `- ${session.kind}/${session.profileId} · ${session.status} · ${session.agentState}`,
            '',
            text ? 'The last lines of its output, with secret-shaped values redacted:' : 'It has printed nothing yet.',
            ...(text ? ['', text] : []),
          ].join('\n'),
          source: 'terminal',
          resourceId: session.id,
          provenance: 'Last 200 lines of terminal output, pattern-redacted on the Node',
          deepLink: { pane: 'terminal' },
          freshness: 'live',
          sensitivity: 'workspace',
        })
      }),
    )
  },
}
