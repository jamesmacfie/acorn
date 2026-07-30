import type { AgentContextContribution } from '../../../core/shared/agentContext'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { databaseApi } from './databaseClient'

export const databaseAgentContextContribution: AgentContextContribution = {
  id: 'acorn-database',
  label: 'Saved database queries',
  description: 'Capture saved SQL and notes; connection credentials never enter the snapshot.',
  async capture(scope) {
    const queries = (await databaseApi().queries(scope.taskId)).slice(0, 20)
    const content = [
      '# Saved database queries',
      ...queries.flatMap((query) => [
        `## ${query.name}`,
        query.notes ?? '',
        '```sql',
        query.sql.slice(0, 20_000),
        '```',
      ]),
    ].join('\n')
    return [contextSnapshot({
      contextId: `database:${scope.taskId}:${Date.now()}`,
      label: `Database · ${queries.length} saved quer${queries.length === 1 ? 'y' : 'ies'}`,
      content,
      source: 'database',
      resourceId: scope.taskId,
      provenance: 'Saved query text and notes; database URL and credentials excluded',
      deepLink: { pane: 'database' },
      freshness: 'live',
      sensitivity: 'private',
    })]
  },
}
