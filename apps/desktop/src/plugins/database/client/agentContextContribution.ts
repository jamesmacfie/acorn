import type { AgentContextContribution } from '@acorn/protocol/agentContext.ts'
import { contextSnapshot } from '../../../core/client/agent/contextSnapshot'
import { databaseApi } from './databaseClient'

export const databaseAgentContextContribution: AgentContextContribution = {
  id: 'acorn-database',
  source: 'database',
  label: 'Saved database queries',
  description: 'Capture saved SQL and notes; connection credentials never enter the snapshot.',
  async options(scope) {
    return (await databaseApi().queries(scope.taskId)).slice(0, 20).map((query) => ({
      id: query.id,
      label: query.name,
      description: query.notes || query.sql.slice(0, 120),
    }))
  },
  async capture(scope, optionIds) {
    const queries = (await databaseApi().queries(scope.taskId)).slice(0, 20)
    const selected = optionIds ? queries.filter((query) => optionIds.includes(query.id)) : queries
    return selected.map((query) => {
      const content = [
        `# Saved database query: ${query.name}`,
        query.notes ?? '',
        '```sql',
        query.sql.slice(0, 20_000),
        '```',
      ].join('\n')
      return contextSnapshot({
        contextId: `database:${query.id}:${Date.now()}`,
        label: `Database · ${query.name}`,
        content,
        source: 'database',
        resourceId: query.id,
        provenance: 'Saved query text and notes; database URL and credentials excluded',
        deepLink: { pane: 'database' },
        freshness: 'live',
        sensitivity: 'private',
      })
    })
  },
}
