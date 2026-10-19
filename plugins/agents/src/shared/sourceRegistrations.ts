import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

// The Node's boot loads these. Each description loads with its handler on the first read, which keeps
// it out of the service's boot budget (apps/node/scripts/check-service-budget.mjs).

export const usageSource: DataSourceRegistration = {
  sourceId: 'usage-records',
  name: 'Agent usage records',
  singular: 'Usage record',
  plural: 'Usage records',
  identityScope: 'Durable agent usage event UUID',
  handler: '/v1/p/agents/data/usage',
  titlePointer: '/model',
  icon: 'bot',
}

export const turnSource: DataSourceRegistration = {
  sourceId: 'turns',
  name: 'Agent turns',
  singular: 'Agent turn',
  plural: 'Agent turns',
  identityScope: 'Managed turn UUID; one record per finished turn',
  handler: '/v1/p/agents/data/turns',
  titlePointer: '/taskTitle',
  icon: 'bot',
}

export const sessionTotalsSource: DataSourceRegistration = {
  sourceId: 'session-totals',
  name: 'Agent session totals',
  singular: 'Agent session total',
  plural: 'Agent session totals',
  identityScope: 'Managed session UUID; one record per session with a finished turn',
  handler: '/v1/p/agents/data/session-totals',
  titlePointer: '/title',
  icon: 'bot',
}
