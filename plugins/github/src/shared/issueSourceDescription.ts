import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataBindingAddress, DataOperator } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// Starter panels for the Add panel launcher (docs/data-sources.md). Their scope names no account: the
// launcher moves each one onto the account and repositories the person picked. Each filter comes
// first and is a step of its own, so the Node can hand it to GitHub's search.
type Column = PanelPlan['columns'][number]
const issueColumn = (id: string, label: string, type: Column['type'], list?: true): Column => ({
  id,
  label,
  type,
  ...(list ? { list } : {}),
  bind: { issues: { field: `/${id}` } },
})
const keep = (column: string, operator: DataOperator, right: DataBindingAddress): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: {
    kind: 'comparison',
    left: { address: { from: 'item', pointer: `/${column}` } },
    operator,
    right: { address: right },
  },
})
const openIssues = keep('state', 'eq', { from: 'literal', value: 'open' })
const lastTwelveWeeks = (column: string) => keep(column, 'gt', { from: 'context', name: 'now', offset: '-P84D' })
const perWeek = (time: string, series: string): Pick<PanelPlan, 'stages' | 'view'> => ({
  stages: [
    lastTwelveWeeks(time),
    {
      op: 'summarize',
      by: [{ column: time, bucket: 'week' }, { column: series }],
      measures: [{ id: 'issues', label: 'Issues', kind: 'count' }],
    },
  ],
  view: { kind: 'chart', shape: 'bar', x: time, series, stacked: true, aggregate: 'sum', field: 'issues' },
})
const issueStarter = (
  title: string,
  plan: Pick<PanelPlan, 'columns' | 'stages' | 'view'> & Pick<PanelPlan, 'sort'>,
): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [
    {
      id: 'issues',
      label: 'Issues',
      role: 'primary',
      reference: {
        kind: 'inline',
        bindings: {},
        content: {
          name: 'Issues',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          sourceParameters: {},
          query: { source: { pluginId: 'github', sourceId: 'issues' }, scope: { parameters: {} }, sort: [] },
        },
      },
    },
  ],
  ...plan,
})
const issueStarterPlans: PanelPlan[] = [
  issueStarter('Open issues by label', {
    columns: [issueColumn('state', 'State', 'enum'), issueColumn('labels', 'Labels', 'text', true)],
    stages: [
      openIssues,
      { op: 'expand', column: 'labels', output: 'label', perRow: 100 },
      { op: 'summarize', by: [{ column: 'label' }], measures: [{ id: 'issues', label: 'Issues', kind: 'count' }] },
    ],
    sort: [{ column: 'issues', direction: 'desc' }],
    view: { kind: 'chart', shape: 'bar', x: 'label', aggregate: 'sum', field: 'issues' },
  }),
  issueStarter('Issues opened per week', {
    columns: [issueColumn('createdAt', 'Opened', 'datetime'), issueColumn('state', 'State', 'enum')],
    ...perWeek('createdAt', 'state'),
  }),
  issueStarter('Issues closed per week', {
    columns: [issueColumn('closedAt', 'Closed', 'datetime'), issueColumn('closeReason', 'Close reason', 'enum')],
    ...perWeek('closedAt', 'closeReason'),
  }),
  issueStarter('Open issues assigned to me', {
    columns: [
      issueColumn('title', 'Title', 'text'),
      issueColumn('repository', 'Repository', 'text'),
      issueColumn('state', 'State', 'enum'),
      issueColumn('assignees', 'Assignees', 'person', true),
      issueColumn('labels', 'Labels', 'text', true),
      issueColumn('updatedAt', 'Updated', 'datetime'),
      issueColumn('url', 'Link', 'link'),
    ],
    stages: [openIssues, keep('assignees', 'contains', { from: 'context', name: 'viewer', pointer: '/login' })],
    sort: [{ column: 'updatedAt', direction: 'desc' }],
    view: { kind: 'list' },
  }),
]

