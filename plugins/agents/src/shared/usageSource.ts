import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

export const usageSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: { type: 'object', additionalProperties: false, properties: {
    at: { type: 'number' }, sessionId: { type: 'string' }, turnId: { type: ['string', 'null'] },
    taskId: { type: 'string' }, provider: { type: 'string' }, model: { type: ['string', 'null'] },
    inputTokens: { type: ['number', 'null'] }, outputTokens: { type: ['number', 'null'] },
    cacheReadTokens: { type: ['number', 'null'] }, cacheWriteTokens: { type: ['number', 'null'] },
    costUsd: { type: ['number', 'null'] }, costSource: { type: 'string', enum: ['reported', 'estimated', 'unknown'] },
    priceName: { type: ['string', 'null'] },
  }, required: ['at', 'sessionId', 'turnId', 'taskId', 'provider', 'model', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'costSource', 'priceName'] },
  fields: [
    { pointer: '/at', label: 'Usage time', origin: 'declared', display: { kind: 'datetime' }, query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true } },
    { pointer: '/sessionId', label: 'Session', origin: 'declared', query: { operators: ['eq'], sortable: false } },
    { pointer: '/taskId', label: 'Task', origin: 'declared', query: { operators: ['eq'], sortable: false } },
    { pointer: '/provider', label: 'Provider', origin: 'declared', query: { operators: ['eq'], sortable: false } },
    { pointer: '/model', label: 'Model', origin: 'declared', query: { operators: ['eq'], sortable: false } },
    ...(['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const).map(key => ({ pointer: `/${key}`, label: key, origin: 'declared' as const, display: { kind: 'number' as const, unit: 'tokens' } })),
    { pointer: '/costUsd', label: 'Cost', origin: 'declared', display: { kind: 'number', unit: 'USD' } },
    { pointer: '/costSource', label: 'Cost provenance', origin: 'declared', choices: { kind: 'static', values: [
      { id: 'reported', label: 'Provider reported' }, { id: 'estimated', label: 'Estimated' }, { id: 'unknown', label: 'Unknown' },
    ] } },
    { pointer: '/priceName', label: 'Price used', origin: 'declared' },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} }, parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'events', retention: 'Until the owning task history is removed', complete: false },
  consistency: 'One row per durable usage event. Cumulative provider counters are converted to event deltas before filtering. Removed task history is outside coverage.',
}
