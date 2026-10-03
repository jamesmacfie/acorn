import type { DataSourceDescription, DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

export const sessionSource: DataSourceRegistration = {
  sourceId: 'sessions', name: 'Managed agent sessions', singular: 'Agent session', plural: 'Agent sessions',
  identityScope: 'Managed session UUID; stable across title and runtime-state changes',
  handler: '/v1/p/agents/data/sessions', titlePointer: '/title', icon: 'bot',
}

export const sessionSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      title: { type: 'string' }, state: { type: 'string' }, attention: { type: 'string' },
      provider: { type: 'string' }, model: { type: ['string', 'null'] }, taskId: { type: 'string' },
      createdAt: { type: 'number' }, updatedAt: { type: 'number' },
    },
    required: ['title', 'state', 'attention', 'provider', 'model', 'taskId', 'createdAt', 'updatedAt'],
  },
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' }, query: { operators: ['eq', 'ne', 'contains'], sortable: false } },
    { pointer: '/state', label: 'State', origin: 'declared', display: { kind: 'status', role: 'status' }, query: { operators: ['eq', 'ne'], sortable: false } },
    { pointer: '/attention', label: 'Attention', origin: 'declared', display: { kind: 'status' }, query: { operators: ['eq', 'ne'], sortable: false } },
    { pointer: '/provider', label: 'Provider', origin: 'declared', query: { operators: ['eq', 'ne'], sortable: false } },
    { pointer: '/model', label: 'Model', origin: 'declared', query: { operators: ['eq', 'ne', 'missing', 'present'], sortable: false } },
    { pointer: '/createdAt', label: 'Created', origin: 'declared', display: { kind: 'datetime' }, query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true } },
    { pointer: '/updatedAt', label: 'Updated', origin: 'declared', display: { kind: 'datetime', role: 'updated' }, query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true } },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  consistency: 'A page reflects the managed-session ledger at read time. State may advance between pages; record identity and the explicit read time remain stable.',
  targets: [{ kind: 'agents.session' }],
}
