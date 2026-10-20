import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { after, sourceShape, starterSource } from './sourceShape'

// One record per tool call of a finished turn, read from its facts (docs/managed-agents/turn-facts.md).

const equals = { operators: ['eq' as const], sortable: false }

const toolCallShape = sourceShape([
  {
    key: 'tool',
    type: 'string',
    nullable: true,
    label: 'Tool',
    description: "The MCP tool's name, or the call's kind, such as execute or edit, for a built-in tool.",
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
        { id: 'completed', label: 'Completed', tone: 'ok' },
        { id: 'failed', label: 'Failed', tone: 'bad' },
        { id: 'cancelled', label: 'Cancelled', tone: 'muted' },
        { id: 'interrupted', label: 'Interrupted', tone: 'warn' },
        { id: 'running', label: 'Running', tone: 'accent' },
        { id: 'pending', label: 'Pending', tone: 'muted' },
        { id: 'unknown', label: 'Unknown', tone: 'muted' },
      ],
    },
  },
  { key: 'exitCode', type: 'number', nullable: true, label: 'Exit code' },
  {
    key: 'failed',
    type: 'boolean',
    label: 'Failed',
    description: 'The call failed, or its command exited with a nonzero code.',
    query: equals,
  },
  { key: 'inSubagent', type: 'boolean', label: 'In a subagent', query: equals },
  { key: 'seq', type: 'number', label: 'Event', description: "The sequence number of the call's first event." },
  { key: 'sessionId', type: 'string', label: 'Session', query: equals },
  { key: 'turnId', type: 'string', label: 'Turn', query: equals },
  { key: 'taskId', type: 'string', label: 'Task', query: equals },
  { key: 'taskTitle', type: 'string', nullable: true, label: 'Task title', display: { kind: 'text', role: 'title' } },
  { key: 'projectId', type: 'string', nullable: true, label: 'Project', query: equals },
  { key: 'projectName', type: 'string', nullable: true, label: 'Project name' },
  {
    key: 'provider',
    type: 'string',
    label: 'Provider',
    query: equals,
    choices: { kind: 'dynamic', dependsOn: [] },
  },
  {
    key: 'startedAt',
    type: 'number',
    label: 'Started',
    display: { kind: 'datetime', role: 'updated' },
    query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
  },
  {
    key: 'durationMs',
    type: 'number',
    nullable: true,
    label: 'Duration',
    description: 'From the first update to the last, for a call that settled. Null when one end is unknown.',
    display: { kind: 'number', unit: 'ms' },
  },
])

const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
): PanelPlan['columns'][number] => ({ id, label, type, bind: { 'tool-calls': { field: `/${id}` } } })
const plan = (title: string, rest: Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [starterSource('tool-calls', 'Agent tool calls')],
  ...rest,
})
const started = column('startedAt', 'Started', 'datetime')
const tool = column('tool', 'Tool', 'text')
// A filter the source answers in SQL, so a failures panel reads only the failures and stays inside
// the record budget on a busy week.
const onlyFailed: PanelPlan['stages'][number] = {
  op: 'filter',
  where: {
    kind: 'comparison',
    left: { address: { from: 'item', pointer: '/failed' } },
    operator: 'eq',
    right: { address: { from: 'literal', value: true } },
  },
}
const calls = { id: 'calls', label: 'Calls', kind: 'count' as const }

const toolCallStarterPlans: PanelPlan[] = [
  plan('Tools that fail most this week', {
    columns: [started, tool, column('failed', 'Failed', 'boolean')],
    stages: [
      onlyFailed,
      after('/startedAt', { address: { from: 'context', name: 'calendar', boundary: 'startOfWeek' } }),
      { op: 'summarize', by: [{ column: 'tool' }], measures: [{ ...calls, label: 'Failed calls' }] },
    ],
    sort: [{ column: 'calls', direction: 'desc' }],
    view: { kind: 'chart', shape: 'bar', x: 'tool', aggregate: 'sum', field: 'calls' },
  }),
  plan('When tool calls fail, last two weeks', {
    // Two columns read the same start time: one buckets it by weekday, the other by hour.
    columns: [
      started,
      column('failed', 'Failed', 'boolean'),
      { id: 'weekday', label: 'Weekday', type: 'datetime', bind: { 'tool-calls': { field: '/startedAt' } } },
      { id: 'hour', label: 'Hour', type: 'datetime', bind: { 'tool-calls': { field: '/startedAt' } } },
    ],
    stages: [
      onlyFailed,
      after('/startedAt', { address: { from: 'context', name: 'now', offset: '-P14D' } }),
      {
        op: 'summarize',
        by: [
          { column: 'weekday', bucket: 'weekday' },
          { column: 'hour', bucket: 'hour' },
        ],
        measures: [{ ...calls, label: 'Failed calls' }],
      },
    ],
    view: { kind: 'heatmap', y: 'weekday', x: 'hour', aggregate: 'sum', field: 'calls' },
  }),
  plan('Tool calls today by hour', {
    columns: [started, tool],
    stages: [
      after('/startedAt', { address: { from: 'context', name: 'calendar', boundary: 'startOfDay' } }),
      {
        op: 'summarize',
        by: [{ column: 'startedAt', bucket: 'hour' }, { column: 'tool' }],
        measures: [calls],
      },
    ],
    view: {
      kind: 'chart',
      shape: 'bar',
      x: 'startedAt',
      series: 'tool',
      stacked: true,
      aggregate: 'sum',
      field: 'calls',
    },
  }),
]

export const toolCallSourceDescription: DataSourceDescription = {
  revision: '1',
  ...toolCallShape,
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'events', retention: 'Until the owning task is deleted', complete: false },
  starterPlans: toolCallStarterPlans,
  consistency:
    "One row per tool call of a finished turn, its subagents' calls included. No tool input, output, or title. A busy day can hold more calls than one read returns, so filter on failures, a tool, or a session to read a longer window whole.",
  targets: [{ kind: 'agents.session' }],
}
