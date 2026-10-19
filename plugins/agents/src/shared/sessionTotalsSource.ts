import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { after, sourceShape, starterSource } from './sourceShape'

// One record per session with a finished turn, totalled from its turns' facts
// (docs/managed-agents/turn-facts.md).

const ms = { kind: 'number', unit: 'ms' } as const
const tokens = { kind: 'number', unit: 'tokens' } as const
const count = { kind: 'number' } as const
const equals = { operators: ['eq' as const], sortable: false }

const sessionTotalsShape = sourceShape([
  { key: 'sessionId', type: 'string', label: 'Session', query: equals },
  { key: 'title', type: 'string', label: 'Title', display: { kind: 'text', role: 'title' } },
  { key: 'provider', type: 'string', label: 'Provider', query: equals },
  {
    key: 'kind',
    type: 'string',
    label: 'Kind',
    choices: {
      kind: 'static',
      values: [
        { id: 'interactive', label: 'Interactive' },
        { id: 'workflow', label: 'Workflow' },
        { id: 'delegated', label: 'Delegated' },
        { id: 'imported', label: 'Imported' },
      ],
    },
  },
  { key: 'archived', type: 'boolean', label: 'Archived' },
  { key: 'taskId', type: 'string', label: 'Task', query: equals },
  { key: 'taskTitle', type: 'string', nullable: true, label: 'Task title' },
  {
    key: 'taskStatus',
    type: 'string',
    nullable: true,
    label: 'Task status',
    choices: {
      kind: 'static',
      values: [
        { id: 'active', label: 'Active', tone: 'accent' },
        { id: 'archived', label: 'Archived', tone: 'ok' },
        { id: 'cancelled', label: 'Cancelled', tone: 'muted' },
      ],
    },
  },
  { key: 'projectId', type: 'string', nullable: true, label: 'Project', query: equals },
  { key: 'projectName', type: 'string', nullable: true, label: 'Project name' },
  {
    key: 'changeRequests',
    type: 'number',
    label: 'Change requests',
    description: 'Change requests this session attached to its task.',
    display: count,
  },
  { key: 'turns', type: 'number', label: 'Turns', display: count },
  {
    key: 'failedTurns',
    type: 'number',
    label: 'Failed turns',
    description: 'Turns that failed or were interrupted.',
    display: count,
  },
  { key: 'firstStartedAt', type: 'number', label: 'First turn started', display: { kind: 'datetime' } },
  {
    key: 'lastCompletedAt',
    type: 'number',
    label: 'Last turn finished',
    display: { kind: 'datetime', role: 'updated' },
    query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
  },
  { key: 'activeMs', type: 'number', label: 'Run time', display: ms },
  { key: 'approvalWaitMs', type: 'number', label: 'Waiting on you', display: ms },
  { key: 'toolCalls', type: 'number', label: 'Tool calls', display: count },
  { key: 'toolFailures', type: 'number', label: 'Failed tool calls', display: count },
  { key: 'filesChanged', type: 'number', label: 'Files changed', display: count },
  { key: 'filesRewritten', type: 'number', label: 'Files rewritten', display: count },
  { key: 'subagents', type: 'number', label: 'Subagents', display: count },
  { key: 'inputTokens', type: 'number', label: 'Input tokens', display: tokens },
  { key: 'outputTokens', type: 'number', label: 'Output tokens', display: tokens },
  { key: 'cacheReadTokens', type: 'number', label: 'Cache read tokens', display: tokens },
  { key: 'cacheWriteTokens', type: 'number', label: 'Cache write tokens', display: tokens },
  {
    key: 'costUsd',
    type: 'number',
    nullable: true,
    label: 'Cost',
    description: 'The sum of the turns with a known cost. Null when no turn has one.',
    display: { kind: 'number', unit: 'USD' },
  },
  { key: 'longestFailureRun', type: 'number', label: 'Most failures in a row', display: count },
  { key: 'longestFailureRunTurn', type: 'number', nullable: true, label: 'Failure run turn' },
  { key: 'longestFailureRunSeq', type: 'number', nullable: true, label: 'Failure run start' },
  {
    key: 'repeatedCalls',
    type: 'number',
    label: 'Most repeated calls in a turn',
    display: count,
  },
  { key: 'repeatedCallsTurn', type: 'number', nullable: true, label: 'Repeat run turn' },
  { key: 'repeatedCallsSeq', type: 'number', nullable: true, label: 'Repeat run start' },
  { key: 'maxFilesRewritten', type: 'number', label: 'Most files rewritten in a turn', display: count },
  {
    key: 'contextPeak',
    type: 'number',
    nullable: true,
    label: 'Peak context use',
    display: { kind: 'number', unit: 'percent' },
  },
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
  bind: { 'session-totals': { field: `/${id}` } },
  ...(unit ? { unit } : {}),
})

const sessionTotalsStarterPlans: PanelPlan[] = [
  {
    version: 2,
    title: 'Most expensive sessions this month',
    time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
    sources: [starterSource('session-totals', 'Agent session totals')],
    columns: [
      column('title', 'Session', 'text'),
      column('taskTitle', 'Task', 'text'),
      column('turns', 'Turns', 'number'),
      column('costUsd', 'Cost', 'number', 'USD'),
      column('lastCompletedAt', 'Last turn finished', 'datetime'),
    ],
    stages: [after('/lastCompletedAt', { address: { from: 'context', name: 'calendar', boundary: 'startOfMonth' } })],
    sort: [{ column: 'costUsd', direction: 'desc' }],
    limit: 20,
    view: { kind: 'table' },
  },
]

export const sessionTotalsSourceDescription: DataSourceDescription = {
  revision: '1',
  ...sessionTotalsShape,
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'events', retention: 'Until the owning task is deleted', complete: false },
  starterPlans: sessionTotalsStarterPlans,
  consistency:
    "One row per session with a finished turn, archived sessions and ones whose history was removed included. Totals cover all of the session's finished turns; cost is priced at read time from your pricing preferences.",
  targets: [{ kind: 'agents.session' }],
}
