import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

// The Node's boot loads this. The description loads with its handler on the first read, which keeps it
// out of the service's boot budget (apps/node/scripts/check-service-budget.mjs).
export const memorySource: DataSourceRegistration = {
  sourceId: 'memories',
  name: 'Memories',
  singular: 'Memory',
  plural: 'Memories',
  identityScope: 'Memory name within its scope and project',
  handler: '/v1/p/memory/data/memories',
  titlePointer: '/name',
  icon: 'brain',
}
