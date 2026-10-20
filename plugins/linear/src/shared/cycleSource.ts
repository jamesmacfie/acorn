import type { DataSourceDescription, DataSourceRegistration } from '@acorn/protocol/dataSources.ts'
import { starterPlans } from './starterPlans'

export const cycleSource: DataSourceRegistration = {
  sourceId: 'cycles',
  name: 'Linear cycles',
  singular: 'Cycle',
  plural: 'Cycles',
  providerId: 'linear',
  identityScope: 'Linear cycle UUID in the selected connection',
  handler: '/v1/p/linear/data/cycles',
  titlePointer: '/title',
  urlPointer: '/url',
  icon: 'brand:linear',
}

/** How Linear itself names a cycle: its name, or its number when it has none. */
export const cycleTitle = (cycle: { number: number; name: string | null }) => cycle.name || `Cycle ${cycle.number}`

const time = { operators: ['gt' as const, 'gte' as const, 'lt' as const, 'lte' as const], sortable: true }
const count = { kind: 'number' as const }

const { plan, column, filter } = starterPlans(cycleSource.sourceId, cycleSource.name)
const title = column('title', 'Cycle', 'text')
const team = column('team', 'Team', 'text', '/team/name')
const progress = column('progress', 'Progress', 'number')
const completed = column('completedIssueCount', 'Completed', 'number')
const total = column('issueCount', 'Issues', 'number')
const added = column('addedIssueCount', 'Added', 'number')
const ends = column('endsAt', 'Ends', 'datetime')
// Filters name a plan column, so each plan that filters on status carries the column, hidden.
const status = { ...column('status', 'Status', 'enum'), hidden: true }
const isStatus = (value: string) => filter('/status', 'eq', { address: { from: 'literal', value } })

const cycleStarterPlans = [
  plan('Active cycles', {
    columns: [title, team, progress, completed, total, added, ends, status],
    stages: [isStatus('active')],
    sort: [{ column: 'endsAt', direction: 'asc' }],
    view: { kind: 'list' },
  }),
  plan('Cycles finished in the last 12 weeks', {
    columns: [title, team, progress, completed, total, added, ends, status],
    stages: [isStatus('past'), filter('/endsAt', 'gt', { address: { from: 'context', name: 'now', offset: '-P12W' } })],
    sort: [{ column: 'endsAt', direction: 'desc' }],
    view: { kind: 'list' },
  }),
  plan('Issues completed per cycle, by team', {
    columns: [team, completed, ends, status],
    stages: [
      isStatus('past'),
      filter('/endsAt', 'gt', { address: { from: 'context', name: 'now', offset: '-P24W' } }),
      {
        op: 'summarize',
        by: [{ column: 'endsAt', bucket: 'week' }, { column: 'team' }],
        measures: [{ id: 'completed', label: 'Completed', kind: 'sum', column: 'completedIssueCount' }],
      },
    ],
    view: { kind: 'chart', shape: 'bar', x: 'endsAt', series: 'team', aggregate: 'sum', field: 'completed' },
  }),
]

export const cycleSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      number: { type: 'number' },
      title: { type: 'string' },
      url: { type: 'string' },
      team: {
        type: 'object',
        additionalProperties: false,
        properties: { id: { type: 'string' }, key: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'key', 'name'],
      },
      status: { type: 'string' },
      startsAt: { type: 'number' },
      endsAt: { type: 'number' },
      completedAt: { type: ['number', 'null'] },
      progress: { type: 'number' },
      issueCount: { type: ['number', 'null'] },
      completedIssueCount: { type: ['number', 'null'] },
      addedIssueCount: { type: ['number', 'null'] },
    },
    required: [
      'id',
      'number',
      'title',
      'url',
      'team',
      'status',
      'startsAt',
      'endsAt',
      'completedAt',
      'progress',
      'issueCount',
      'completedIssueCount',
      'addedIssueCount',
    ],
  },
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    {
      pointer: '/number',
      label: 'Number',
      origin: 'declared',
      display: { kind: 'number' },
      query: { operators: [], sortable: true },
    },
    { pointer: '/url', label: 'URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
    {
      pointer: '/team/id',
      label: 'Team',
      origin: 'declared',
      query: { operators: ['eq'], sortable: false },
      choices: { kind: 'dynamic', dependsOn: [] },
    },
    { pointer: '/team/name', label: 'Team name', origin: 'declared' },
    { pointer: '/team/key', label: 'Team key', origin: 'declared' },
    {
      pointer: '/status',
      label: 'Status',
      origin: 'declared',
      description: 'Whether the cycle is running now, still to come, or over. A cycle completed early is over.',
      display: { kind: 'status', role: 'status' },
      query: { operators: ['eq'], sortable: false },
      choices: {
        kind: 'static',
        values: [
          { id: 'active', label: 'Active', tone: 'accent', rank: 1 },
          { id: 'upcoming', label: 'Upcoming', tone: 'muted', rank: 2 },
          { id: 'past', label: 'Past', tone: 'muted', rank: 3 },
        ],
      },
    },
    { pointer: '/startsAt', label: 'Starts', origin: 'declared', display: { kind: 'datetime' }, query: time },
    { pointer: '/endsAt', label: 'Ends', origin: 'declared', display: { kind: 'datetime' }, query: time },
    { pointer: '/completedAt', label: 'Completed', origin: 'declared', display: { kind: 'datetime' } },
    {
      pointer: '/progress',
      label: 'Progress',
      origin: 'declared',
      description:
        "Linear's progress, as a percentage: completed estimate points plus a quarter of in-progress points, over all points. 0 when no issue has an estimate.",
      display: { kind: 'number', unit: 'percent' },
    },
    {
      pointer: '/issueCount',
      label: 'Issues',
      origin: 'declared',
      description: "Issues in the cycle at Linear's latest end-of-day count. Empty before the cycle's first day ends.",
      display: count,
    },
    {
      pointer: '/completedIssueCount',
      label: 'Completed issues',
      origin: 'declared',
      description: "Completed issues at Linear's latest end-of-day count.",
      display: count,
    },
    {
      pointer: '/addedIssueCount',
      label: 'Issues added',
      origin: 'declared',
      description:
        'How many more issues the cycle holds now than at the end of its first day. Issues removed count against it, so it can be negative.',
      display: count,
    },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  starterPlans: cycleStarterPlans,
  consistency:
    'Every cycle of every team the selected Linear account reaches, archived cycles included. No snapshot isolation across upstream pages. At most 5,000 candidates are exhausted before stable sorting; a larger selection is incomplete. Continuations retain the selection for 60 seconds.',
}
