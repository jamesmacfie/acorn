import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// One record per finished run target, setup script, or teardown script (docs/terminal/run-targets.md
// § Run history).

const equals = { operators: ['eq' as const], sortable: false }
const fields: (Omit<DataSourceDescription['fields'][number], 'pointer' | 'origin'> & {
  key: string
  type: 'string' | 'number'
  nullable?: true
})[] = [
  { key: 'name', type: 'string', label: 'Run', display: { kind: 'text', role: 'title' } },
  {
    key: 'kind',
    type: 'string',
    label: 'Kind',
    query: equals,
    choices: {
      kind: 'static',
      values: [
        { id: 'target', label: 'Run target' },
        { id: 'setup', label: 'Setup script' },
        { id: 'teardown', label: 'Teardown script' },
      ],
    },
  },
  {
    key: 'outcome',
    type: 'string',
    label: 'Outcome',
    display: { kind: 'status', role: 'status' },
    query: equals,
    choices: {
      kind: 'static',
      values: [
        { id: 'succeeded', label: 'Succeeded', tone: 'ok' },
        { id: 'failed', label: 'Failed', tone: 'bad' },
        { id: 'killed', label: 'Killed', tone: 'warn' },
      ],
    },
  },
  { key: 'exitCode', type: 'number', nullable: true, label: 'Exit code', display: { kind: 'number' } },
  { key: 'startedAt', type: 'number', label: 'Started', display: { kind: 'datetime' } },
  {
    key: 'finishedAt',
    type: 'number',
    label: 'Finished',
    display: { kind: 'datetime', role: 'updated' },
    query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
  },
  {
    key: 'durationMs',
    type: 'number',
    label: 'Duration',
    display: { kind: 'number', unit: 'ms' },
    query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
  },
  { key: 'taskId', type: 'string', label: 'Task', query: equals },
  { key: 'taskTitle', type: 'string', nullable: true, label: 'Task title' },
  { key: 'projectName', type: 'string', nullable: true, label: 'Project name' },
]

const source: PanelPlan['sources'][number] = {
  id: 'runs',
  label: 'Terminal runs',
  role: 'primary',
  reference: {
    kind: 'inline',
    bindings: {},
    content: {
      name: 'Terminal runs',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {},
      query: { source: { pluginId: 'terminal', sourceId: 'runs' }, scope: { parameters: {} }, sort: [] },
    },
  },
}
const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
  field = id,
): PanelPlan['columns'][number] => ({ id, label, type, bind: { runs: { field: `/${field}` } } })
const plan = (title: string, rest: Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [source],
  ...rest,
})
const finishedAfter = (right: DataBinding): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/finishedAt' } }, operator: 'gt', right },
})
const last30Days = finishedAfter({ address: { from: 'context', name: 'now', offset: '-P30D' } })
const finished = column('finishedAt', 'Finished', 'datetime')
const name = column('name', 'Run', 'text')
const task = column('taskTitle', 'Task', 'text')
const outcome = column('outcome', 'Outcome', 'enum')

const runStarterPlans: PanelPlan[] = [
  plan('Failed runs this week', {
    columns: [name, task, column('exitCode', 'Exit code', 'number'), finished, outcome],
    stages: [
      finishedAfter({ address: { from: 'context', name: 'calendar', boundary: 'startOfWeek' } }),
      {
        op: 'filter',
        where: {
          kind: 'comparison',
          left: { address: { from: 'item', pointer: '/outcome' } },
          operator: 'eq',
          right: { address: { from: 'literal', value: 'failed' } },
        },
      },
    ],
    sort: [{ column: 'finishedAt', direction: 'desc' }],
    view: { kind: 'list' },
  }),
  plan('Slowest runs, last 30 days', {
    columns: [name, task, column('durationMs', 'Duration', 'number'), outcome, finished],
    stages: [last30Days],
    sort: [{ column: 'durationMs', direction: 'desc' }],
    limit: 20,
    view: { kind: 'list' },
  }),
  plan('Runs by day by outcome, last 30 days', {
    columns: [finished, outcome],
    stages: [
      last30Days,
      {
        op: 'summarize',
        by: [{ column: 'finishedAt', bucket: 'day' }, { column: 'outcome' }],
        measures: [{ id: 'runs', label: 'Runs', kind: 'count' }],
      },
    ],
    view: {
      kind: 'chart',
      shape: 'bar',
      x: 'finishedAt',
      series: 'outcome',
      stacked: true,
      aggregate: 'sum',
      field: 'runs',
    },
  }),
  plan('When runs start, last four weeks', {
    // Two columns read the same start time: one buckets it by weekday, the other by hour.
    columns: [
      finished,
      column('weekday', 'Weekday', 'datetime', 'startedAt'),
      column('hour', 'Hour', 'datetime', 'startedAt'),
    ],
    stages: [
      finishedAfter({ address: { from: 'context', name: 'now', offset: '-P28D' } }),
      {
        op: 'summarize',
        by: [
          { column: 'weekday', bucket: 'weekday' },
          { column: 'hour', bucket: 'hour' },
        ],
        measures: [{ id: 'runs', label: 'Runs', kind: 'count' }],
      },
    ],
    view: { kind: 'heatmap', y: 'weekday', x: 'hour', aggregate: 'sum', field: 'runs' },
  }),
]

export const runSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      fields.map(({ key, type, nullable }) => [key, { type: nullable ? [type, 'null'] : type }]),
    ),
    required: fields.map(({ key }) => key),
  },
  fields: fields.map(({ key, type: _type, nullable: _nullable, ...field }) => ({
    pointer: `/${key}`,
    origin: 'declared' as const,
    ...field,
  })),
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'events', retention: 'The newest 5,000 runs, until the owning task is deleted', complete: true },
  starterPlans: runStarterPlans,
  consistency:
    'One row per finished run target, setup script, or teardown script that acorn started. Shells and agents are not runs. A run is killed when acorn stopped it, its tab was closed, or a signal ended it; one cut off by the Node stopping is not recorded. Runs before this table existed are not recorded. Once the table holds 5,000 runs, a read covers from the oldest one kept.',
}
