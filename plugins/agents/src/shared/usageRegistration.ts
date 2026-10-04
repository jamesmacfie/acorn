import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

export const usageSource: DataSourceRegistration = {
  sourceId: 'usage-records', name: 'Agent usage records', singular: 'Usage record', plural: 'Usage records',
  identityScope: 'Durable agent usage event UUID', handler: '/v1/p/agents/data/usage',
  titlePointer: '/model', icon: 'bot',
}
