import type { DataSourceDescription, DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

export const pullSource: DataSourceRegistration = {
  sourceId: 'pull-requests', name: 'GitHub pull requests', singular: 'Pull request', plural: 'Pull requests',
  providerId: 'github', identityScope: 'GitHub GraphQL node ID; stable across titles and repository renames',
  handler: '/v2/p/github/data/pulls', titlePointer: '/title', urlPointer: '/url', icon: 'brand:github',
}

export const pullSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      id: { type: 'string' }, number: { type: 'number' }, title: { type: 'string' },
      repository: { type: 'string' }, url: { type: 'string' },
      state: { type: 'string', enum: ['open', 'closed', 'merged'] },
      author: { type: ['string', 'null'] }, draft: { type: 'boolean' },
      createdAt: { type: 'number' }, updatedAt: { type: 'number' },
      closedAt: { type: ['number', 'null'] }, mergedAt: { type: ['number', 'null'] },
      mergeable: { type: 'string' }, mergeStateStatus: { type: 'string' }, autoMergeEnabled: { type: 'boolean' },
    },
    required: ['id', 'number', 'title', 'repository', 'url', 'state', 'author', 'draft', 'createdAt', 'updatedAt', 'closedAt', 'mergedAt', 'mergeable', 'mergeStateStatus', 'autoMergeEnabled'],
  },
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/number', label: 'Number', origin: 'declared', display: { kind: 'number' }, query: { operators: [], sortable: true } },
    { pointer: '/repository', label: 'Repository', origin: 'declared' },
    { pointer: '/url', label: 'URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
    { pointer: '/state', label: 'State', origin: 'declared', display: { kind: 'status', role: 'status' },
      query: { operators: ['eq'], sortable: false }, choices: { kind: 'static', values: [
        { id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed without merge' }, { id: 'merged', label: 'Merged' },
      ] } },
    { pointer: '/author', label: 'Author login', origin: 'declared', display: { kind: 'person' }, query: { operators: ['eq'], sortable: false } },
    { pointer: '/draft', label: 'Draft', origin: 'declared', display: { kind: 'boolean' }, query: { operators: ['eq'], sortable: false } },
    ...(['createdAt', 'updatedAt'] as const).map(key => ({
      pointer: `/${key}`, label: key === 'createdAt' ? 'Created' : 'Updated', origin: 'declared' as const,
      display: { kind: 'datetime' as const }, query: { operators: ['gt', 'gte', 'lt', 'lte'] as ('gt' | 'gte' | 'lt' | 'lte')[], sortable: true },
    })),
    { pointer: '/closedAt', label: 'Closed', origin: 'declared', display: { kind: 'datetime' } },
    { pointer: '/mergedAt', label: 'Merged', origin: 'declared', display: { kind: 'datetime' } },
    { pointer: '/mergeable', label: 'Mergeability', origin: 'declared' },
    { pointer: '/mergeStateStatus', label: 'Merge readiness', origin: 'declared' },
    { pointer: '/autoMergeEnabled', label: 'Auto-merge enabled', origin: 'declared', display: { kind: 'boolean' } },
  ],
  parameters: { type: 'object', properties: { repository: { type: 'string' } }, required: ['repository'], additionalProperties: false },
  parameterFields: [{ pointer: '/repository', label: 'Repository', origin: 'declared', choices: { kind: 'dynamic', dependsOn: [] } }],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  consistency: 'GitHub search is eventually consistent, with no snapshot isolation during upstream pagination. Up to 1,000 matches are fully read before local exact filtering and stable sorting. Larger searches are incomplete. Continuations retain that selection for 60 seconds; expired selections must be refreshed.',
}
