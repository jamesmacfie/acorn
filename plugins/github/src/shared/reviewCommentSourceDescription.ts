import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataOperator } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// Starter panels for the Add panel launcher (docs/data-sources.md). Their scope names no account: the
// launcher moves each one onto the account and repositories the person picked. The time filter comes
// first and is a step of its own, so the Node hands it to the source, which reads only the pull
// requests updated since then.
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
          query: { source: { pluginId: 'github', sourceId: 'review-comments' }, scope: { parameters: {} }, sort: [] },
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

const searchable = (operators: DataOperator[], sortable = false) => ({ operators, sortable })

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
      kind: { type: 'string', enum: ['inline', 'reply', 'summary', 'conversation'] },
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
      query: searchable([], true),
    },
    { pointer: '/pullTitle', label: 'Pull request title', origin: 'declared' },
    { pointer: '/pullUrl', label: 'Pull request URL', origin: 'declared', display: { kind: 'link' } },
    {
      pointer: '/author',
      label: 'Author login',
      origin: 'declared',
      display: { kind: 'person' },
      viewerMatch: '/login',
      query: searchable(['eq']),
    },
    {
      pointer: '/authorIsPullAuthor',
      label: 'By the pull request author',
      origin: 'declared',
      display: { kind: 'boolean' },
      query: searchable(['eq']),
    },
    {
      pointer: '/kind',
      label: 'Kind',
      origin: 'declared',
      display: { kind: 'status' },
      query: searchable(['eq']),
      choices: {
        kind: 'static',
        values: [
          { id: 'inline', label: 'Inline', tone: 'accent' },
          { id: 'reply', label: 'Reply', tone: 'muted' },
          { id: 'summary', label: 'Review summary', tone: 'ok' },
          { id: 'conversation', label: 'Conversation', tone: 'muted' },
        ],
      },
    },
    {
      pointer: '/reviewState',
      label: 'Review state',
      origin: 'declared',
      display: { kind: 'status', role: 'status' },
      query: searchable(['eq']),
      choices: {
        kind: 'static',
        values: [
          { id: 'approved', label: 'Approved', tone: 'ok' },
          { id: 'changes_requested', label: 'Changes requested', tone: 'bad' },
          { id: 'commented', label: 'Commented', tone: 'muted' },
          { id: 'dismissed', label: 'Dismissed', tone: 'muted' },
        ],
      },
    },
    {
      pointer: '/resolved',
      label: 'Thread resolved',
      origin: 'declared',
      display: { kind: 'boolean' },
      query: searchable(['eq']),
    },
    {
      pointer: '/createdAt',
      label: 'Created',
      origin: 'declared',
      display: { kind: 'datetime', role: 'updated' },
      query: searchable(['gt', 'gte', 'lt', 'lte'], true),
    },
    { pointer: '/url', label: 'Comment URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
  ],
  parameters: {
    type: 'object',
    properties: { repositories: { type: 'array', items: { type: 'string' } } },
    additionalProperties: false,
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
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'], identity: true },
  coverage: { kind: 'snapshot' },
  starterPlans: reviewCommentStarterPlans,
  reach: {
    parameter: '/repositories',
    itemPlural: 'repositories',
    default: 'linked repositories',
    empty: 'no linked repositories',
  },
  consistency:
    'Reads are restricted to linked repositories. An explicit list selects a subset. A lower bound on Created reads only the pull requests updated since then. The 100 most recently updated pull requests are read, with up to 100 reviews, 100 conversation comments, and 100 threads of 50 comments each. A read past any of those keeps what it got and says it is incomplete. Comment text is never read into a record.',
}
