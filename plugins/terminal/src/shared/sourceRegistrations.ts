import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

// The Node's boot loads this. The description loads with its handler on the first read, which keeps it
// out of the service's boot budget (apps/node/scripts/check-service-budget.mjs).
export const runSource: DataSourceRegistration = {
  sourceId: 'runs',
  name: 'Terminal runs',
  singular: 'Terminal run',
  plural: 'Terminal runs',
  identityScope: 'Terminal session UUID; one record per finished run',
  handler: '/v1/p/terminal/data/runs',
  titlePointer: '/name',
  icon: 'terminal',
}
