import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// One record per workflow run, child runs included (docs/workflows.md § Workflow runs source).

type Field = DataSourceDescription['fields'][number]
type FieldSpec = Omit<Field, 'pointer' | 'origin'> & {
  key: string
  type: 'string' | 'number'
  nullable?: true
}

const equals = { operators: ['eq' as const], sortable: false }

const fieldSpecs: FieldSpec[] = [
  { key: 'runId', type: 'string', label: 'Run' },
  {
    key: 'name',
    type: 'string',
    label: 'Workflow',
    display: { kind: 'text', role: 'title' },
    query: equals,
    choices: { kind: 'dynamic', dependsOn: [] },
  },
  {
    key: 'status',
    type: 'string',
    label: 'Status',
    display: { kind: 'status', role: 'status' },
    query: equals,
    choices: {
      kind: 'static',
      values: [
        { id: 'running', label: 'Running', tone: 'accent' },
        { id: 'gated', label: 'Waiting on you', tone: 'warn' },
        { id: 'cancelling', label: 'Cancelling', tone: 'muted' },
        { id: 'done', label: 'Done', tone: 'ok' },
        { id: 'completed-with-failures', label: 'Done with failures', tone: 'warn' },
        { id: 'failed', label: 'Failed', tone: 'bad' },
        { id: 'safety-rail', label: 'Stopped by a safety rail', tone: 'bad' },
        { id: 'cancelled', label: 'Cancelled', tone: 'muted' },
      ],
    },
  },
  {
    key: 'trigger',
    type: 'string',
    label: 'Started by',
    query: equals,
    choices: { kind: 'dynamic', dependsOn: [] },
  },
  { key: 'taskId', type: 'string', label: 'Task', query: equals },
  { key: 'taskTitle', type: 'string', nullable: true, label: 'Task title' },
  { key: 'projectId', type: 'string', nullable: true, label: 'Project', query: equals },
  { key: 'projectName', type: 'string', nullable: true, label: 'Project name' },
  {
    key: 'parentRunId',
    type: 'string',
    nullable: true,
    label: 'Parent run',
    description: 'The run that started this one as a child, or null for a run started on its own.',
    query: equals,
  },
  { key: 'depth', type: 'number', label: 'Nesting depth', display: { kind: 'number' } },
  {
    key: 'error',
    type: 'string',
    nullable: true,
    label: 'Error',
    description: "The first line of the run's error or cancel reason, at most 200 characters.",
  },
  {
    key: 'createdAt',
    type: 'number',
    label: 'Started',
    display: { kind: 'datetime', role: 'updated' },
    query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
  },
  { key: 'updatedAt', type: 'number', label: 'Last update', display: { kind: 'datetime' } },
  {
    key: 'durationMs',
    type: 'number',
    nullable: true,
    label: 'Duration',
    description: 'From start to its final status, or null while the run is still going.',
    display: { kind: 'number', unit: 'ms' },
  },
]

const source: PanelPlan['sources'][number] = {
  id: 'runs',
  label: 'Workflow runs',
  role: 'primary',
  // No workspace: the launcher moves a starter onto the scope the person picked (docs/data-sources.md).
  reference: {
    kind: 'inline',
    bindings: {},
    content: {
      name: 'Workflow runs',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {},
      query: { source: { pluginId: 'workflows', sourceId: 'runs' }, scope: { parameters: {} }, sort: [] },
    },
  },
}
const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
  unit?: string,
): PanelPlan['columns'][number] => ({
  id,
  label,
  type,
  bind: { runs: { field: `/${id}` } },
  ...(unit ? { unit } : {}),
})
const startedAfter = (right: DataBinding): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/createdAt' } }, operator: 'gt', right },
})
const plan = (title: string, rest: Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [source],
  ...rest,
})
const last30Days = startedAfter({ address: { from: 'context', name: 'now', offset: '-P30D' } })
const started = column('createdAt', 'Started', 'datetime')
const workflow = column('name', 'Workflow', 'text')
const status = column('status', 'Status', 'enum')

const runStarterPlans: PanelPlan[] = [
  plan('Runs by workflow and status, last 30 days', {
    columns: [started, workflow, status],
    stages: [
      last30Days,
      {
        op: 'summarize',
        by: [{ column: 'name' }, { column: 'status' }],
        measures: [{ id: 'runs', label: 'Runs', kind: 'count' }],
      },
    ],
    view: { kind: 'chart', shape: 'bar', x: 'name', series: 'status', stacked: true, aggregate: 'sum', field: 'runs' },
  }),
  plan('Average run time by workflow, last 30 days', {
    columns: [started, workflow, column('durationMs', 'Duration', 'number', 'ms')],
    stages: [
      last30Days,
      // Only settled runs have a duration, so the average leaves no unknown values out.
      {
        op: 'filter',
        where: {
          kind: 'comparison',
          left: { address: { from: 'item', pointer: '/durationMs' } },
          operator: 'gte',
          right: { address: { from: 'literal', value: 0 } },
        },
      },
      {
        op: 'summarize',
        by: [{ column: 'name' }],
        measures: [{ id: 'average', label: 'Average run time', kind: 'average', column: 'durationMs' }],
      },
    ],
    sort: [{ column: 'average', direction: 'desc' }],
    view: { kind: 'chart', shape: 'bar', x: 'name', aggregate: 'sum', field: 'average' },
  }),
  plan('Runs this week', {
    columns: [
      workflow,
      status,
      column('taskTitle', 'Task', 'text'),
      column('error', 'Error', 'text'),
      started,
      column('durationMs', 'Duration', 'number', 'ms'),
    ],
    stages: [startedAfter({ address: { from: 'context', name: 'calendar', boundary: 'startOfWeek' } })],
    sort: [{ column: 'createdAt', direction: 'desc' }],
    view: { kind: 'list' },
  }),
  plan('When workflows run, last four weeks', {
    // Two columns read the same start time: one buckets it by weekday, the other by hour.
    columns: [
      started,
      { id: 'weekday', label: 'Weekday', type: 'datetime', bind: { runs: { field: '/createdAt' } } },
      { id: 'hour', label: 'Hour', type: 'datetime', bind: { runs: { field: '/createdAt' } } },
    ],
    stages: [
      startedAfter({ address: { from: 'context', name: 'now', offset: '-P28D' } }),
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
      fieldSpecs.map(({ key, type, nullable }) => [key, { type: nullable ? [type, 'null'] : type }]),
    ),
    required: fieldSpecs.map(({ key }) => key),
  },
  fields: fieldSpecs.map(({ key, type: _type, nullable: _nullable, ...field }) => ({
    pointer: `/${key}`,
    origin: 'declared' as const,
    ...field,
  })),
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'events', retention: 'Until the owning task is deleted', complete: true },
  starterPlans: runStarterPlans,
  // A trigger never reads its own runs, so this can't start itself again.
  starterTriggers: [
    {
      id: 'run-fails',
      label: 'A run fails',
      description: 'Starts a run when a workflow run fails, and again if it fails after a retry.',
      predicate: {
        kind: 'comparison',
        left: { address: { from: 'item', pointer: '/status' } },
        operator: 'eq',
        right: { address: { from: 'literal', value: 'failed' } },
      },
      change: { on: 'enters' },
    },
  ],
  consistency:
    'One row per workflow run, child runs included. Duration is the time from start to the final status, so a run retried after it settled measures to its latest one.',
  targets: [{ kind: 'workflows.run' }],
}
