import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// Bitbucket's sources read the repositories a panel names, chosen from the person's repositories.
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

// Starter panels for the Add panel launcher (docs/data-sources.md). Their scope names no account or
// repository: the launcher moves each one onto the ones the person picked. The time filter comes first
// and is a step of its own, so the Node hands it to the source, which reads only the pull requests
// updated since then.
type Column = PanelPlan['columns'][number]
const commentColumn = (id: string, label: string, type: Column['type']): Column => ({
  id,
  label,
  type,
  bind: { comments: { field: `/${id}` } },
})
const since = (duration: string): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: {
    kind: 'comparison',
    left: { address: { from: 'item', pointer: '/createdAt' } },
    operator: 'gt',
    right: { address: { from: 'context', name: 'now', offset: duration } },
  },
})
const count = { id: 'comments', label: 'Comments', kind: 'count' } as const
const commentStarter = (title: string, plan: Pick<PanelPlan, 'columns' | 'stages' | 'view' | 'sort'>): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [
    {
      id: 'comments',
      label: 'Review comments',
      role: 'primary',
      reference: {
        kind: 'inline',
        bindings: {},
        content: {
          name: 'Review comments',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          sourceParameters: {},
          query: {
            source: { pluginId: 'bitbucket', sourceId: 'review-comments' },
            scope: { parameters: {} },
            sort: [],
          },
        },
      },
    },
  ],
  ...plan,
})
const reviewCommentStarterPlans: PanelPlan[] = [
  commentStarter('Review comments per pull request', {
    columns: [commentColumn('title', 'Pull request', 'text'), commentColumn('createdAt', 'Created', 'datetime')],
    stages: [since('-P28D'), { op: 'summarize', by: [{ column: 'title' }], measures: [count] }],
    sort: [{ column: 'comments', direction: 'desc' }],
    view: { kind: 'chart', shape: 'bar', x: 'title', aggregate: 'sum', field: 'comments' },
  }),
  commentStarter('Who reviews most', {
    columns: [
      commentColumn('author', 'Reviewer', 'person'),
      commentColumn('authorIsPullAuthor', 'By the author', 'boolean'),
      commentColumn('createdAt', 'Created', 'datetime'),
    ],
    stages: [
      since('-P84D'),
      {
        op: 'filter',
        where: {
          kind: 'comparison',
          left: { address: { from: 'item', pointer: '/authorIsPullAuthor' } },
          operator: 'eq',
          right: { address: { from: 'literal', value: false } },
        },
      },
      { op: 'summarize', by: [{ column: 'author' }], measures: [count] },
    ],
    sort: [{ column: 'comments', direction: 'desc' }],
    view: { kind: 'chart', shape: 'bar', x: 'author', aggregate: 'sum', field: 'comments' },
  }),
  commentStarter('Review comments per week', {
    columns: [commentColumn('createdAt', 'Created', 'datetime'), commentColumn('kind', 'Kind', 'enum')],
    stages: [
      since('-P84D'),
      { op: 'summarize', by: [{ column: 'createdAt', bucket: 'week' }, { column: 'kind' }], measures: [count] },
    ],
    view: {
      kind: 'chart',
      shape: 'bar',
      x: 'createdAt',
      series: 'kind',
      stacked: true,
      aggregate: 'sum',
      field: 'comments',
    },
  }),
]

const eq = { operators: ['eq'] as 'eq'[], sortable: false }

// The same fields as GitHub's and GitLab's review comments, so their panels chart alike. Bitbucket
// gives a verdict to the reviewer rather than to a comment, so it has no review summaries, and the
// review state is always empty.
export const reviewCommentSourceDescription: DataSourceDescription = {
  projectScope: { kind: 'repository', parameter: '/repositories', record: '/repository' },
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      repository: { type: 'string' },
      number: { type: 'number' },
      pullTitle: { type: 'string' },
      pullUrl: { type: 'string' },
      author: { type: ['string', 'null'] },
      authorIsPullAuthor: { type: 'boolean' },
      kind: { type: 'string', enum: ['inline', 'reply', 'conversation'] },
      reviewState: { type: ['string', 'null'] },
      resolved: { type: ['boolean', 'null'] },
      createdAt: { type: 'number' },
      url: { type: 'string' },
    },
    required: [
      'id',
      'title',
      'repository',
      'number',
      'pullTitle',
      'pullUrl',
      'author',
      'authorIsPullAuthor',
      'kind',
      'reviewState',
      'resolved',
      'createdAt',
      'url',
    ],
  },
  fields: [
    { pointer: '/title', label: 'Pull request', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/repository', label: 'Repository', origin: 'declared' },
    {
      pointer: '/number',
      label: 'Pull request number',
      origin: 'declared',
      display: { kind: 'number' },
      query: { operators: [], sortable: true },
    },
    { pointer: '/pullTitle', label: 'Pull request title', origin: 'declared' },
    { pointer: '/pullUrl', label: 'Pull request URL', origin: 'declared', display: { kind: 'link' } },
    { pointer: '/author', label: 'Author', origin: 'declared', display: { kind: 'person' }, query: eq },
    {
      pointer: '/authorIsPullAuthor',
      label: 'By the pull request author',
      origin: 'declared',
      display: { kind: 'boolean' },
      query: eq,
    },
    {
      pointer: '/kind',
      label: 'Kind',
      origin: 'declared',
      display: { kind: 'status' },
      query: eq,
      choices: {
        kind: 'static',
        values: [
          { id: 'inline', label: 'Inline', tone: 'accent' },
          { id: 'reply', label: 'Reply', tone: 'muted' },
          { id: 'conversation', label: 'Conversation', tone: 'muted' },
        ],
      },
    },
    { pointer: '/reviewState', label: 'Review state', origin: 'declared', display: { kind: 'status' } },
    { pointer: '/resolved', label: 'Thread resolved', origin: 'declared', display: { kind: 'boolean' }, query: eq },
    {
      pointer: '/createdAt',
      label: 'Created',
      origin: 'declared',
      display: { kind: 'datetime', role: 'updated' },
      query: timeQuery,
    },
    { pointer: '/url', label: 'Comment URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
  ],
  ...repositoriesParameter,
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  starterPlans: reviewCommentStarterPlans,
  consistency:
    "Bitbucket's REST comments on each selected repository's pull requests. A lower bound on Created reads only the pull requests updated since then. Each repository reads its 25 most recently updated pull requests and 100 comments on each. A read past either keeps what it got and says it is incomplete. Deleted and draft comments, and comment text, are never read into a record.",
}
