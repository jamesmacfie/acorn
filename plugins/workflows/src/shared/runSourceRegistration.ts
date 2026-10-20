import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

// The Node's boot loads this. The description loads with its handler on the first read, which keeps
// it out of the service's boot budget (apps/node/scripts/check-service-budget.mjs).
export const runSource: DataSourceRegistration = {
  sourceId: 'runs',
  name: 'Workflow runs',
  singular: 'Workflow run',
  plural: 'Workflow runs',
  identityScope: 'Workflow run id; one record per run, child runs included',
  handler: '/v1/p/workflows/data/runs',
  titlePointer: '/name',
  icon: 'workflow',
}
