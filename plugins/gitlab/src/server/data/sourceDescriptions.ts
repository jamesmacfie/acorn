import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// Both GitLab sources read the projects a panel names, chosen from the person's GitLab projects.
const projectsParameter = {
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { projects: { type: 'array', items: { type: 'string' } } },
    required: ['projects'],
  },
  parameterFields: [
    {
      pointer: '/projects',
      label: 'Projects',
      origin: 'declared',
      display: { kind: 'text', list: true },
      choices: { kind: 'dynamic', dependsOn: [] },
    },
  ],
} satisfies Pick<DataSourceDescription, 'parameters' | 'parameterFields'>

const timeQuery = { operators: ['gt', 'gte', 'lt', 'lte'] as ('gt' | 'gte' | 'lt' | 'lte')[], sortable: true }

export const mergeRequestSourceDescription: DataSourceDescription = {
  projectScope: { kind: 'repository', parameter: '/projects', record: '/project' },
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      project: { type: 'string' },
      remoteRepository: { type: 'string' },
      number: { type: 'number' },
      title: { type: 'string' },
      state: { type: 'string', enum: ['open', 'closed', 'merged'] },
      draft: { type: 'boolean' },
      author: { type: ['string', 'null'] },
      gitlabConnectionId: { type: 'string' },
      sourceBranch: { type: 'string' },
      targetBranch: { type: 'string' },
      labels: { type: 'array', items: { type: 'string' } },
      reviewers: { type: 'array', items: { type: 'string' } },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
      url: { type: 'string' },
    },
    required: [
      'project',
      'remoteRepository',
      'number',
      'title',
      'state',
      'draft',
      'author',
      'gitlabConnectionId',
      'sourceBranch',
      'targetBranch',
      'labels',
      'reviewers',
      'createdAt',
      'updatedAt',
      'url',
    ],
  },
  fields: [
    { pointer: '/project', label: 'Project', origin: 'declared' },
    // `gitlab.com/<path>`, the shape core's local branches give their remote, so a branch finds its
    // merge request.
    { pointer: '/remoteRepository', label: 'Remote repository', origin: 'declared' },
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
          { id: 'closed', label: 'Closed', tone: 'muted' },
        ],
      },
    },
    { pointer: '/draft', label: 'Draft', origin: 'declared', query: { operators: ['eq'], sortable: false } },
    { pointer: '/author', label: 'Author', origin: 'declared', query: { operators: ['eq'], sortable: false } },
    { pointer: '/gitlabConnectionId', label: 'GitLab account connection', origin: 'declared' },
    { pointer: '/sourceBranch', label: 'Source branch', origin: 'declared' },
    { pointer: '/targetBranch', label: 'Target branch', origin: 'declared' },
    { pointer: '/labels', label: 'Labels', origin: 'declared', display: { kind: 'text', list: true } },
    { pointer: '/reviewers', label: 'Reviewers', origin: 'declared', display: { kind: 'text', list: true } },
    { pointer: '/createdAt', label: 'Created', origin: 'declared', display: { kind: 'datetime' }, query: timeQuery },
    { pointer: '/updatedAt', label: 'Updated', origin: 'declared', display: { kind: 'datetime' }, query: timeQuery },
    { pointer: '/url', label: 'Link', origin: 'declared', display: { kind: 'link', role: 'url' } },
  ],
  ...projectsParameter,
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  consistency:
    "GitLab's REST list of each selected project's merge requests, newest first, 100 at most per project. A read past that says it is incomplete.",
}

export const jobSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      project: { type: 'string' },
      jobId: { type: 'number' },
      pipelineId: { type: ['number', 'null'] },
      name: { type: 'string' },
      stage: { type: 'string' },
      status: { type: 'string' },
      ref: { type: 'string' },
      createdAt: { type: 'number' },
      finishedAt: { type: ['number', 'null'] },
      durationMs: { type: ['number', 'null'] },
      url: { type: 'string' },
    },
    required: [
      'project',
      'jobId',
      'pipelineId',
      'name',
      'stage',
      'status',
      'ref',
      'createdAt',
      'finishedAt',
      'durationMs',
      'url',
    ],
  },
  fields: [
    { pointer: '/project', label: 'Project', origin: 'declared' },
    { pointer: '/name', label: 'Job', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/stage', label: 'Stage', origin: 'declared' },
    {
      pointer: '/status',
      label: 'Status',
      origin: 'declared',
      display: { kind: 'status' },
      query: { operators: ['eq'], sortable: false },
      choices: {
        kind: 'static',
        values: [
          { id: 'success', label: 'Passed', tone: 'ok' },
          { id: 'failed', label: 'Failed', tone: 'bad' },
          { id: 'running', label: 'Running', tone: 'warn' },
          { id: 'pending', label: 'Pending', tone: 'warn' },
          { id: 'canceled', label: 'Cancelled', tone: 'muted' },
          { id: 'skipped', label: 'Skipped', tone: 'muted' },
          { id: 'manual', label: 'Manual', tone: 'muted' },
        ],
      },
    },
    { pointer: '/ref', label: 'Branch', origin: 'declared' },
    { pointer: '/jobId', label: 'Job ID', origin: 'declared' },
    { pointer: '/pipelineId', label: 'Pipeline ID', origin: 'declared' },
    { pointer: '/createdAt', label: 'Created', origin: 'declared', display: { kind: 'datetime' }, query: timeQuery },
    { pointer: '/finishedAt', label: 'Finished', origin: 'declared', display: { kind: 'datetime' } },
    { pointer: '/durationMs', label: 'Duration', origin: 'declared', display: { kind: 'number', unit: 'ms' } },
    { pointer: '/url', label: 'Job URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
  ],
  ...projectsParameter,
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  actions: [{ id: 'retry-job', label: 'Retry job', risk: 'execute' }],
  coverage: { kind: 'events', retention: 'GitLab project policy', complete: false },
  consistency:
    "GitLab's REST list of each selected project's most recent jobs, 100 at most per project. A read past that says it is incomplete.",
}
