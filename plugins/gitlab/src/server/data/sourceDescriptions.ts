import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// GitLab's sources read the projects a panel names, chosen from the person's GitLab projects.
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
    // `<host>/<path>`, such as `gitlab.com/group/api`, the shape core's local branches give their
    // remote, so a branch finds its merge request.
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
  // The only suggested trigger the fields allow: the source has no review requests or checks.
  starterTriggers: [
    {
      id: 'new-pull-request',
      label: 'A new merge request',
      description: 'Starts a run once for each merge request opened.',
      predicate: {
        kind: 'comparison',
        left: { address: { from: 'item', pointer: '/state' } },
        operator: 'eq',
        right: { address: { from: 'literal', value: 'open' } },
      },
      change: { on: 'new' },
    },
  ],
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

// Starter panels for the Add panel launcher (docs/data-sources.md). Their scope names no account or
// project: the launcher moves each one onto the ones the person picked. The time filter comes first
// and is a step of its own, so the Node hands it to the source, which reads only the merge requests
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
          query: { source: { pluginId: 'gitlab', sourceId: 'review-comments' }, scope: { parameters: {} }, sort: [] },
        },
      },
    },
  ],
  ...plan,
})
const reviewCommentStarterPlans: PanelPlan[] = [
  commentStarter('Review comments per merge request', {
    columns: [commentColumn('title', 'Merge request', 'text'), commentColumn('createdAt', 'Created', 'datetime')],
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

// The same fields as GitHub's and Bitbucket's review comments, so their panels chart alike. GitLab
// gives a verdict to the reviewer rather than to a comment, so it has no review summaries, and the
// review state is always empty.
export const reviewCommentSourceDescription: DataSourceDescription = {
  projectScope: { kind: 'repository', parameter: '/projects', record: '/repository' },
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
    { pointer: '/title', label: 'Merge request', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/repository', label: 'Project', origin: 'declared' },
    {
      pointer: '/number',
      label: 'Merge request number',
      origin: 'declared',
      display: { kind: 'number' },
      query: { operators: [], sortable: true },
    },
    { pointer: '/pullTitle', label: 'Merge request title', origin: 'declared' },
    { pointer: '/pullUrl', label: 'Merge request URL', origin: 'declared', display: { kind: 'link' } },
    { pointer: '/author', label: 'Author', origin: 'declared', display: { kind: 'person' }, query: eq },
    {
      pointer: '/authorIsPullAuthor',
      label: 'By the merge request author',
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
  ...projectsParameter,
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  starterPlans: reviewCommentStarterPlans,
  consistency:
    "GitLab's REST discussions on each selected project's merge requests. A lower bound on Created reads only the merge requests updated since then. Each project reads its 25 most recently updated merge requests and 100 discussions on each. A read past either keeps what it got and says it is incomplete. System notes and comment text are never read into a record.",
}
