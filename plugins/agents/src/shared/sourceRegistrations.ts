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

export const toolCallSource: DataSourceRegistration = {
  sourceId: 'tool-calls',
  name: 'Agent tool calls',
  singular: 'Agent tool call',
  plural: 'Agent tool calls',
  identityScope:
    "Managed turn UUID and the sequence of the call's first event; one record per tool call of a finished turn",
  handler: '/v1/p/agents/data/tool-calls',
  titlePointer: '/tool',
  icon: 'bot',
}

export const approvalSource: DataSourceRegistration = {
  sourceId: 'approvals',
  name: 'Agent approvals',
  singular: 'Agent approval',
  plural: 'Agent approvals',
  identityScope: 'Managed request UUID; one record per permission, question, or other request',
  handler: '/v1/p/agents/data/approvals',
  titlePointer: '/kind',
  icon: 'bot',
}