const searchable = (operators: DataOperator[], sortable = false) => ({ operators, sortable })
const ordered = searchable(['gt', 'gte', 'lt', 'lte'], true)

export const issueSourceDescription: DataSourceDescription = {
  projectScope: { kind: 'repository', parameter: '/repositories', record: '/repository' },
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      number: { type: 'number' },
      title: { type: 'string' },
      repository: { type: 'string' },
      url: { type: 'string' },
      state: { type: 'string', enum: ['open', 'closed'] },
      closeReason: { type: ['string', 'null'] },
      author: { type: ['string', 'null'] },
      assignees: { type: 'array', items: { type: 'string' } },
      labels: { type: 'array', items: { type: 'string' } },
      milestone: { type: ['string', 'null'] },
      comments: { type: 'number' },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
      closedAt: { type: ['number', 'null'] },
    },
    required: [
      'id',
      'number',
      'title',
      'repository',
      'url',
      'state',
      'closeReason',
      'author',
      'assignees',
      'labels',
      'milestone',
      'comments',
      'createdAt',
      'updatedAt',
      'closedAt',
    ],
  },
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    {
      pointer: '/number',
      label: 'Number',
      origin: 'declared',
      display: { kind: 'number' },
      query: searchable([], true),
    },
    { pointer: '/repository', label: 'Repository', origin: 'declared' },
    { pointer: '/url', label: 'URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
    {
      pointer: '/state',
      label: 'State',
      origin: 'declared',
      display: { kind: 'status', role: 'status' },
      query: searchable(['eq']),
      choices: {
        kind: 'static',
        values: [
          { id: 'open', label: 'Open', tone: 'accent' },
          { id: 'closed', label: 'Closed', tone: 'muted' },
        ],
      },
    },
    {
      pointer: '/closeReason',
      label: 'Close reason',
      origin: 'declared',
      display: { kind: 'status' },
      choices: {
        kind: 'static',
        values: [
          { id: 'completed', label: 'Completed', tone: 'ok' },
          { id: 'not_planned', label: 'Not planned', tone: 'muted' },
          { id: 'duplicate', label: 'Duplicate', tone: 'muted' },
        ],
      },
    },
    {
      pointer: '/author',
      label: 'Author login',
      origin: 'declared',
      display: { kind: 'person' },
      viewerMatch: '/login',
      query: searchable(['eq']),
    },
    {
      pointer: '/assignees',
      label: 'Assignees',
      origin: 'declared',
      display: { kind: 'person', list: true, role: 'assignee' },
      viewerMatch: '/login',
      query: searchable(['contains']),
    },
    {
      pointer: '/labels',
      label: 'Labels',
      origin: 'declared',
      display: { kind: 'text', list: true },
      query: searchable(['contains']),
    },
    { pointer: '/milestone', label: 'Milestone', origin: 'declared' },
    {
      pointer: '/comments',
      label: 'Comments',
      origin: 'declared',
      display: { kind: 'number' },
      query: searchable([], true),
    },
    { pointer: '/createdAt', label: 'Created', origin: 'declared', display: { kind: 'datetime' }, query: ordered },
    {
      pointer: '/updatedAt',
      label: 'Updated',
      origin: 'declared',
      display: { kind: 'datetime', role: 'updated' },
      query: ordered,
    },
    // Not sortable: an open issue has no close time to order by.
    {
      pointer: '/closedAt',
      label: 'Closed',
      origin: 'declared',
      display: { kind: 'datetime' },
      query: searchable(['gt', 'gte', 'lt', 'lte']),
    },
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
  starterPlans: issueStarterPlans,
  reach: {
    parameter: '/repositories',
    itemPlural: 'repositories',
    default: 'linked repositories',
    empty: 'no linked repositories',
  },
  consistency:
    'Reads are restricted to linked repositories. An explicit list selects a subset. Pull requests are left out. Search is eventually consistent, with no snapshot isolation during pagination. Up to 1,000 matches are fully read. A larger search returns no rows and says it is incomplete, so narrow it with repositories or conditions.',
}
