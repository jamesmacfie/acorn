import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { after, sourceShape, starterSource } from './sourceShape'

// One record per finished turn, read from its facts (docs/managed-agents/turn-facts.md).

const ms = { kind: 'number', unit: 'ms' } as const
const tokens = { kind: 'number', unit: 'tokens' } as const
const usd = { kind: 'number', unit: 'USD' } as const
const count = { kind: 'number' } as const
const equals = { operators: ['eq' as const], sortable: false }

const turnShape = sourceShape([
  { key: 'turnId', type: 'string', label: 'Turn' },
  { key: 'sessionId', type: 'string', label: 'Session', query: equals },
  { key: 'taskId', type: 'string', label: 'Task', query: equals },
  { key: 'projectId', type: 'string', nullable: true, label: 'Project', query: equals },
  { key: 'ordinal', type: 'number', label: 'Turn number', display: count },
  {
    key: 'firstSeq',
    type: 'number',
    nullable: true,
    label: 'First event',
    description: "The sequence number of the turn's first event in its session.",
  },
  {
    key: 'provider',
    type: 'string',
    label: 'Provider',
    query: equals,
    choices: { kind: 'dynamic', dependsOn: [] },
  },
  {
    key: 'model',
    type: 'string',
    nullable: true,
    label: 'Model',
    query: equals,
    choices: { kind: 'dynamic', dependsOn: [] },
  },
  {
    key: 'source',
    type: 'string',
    label: 'Started by',
    query: equals,
    choices: {
      kind: 'static',
      values: [
        { id: 'interactive', label: 'You' },
        { id: 'workflow', label: 'Workflow' },
        { id: 'delegation', label: 'Delegation' },
        { id: 'delegation_report', label: 'Delegation report' },
        { id: 'automation', label: 'Automation' },
        { id: 'import', label: 'Import' },
        { id: 'plugin', label: 'Plugin' },
        { id: 'goal', label: 'Goal' },
      ],
    },
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
        { id: 'interrupted', label: 'Interrupted', tone: 'warn' },
        { id: 'cancelled', label: 'Cancelled', tone: 'muted' },
      ],
    },
  },
  { key: 'startedAt', type: 'number', label: 'Started', display: { kind: 'datetime' } },
  {
    key: 'completedAt',
    type: 'number',
    label: 'Finished',
    display: { kind: 'datetime', role: 'updated' },
    query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
  },
  { key: 'activeMs', type: 'number', label: 'Run time', display: ms },
  { key: 'firstOutputMs', type: 'number', nullable: true, label: 'Time to first output', display: ms },
  { key: 'approvalWaitMs', type: 'number', label: 'Waiting on you', display: ms },
  { key: 'approvals', type: 'number', label: 'Approvals and questions', display: count },
  { key: 'toolCalls', type: 'number', label: 'Tool calls', display: count },
  { key: 'toolFailures', type: 'number', label: 'Failed tool calls', display: count },
  { key: 'longestFailureRun', type: 'number', label: 'Most failures in a row', display: count },
  { key: 'failureRunSeq', type: 'number', nullable: true, label: 'Failure run start' },
  { key: 'repeatedCalls', type: 'number', label: 'Repeated calls', display: count },
  { key: 'repeatRunSeq', type: 'number', nullable: true, label: 'Repeat run start' },
  { key: 'filesChanged', type: 'number', label: 'Files changed', display: count },
  { key: 'filesRewritten', type: 'number', label: 'Files rewritten', display: count },
  { key: 'subagents', type: 'number', label: 'Subagents', display: count },
  { key: 'peakContextUsed', type: 'number', nullable: true, label: 'Peak context', display: tokens },
  { key: 'contextSize', type: 'number', nullable: true, label: 'Context window', display: tokens },
  {
    key: 'contextPeak',
    type: 'number',
    nullable: true,
    label: 'Peak context use',
    display: { kind: 'number', unit: 'percent' },
  },
  { key: 'inputTokens', type: 'number', label: 'Input tokens', display: tokens },
  { key: 'outputTokens', type: 'number', label: 'Output tokens', display: tokens },
  { key: 'cacheReadTokens', type: 'number', label: 'Cache read tokens', display: tokens },
  { key: 'cacheWriteTokens', type: 'number', label: 'Cache write tokens', display: tokens },
  { key: 'reportedCostUsd', type: 'number', nullable: true, label: 'Reported cost', display: usd },
  { key: 'costUsd', type: 'number', nullable: true, label: 'Cost', display: usd },
  {
    key: 'costSource',
    type: 'string',
    label: 'Cost provenance',
    choices: {
      kind: 'static',
      values: [
        { id: 'reported', label: 'Provider reported' },
        { id: 'estimated', label: 'Estimated' },
        { id: 'unknown', label: 'Unknown' },
      ],
    },
  },
  { key: 'taskTitle', type: 'string', nullable: true, label: 'Task title', display: { kind: 'text', role: 'title' } },
  { key: 'projectName', type: 'string', nullable: true, label: 'Project name' },
])

