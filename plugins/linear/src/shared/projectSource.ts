import type { DataSourceDescription, DataSourceRegistration } from '@acorn/protocol/dataSources.ts'
import { starterPlans } from './starterPlans'

export const projectSource: DataSourceRegistration = {
  sourceId: 'projects',
  name: 'Linear projects',
  singular: 'Project',
  plural: 'Projects',
  providerId: 'linear',
  identityScope: 'Linear project UUID in the selected connection',
  handler: '/v1/p/linear/data/projects',
  titlePointer: '/name',
  urlPointer: '/url',
  icon: 'brand:linear',
}

// Linear's fixed status types. A workspace names its own statuses, but each one has one of these.
export const PROJECT_STATUS_TYPES = ['started', 'planned', 'paused', 'backlog', 'completed', 'canceled'] as const

const time = { operators: ['gt' as const, 'gte' as const, 'lt' as const, 'lte' as const], sortable: true }

const { plan, column, filter } = starterPlans(projectSource.sourceId, projectSource.name)
const name = column('name', 'Project', 'text')
const status = column('status', 'Status', 'enum', '/status/type')
const lead = column('lead', 'Lead', 'person')
const teams = { ...column('teams', 'Teams', 'text'), list: true }
const progress = column('progress', 'Progress', 'number')
const target = { ...column('targetDate', 'Target date', 'datetime'), precision: 'day' as const }
// Filters name a plan column, not a source field.
const statusIs = (operator: 'eq' | 'ne', type: string) =>
  filter('/status', operator, { address: { from: 'literal', value: type } })

const projectStarterPlans = [
  plan('Projects in progress', {
    columns: [
      name,
      lead,
      teams,
      progress,
      target,
      column('updatedAt', 'Updated', 'datetime'),
      { ...status, hidden: true },
    ],
    stages: [statusIs('eq', 'started')],
    sort: [{ column: 'targetDate', direction: 'asc', empty: 'last' }],
    view: { kind: 'list' },
  }),
  plan('Projects by status', {
    columns: [status],
    stages: [
      { op: 'summarize', by: [{ column: 'status' }], measures: [{ id: 'projects', label: 'Projects', kind: 'count' }] },
    ],
    view: { kind: 'chart', shape: 'bar', x: 'status', aggregate: 'sum', field: 'projects' },
  }),
  plan('Projects past their target date', {
    columns: [name, status, lead, progress, target],
    stages: [
      statusIs('ne', 'completed'),
      statusIs('ne', 'canceled'),
      filter('/targetDate', 'lt', { address: { from: 'context', name: 'calendar', boundary: 'startOfDay' } }),
    ],
    sort: [{ column: 'targetDate', direction: 'asc' }],
    view: { kind: 'list' },
  }),
  plan('Projects completed in the last 12 weeks', {
    columns: [name, lead, teams, target, column('completedAt', 'Completed', 'datetime')],
    stages: [filter('/completedAt', 'gt', { address: { from: 'context', name: 'now', offset: '-P12W' } })],
    sort: [{ column: 'completedAt', direction: 'desc' }],
    view: { kind: 'list' },
  }),
]

const STATUS_CHOICES = {
  started: ['In progress', 'accent'],
  planned: ['Planned', 'muted'],
  paused: ['Paused', 'warn'],
  backlog: ['Backlog', 'muted'],
  completed: ['Completed', 'ok'],
  canceled: ['Canceled', 'muted'],
} as const

export const projectSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      url: { type: 'string' },
      status: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { type: 'string' }, type: { type: 'string' } },
        required: ['name', 'type'],
      },
      lead: { type: ['string', 'null'] },
      teams: { type: 'array', items: { type: 'string' } },
      progress: { type: 'number' },
      targetDate: { type: ['string', 'null'] },
      startedAt: { type: ['number', 'null'] },
      completedAt: { type: ['number', 'null'] },
      updatedAt: { type: 'number' },
    },
    required: [
      'id',
      'name',
      'url',
      'status',
      'lead',
      'teams',
      'progress',
      'targetDate',
      'startedAt',
      'completedAt',
      'updatedAt',
    ],
  },
  fields: [
    { pointer: '/name', label: 'Name', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/url', label: 'URL', origin: 'declared', display: { kind: 'link', role: 'url' } },
    {
      pointer: '/status/type',
      label: 'Status',
      origin: 'declared',
      description: "The kind of status, which every workspace shares. The status's own name is Status name.",
      display: { kind: 'status', role: 'status' },
      query: { operators: ['eq'], sortable: false },
      choices: {
        kind: 'static',
        values: PROJECT_STATUS_TYPES.map((id, index) => ({
          id,
          label: STATUS_CHOICES[id][0],
          tone: STATUS_CHOICES[id][1],
          rank: index + 1,
        })),
      },
    },
    { pointer: '/status/name', label: 'Status name', origin: 'declared' },
    { pointer: '/lead', label: 'Lead', origin: 'declared', display: { kind: 'person', role: 'assignee' } },
    {
      pointer: '/teams',
      label: 'Teams',
      origin: 'declared',
      description: "The project's teams, up to its first 25.",
      display: { kind: 'text', list: true },
    },
    {
      pointer: '/progress',
      label: 'Progress',
      origin: 'declared',
      description: "Linear's progress for the project, as a percentage.",
      display: { kind: 'number', unit: 'percent' },
    },
    {
      pointer: '/targetDate',
      label: 'Target date',
      origin: 'declared',
      display: { kind: 'datetime', precision: 'day' },
    },
    { pointer: '/startedAt', label: 'Started', origin: 'declared', display: { kind: 'datetime' }, query: time },
    { pointer: '/completedAt', label: 'Completed', origin: 'declared', display: { kind: 'datetime' }, query: time },
    {
      pointer: '/updatedAt',
      label: 'Updated',
      origin: 'declared',
      display: { kind: 'datetime', role: 'updated' },
      query: time,
    },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  starterPlans: projectStarterPlans,
  consistency:
    'Every project the selected Linear account reaches, archived projects excluded, without descriptions. No snapshot isolation across upstream pages. At most 5,000 candidates are exhausted before stable sorting; a larger selection is incomplete. Continuations retain the selection for 60 seconds.',
}
