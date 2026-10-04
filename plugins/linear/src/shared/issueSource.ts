import type { DataSourceDescription, DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

export const issueSource: DataSourceRegistration = {
  sourceId: 'issues', name: 'Linear issues', singular: 'Issue', plural: 'Issues', providerId: 'linear',
  identityScope: 'Linear issue UUID in the selected connection', handler: '/v1/p/linear/data/issues',
  titlePointer: '/title', urlPointer: '/url', icon: 'brand:linear',
}

export const issueSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: { type: 'object', additionalProperties: false, properties: {
    id: { type: 'string' }, identifier: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' },
    description: { type: ['string', 'null'] }, projectId: { type: 'string' },
    state: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' },
    }, required: ['id', 'name', 'category'] },
    createdAt: { type: 'number' }, updatedAt: { type: 'number' },
  }, required: ['id', 'identifier', 'title', 'url', 'description', 'projectId', 'state', 'createdAt', 'updatedAt'] },
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/identifier', label: 'Identifier', origin: 'declared' },
    { pointer: '/description', label: 'Description', origin: 'declared' },
    { pointer: '/url', label: 'URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
    { pointer: '/state/id', label: 'State', origin: 'declared', query: { operators: ['eq'], sortable: false }, choices: { kind: 'dynamic', dependsOn: ['/project'] } },
    { pointer: '/state/name', label: 'State name', origin: 'declared', display: { kind: 'status', role: 'status' } },
    { pointer: '/state/category', label: 'State category', origin: 'declared' },
    ...(['createdAt', 'updatedAt'] as const).map(key => ({ pointer: `/${key}`, label: key === 'createdAt' ? 'Created' : 'Updated', origin: 'declared' as const,
      display: { kind: 'datetime' as const }, query: { operators: ['gt', 'gte', 'lt', 'lte'] as ('gt' | 'gte' | 'lt' | 'lte')[], sortable: true } })),
  ],
  parameters: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'], additionalProperties: false },
  parameterFields: [{ pointer: '/project', label: 'Project', origin: 'declared', choices: { kind: 'dynamic', dependsOn: [] } }],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  targets: [{ kind: 'linear.issue' }],
  consistency: 'Linear project issues, including archived issues, with exact state IDs. No snapshot isolation across upstream pages. At most 5,000 candidates are exhausted before stable sorting; a larger selection is incomplete. Continuations retain the selection for 60 seconds.',
}