const source = starterSource('turns', 'Agent turns')
const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
  unit?: string,
): PanelPlan['columns'][number] => ({
  id,
  label,
  type,
  bind: { turns: { field: `/${id}` } },
  ...(unit ? { unit } : {}),
})
const plan = (title: string, rest: Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [source],
  ...rest,
})
const last30Days = after('/completedAt', { address: { from: 'context', name: 'now', offset: '-P30D' } })
const finished = column('completedAt', 'Finished', 'datetime')

const turnStarterPlans: PanelPlan[] = [
  plan('Spend by day, last 30 days', {
    columns: [finished, column('costUsd', 'Cost', 'number', 'USD')],
    stages: [last30Days],
    view: { kind: 'chart', shape: 'line', x: 'completedAt', aggregate: 'sum', field: 'costUsd' },
  }),
  plan('Spend this month by project', {
    columns: [finished, column('projectName', 'Project', 'text'), column('costUsd', 'Cost', 'number', 'USD')],
    stages: [
      after('/completedAt', { address: { from: 'context', name: 'calendar', boundary: 'startOfMonth' } }),
      {
        op: 'summarize',
        by: [{ column: 'projectName' }],
        measures: [{ id: 'cost', label: 'Cost', kind: 'sum', column: 'costUsd' }],
      },
    ],
    sort: [{ column: 'cost', direction: 'desc' }],
    view: { kind: 'chart', shape: 'bar', x: 'projectName', aggregate: 'sum', field: 'cost' },
  }),
  plan('When agents work, last four weeks', {
    // Two columns read the same start time: one buckets it by weekday, the other by hour.
    columns: [
      finished,
      { id: 'weekday', label: 'Weekday', type: 'datetime', bind: { turns: { field: '/startedAt' } } },
      { id: 'hour', label: 'Hour', type: 'datetime', bind: { turns: { field: '/startedAt' } } },
      column('activeMs', 'Run time', 'number', 'ms'),
    ],
    stages: [
      after('/completedAt', { address: { from: 'context', name: 'now', offset: '-P28D' } }),
      {
        op: 'summarize',
        by: [
          { column: 'weekday', bucket: 'weekday' },
          { column: 'hour', bucket: 'hour' },
        ],
        measures: [{ id: 'active', label: 'Run time', kind: 'sum', column: 'activeMs' }],
      },
    ],
    view: { kind: 'heatmap', y: 'weekday', x: 'hour', aggregate: 'sum', field: 'active' },
  }),
  plan('Spend by day by model, last 30 days', {
    columns: [finished, column('model', 'Model', 'text'), column('costUsd', 'Cost', 'number', 'USD')],
    stages: [
      last30Days,
      {
        op: 'summarize',
        by: [{ column: 'completedAt', bucket: 'day' }, { column: 'model' }],
        measures: [{ id: 'cost', label: 'Cost', kind: 'sum', column: 'costUsd' }],
      },
    ],
    view: {
      kind: 'chart',
      shape: 'bar',
      x: 'completedAt',
      series: 'model',
      stacked: true,
      aggregate: 'sum',
      field: 'cost',
    },
  }),
  plan('Time agents waited on you, last 30 days', {
    columns: [finished, column('approvalWaitMs', 'Waiting on you', 'number', 'ms')],
    stages: [last30Days],
    view: { kind: 'chart', shape: 'line', x: 'completedAt', aggregate: 'sum', field: 'approvalWaitMs' },
  }),
  plan('Failed turns this week', {
    columns: [
      column('taskTitle', 'Task', 'text'),
      column('status', 'Status', 'enum'),
      column('toolFailures', 'Failed tool calls', 'number'),
      finished,
    ],
    stages: [
      after('/completedAt', { address: { from: 'context', name: 'calendar', boundary: 'startOfWeek' } }),
      {
        op: 'filter',
        where: {
          kind: 'any',
          predicates: ['failed', 'interrupted'].map((status) => ({
            kind: 'comparison' as const,
            left: { address: { from: 'item' as const, pointer: '/status' } },
            operator: 'eq' as const,
            right: { address: { from: 'literal' as const, value: status } },
          })),
        },
      },
    ],
    sort: [{ column: 'completedAt', direction: 'desc' }],
    view: { kind: 'list' },
  }),
]

export const turnSourceDescription: DataSourceDescription = {
  revision: '1',
  ...turnShape,
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'events', retention: 'Until the owning task is deleted', complete: false },
  starterPlans: turnStarterPlans,
  consistency:
    "One row per finished turn. A turn's tokens and reported cost are what it added to its session; cost is priced at read time from your pricing preferences. Coverage is complete once every finished turn has its facts.",
  targets: [{ kind: 'agents.session' }],
}
