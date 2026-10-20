import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

// The Node's boot loads this. The description loads with its handler on the first read, which keeps it
// out of the service's boot budget (apps/node/scripts/check-service-budget.mjs).
export const codeMatchSource: DataSourceRegistration = {
  sourceId: 'code-matches',
  name: 'Code matches',
  singular: 'Match',
  plural: 'Matches',
  identityScope: 'Project, file, line, and column; one record per match',
  handler: '/v1/p/editor/data/code-matches',
  titlePointer: '/path',
  icon: 'file-search',
}
