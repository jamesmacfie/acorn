import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// Both Bitbucket sources read the repositories a panel names, chosen from the person's repositories.
const repositoriesParameter = {
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { repositories: { type: 'array', items: { type: 'string' } } },
    required: ['repositories'],
  },
  parameterFields: [
    {
      pointer: '/repositories',
      label: 'Repositories',
      origin: 'declared',
      display: { kind: 'text', list: true },
      choices: { kind: 'dynamic', dependsOn: [] },
    },
  ],
} satisfies Pick<DataSourceDescription, 'parameters' | 'parameterFields'>

const timeQuery = { operators: ['gt', 'gte', 'lt', 'lte'] as ('gt' | 'gte' | 'lt' | 'lte')[], sortable: true }

export const pullRequestSourceDescription: DataSourceDescription = {
  projectScope: { kind: 'repository', parameter: '/repositories', record: '/repository' },
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      repository: { type: 'string' },
      number: { type: 'number' },
      title: { type: 'string' },
      state: { type: 'string', enum: ['open', 'closed', 'merged'] },
      draft: { type: 'boolean' },
      author: { type: ['string', 'null'] },
      sourceBranch: { type: 'string' },
      sourceRepository: { type: ['string', 'null'] },
      targetBranch: { type: 'string' },
      reviewers: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
      url: { type: 'string' },
    },
    required: [
      'repository',
      'number',
      'title',
      'state',
      'draft',
      'author',
      'sourceBranch',
      'sourceRepository',
      'targetBranch',
      'reviewers',
      'createdAt',
      'updatedAt',
      'url',
    ],
  },
  fields: [
    { pointer: '/repository', label: 'Repository', origin: 'declared' },
    { pointer: '/number', label: 'Number', origin: 'declared', display: { kind: 'number' } },
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    {
      pointer: '/state',
      label: 'State',
      origin: 'declared',
      display: { kind: 'status' },
      query: { operators: ['eq'], sortable: false },
      choices: {
        kind: 'static',
        values: [
          { id: 'open', label: 'Open', tone: 'ok' },
          { id: 'merged', label: 'Merged', tone: 'muted' },
          { id: 'closed', label: 'Declined', tone: 'muted' },
        ],
      },
    },
    { pointer: '/draft', label: 'Draft', origin: 'declared', query: { operators: ['eq'], sortable: false } },
    // The account's nickname, so a panel of someone's own pull requests filters on theirs.
    { pointer: '/author', label: 'Author', origin: 'declared', query: { operators: ['eq'], sortable: false } },
    { pointer: '/sourceBranch', label: 'Source branch', origin: 'declared' },
    { pointer: '/sourceRepository', label: 'Fork', origin: 'declared' },
    { pointer: '/targetBranch', label: 'Target branch', origin: 'declared' },
    { pointer: '/reviewers', label: 'Reviewers', origin: 'declared', display: { kind: 'text', list: true } },
    { pointer: '/createdAt', label: 'Created', origin: 'declared', display: { kind: 'datetime' }, query: timeQuery },
    { pointer: '/updatedAt', label: 'Updated', origin: 'declared', display: { kind: 'datetime' }, query: timeQuery },
    { pointer: '/url', label: 'Link', origin: 'declared', display: { kind: 'link', role: 'url' } },
  ],
  ...repositoriesParameter,
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  consistency:
    "Bitbucket's REST list of each selected repository's pull requests, newest first, 100 at most per repository. A read past that says it is incomplete.",
}

export const stepSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      repository: { type: 'string' },
      pipelineNumber: { type: 'number' },
      name: { type: 'string' },
      status: { type: 'string' },
      branch: { type: ['string', 'null'] },
      startedAt: { type: 'number' },
      finishedAt: { type: ['number', 'null'] },
      durationMs: { type: ['number', 'null'] },
      url: { type: 'string' },
    },
    required: [
      'repository',
      'pipelineNumber',
      'name',
      'status',
      'branch',
      'startedAt',
      'finishedAt',
      'durationMs',
      'url',
    ],
  },
  fields: [
    { pointer: '/repository', label: 'Repository', origin: 'declared' },
    { pointer: '/name', label: 'Step', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/pipelineNumber', label: 'Pipeline', origin: 'declared', display: { kind: 'number' } },
    {
      pointer: '/status',
      label: 'Status',
      origin: 'declared',
      display: { kind: 'status' },
      query: { operators: ['eq'], sortable: false },
      choices: {
        kind: 'static',
        values: [
          { id: 'successful', label: 'Passed', tone: 'ok' },
          { id: 'failed', label: 'Failed', tone: 'bad' },
          { id: 'error', label: 'Error', tone: 'bad' },
          { id: 'in_progress', label: 'Running', tone: 'warn' },
          { id: 'pending', label: 'Pending', tone: 'warn' },
          { id: 'stopped', label: 'Stopped', tone: 'muted' },
          { id: 'not_run', label: 'Not run', tone: 'muted' },
        ],
      },
    },
    { pointer: '/branch', label: 'Branch', origin: 'declared' },
    { pointer: '/startedAt', label: 'Started', origin: 'declared', display: { kind: 'datetime' }, query: timeQuery },
    { pointer: '/finishedAt', label: 'Finished', origin: 'declared', display: { kind: 'datetime' } },
    { pointer: '/durationMs', label: 'Duration', origin: 'declared', display: { kind: 'number', unit: 'ms' } },
    { pointer: '/url', label: 'Step URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
  ],
  ...repositoriesParameter,
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'events', retention: 'Bitbucket Pipelines retention', complete: false },
  consistency:
    "The steps of each selected repository's five newest pipelines, from Bitbucket's REST API. Older pipelines aren't read.",
}
