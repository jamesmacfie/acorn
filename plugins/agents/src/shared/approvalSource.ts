import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { after, sourceShape, starterSource } from './sourceShape'

// One record per permission, question, or other request an agent put to you, read from the session's
// requests (docs/managed-agents/turn-facts/data-sources.md).

const equals = { operators: ['eq' as const], sortable: false }

const approvalShape = sourceShape([
  {
    key: 'kind',
    type: 'string',
    label: 'Kind',
    query: equals,
    choices: {
      kind: 'static',
      values: [
        { id: 'permission', label: 'Permission' },
        { id: 'question', label: 'Question' },
        { id: 'elicitation', label: 'Elicitation' },
        { id: 'workflow_gate', label: 'Workflow gate' },
      ],
    },
  },
  {
    key: 'outcome',
    type: 'string',
    label: 'Outcome',
    display: { kind: 'status', role: 'status' },
    choices: {
      kind: 'static',
      values: [
        { id: 'allowed', label: 'Allowed', tone: 'ok' },
        { id: 'denied', label: 'Denied', tone: 'bad' },
        { id: 'answered', label: 'Answered', tone: 'ok' },
        { id: 'blocked', label: 'Blocked by a policy', tone: 'warn' },
        { id: 'cancelled', label: 'Cancelled', tone: 'muted' },
        { id: 'expired', label: 'Expired', tone: 'muted' },
        { id: 'pending', label: 'Waiting', tone: 'accent' },
        { id: 'other', label: 'Other', tone: 'muted' },
      ],
    },
  },
  {
    key: 'waitMs',
    type: 'number',
    nullable: true,
    label: 'Wait',
    description: 'From the request to its resolution or expiry. Null while it waits.',
    display: { kind: 'number', unit: 'ms' },
  },
  {
    key: 'createdAt',
    type: 'number',
    label: 'Asked',
    display: { kind: 'datetime', role: 'updated' },
    query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
  },
  { key: 'sessionId', type: 'string', label: 'Session', query: equals },
  { key: 'turnId', type: 'string', nullable: true, label: 'Turn', query: equals },
  { key: 'taskId', type: 'string', label: 'Task', query: equals },
  { key: 'taskTitle', type: 'string', nullable: true, label: 'Task title', display: { kind: 'text', role: 'title' } },
  { key: 'projectId', type: 'string', nullable: true, label: 'Project' },
  { key: 'projectName', type: 'string', nullable: true, label: 'Project name' },
  { key: 'provider', type: 'string', label: 'Provider', query: equals },
])

const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
  unit?: string,
): PanelPlan['columns'][number] => ({
  id,
  label,
  type,
  bind: { approvals: { field: `/${id}` } },
  ...(unit ? { unit } : {}),
})
const plan = (title: string, rest: Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [starterSource('approvals', 'Agent approvals')],
  ...rest,
})
const asked = column('createdAt', 'Asked', 'datetime')
const last30Days = after('/createdAt', { address: { from: 'context', name: 'now', offset: '-P30D' } })
const requests = { id: 'requests', label: 'Requests', kind: 'count' as const }

const approvalStarterPlans: PanelPlan[] = [
  plan('Approvals by kind, last 30 days', {
    columns: [asked, column('kind', 'Kind', 'text'), column('outcome', 'Outcome', 'enum')],
    stages: [last30Days, { op: 'summarize', by: [{ column: 'kind' }, { column: 'outcome' }], measures: [requests] }],
    view: {
      kind: 'chart',
      shape: 'bar',
      x: 'kind',
      series: 'outcome',
      stacked: true,
      aggregate: 'sum',
      field: 'requests',
    },
  }),
  plan('How long approvals waited, by day, last 30 days', {
    columns: [asked, column('waitMs', 'Wait', 'number', 'ms')],
    stages: [
      last30Days,
      {
        op: 'summarize',
        by: [{ column: 'createdAt', bucket: 'day' }],
        measures: [{ id: 'wait', label: 'Average wait', kind: 'average', column: 'waitMs' }],
      },
    ],
    view: { kind: 'chart', shape: 'bar', x: 'createdAt', aggregate: 'avg', field: 'wait' },
  }),
  plan('When agents ask you, last four weeks', {
    // Two columns read the same time: one buckets it by weekday, the other by hour.
    columns: [
      asked,
      { id: 'weekday', label: 'Weekday', type: 'datetime', bind: { approvals: { field: '/createdAt' } } },
      { id: 'hour', label: 'Hour', type: 'datetime', bind: { approvals: { field: '/createdAt' } } },
    ],
    stages: [
      after('/createdAt', { address: { from: 'context', name: 'now', offset: '-P28D' } }),
      {
        op: 'summarize',
        by: [
          { column: 'weekday', bucket: 'weekday' },
          { column: 'hour', bucket: 'hour' },
        ],
        measures: [requests],
      },
    ],
    view: { kind: 'heatmap', y: 'weekday', x: 'hour', aggregate: 'sum', field: 'requests' },
  }),
]

export const approvalSourceDescription: DataSourceDescription = {
  revision: '1',
  ...approvalShape,
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'events', retention: "Until the retention pass removes the session's history", complete: true },
  starterPlans: approvalStarterPlans,
  consistency:
    "One row per request, pending ones included. No request text or tool input. The outcome is read from the stored resolution: the kind of option you chose, your answers, a policy's block, a cancel, or expiry. The retention pass removes a session's requests with its history.",
  targets: [{ kind: 'agents.session' }],
}
