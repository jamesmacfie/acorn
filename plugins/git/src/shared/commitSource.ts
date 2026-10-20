import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'

// One record per commit on a local branch of each project in scope (docs/git-client/history.md).

const count = { kind: 'number' } as const
const fields: (Omit<DataSourceDescription['fields'][number], 'pointer' | 'origin'> & {
  key: string
  type: 'string' | 'number' | 'boolean'
})[] = [
  { key: 'sha', type: 'string', label: 'Commit' },
  { key: 'subject', type: 'string', label: 'Subject', display: { kind: 'text', role: 'title' } },
  { key: 'authorName', type: 'string', label: 'Author' },
  { key: 'authorEmail', type: 'string', label: 'Author email' },
  {
    key: 'authoredAt',
    type: 'number',
    label: 'Authored',
    display: { kind: 'datetime', role: 'updated' },
    query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
  },
  { key: 'projectId', type: 'string', label: 'Project' },
  { key: 'projectName', type: 'string', label: 'Project name' },
  { key: 'branch', type: 'string', label: 'Branch' },
  { key: 'filesChanged', type: 'number', label: 'Files changed', display: count },
  { key: 'linesAdded', type: 'number', label: 'Lines added', display: count },
  { key: 'linesRemoved', type: 'number', label: 'Lines removed', display: count },
  { key: 'merge', type: 'boolean', label: 'Merge commit' },
]

const source: PanelPlan['sources'][number] = {
  id: 'commits',
  label: 'Git commits',
  role: 'primary',
  reference: {
    kind: 'inline',
    bindings: {},
    content: {
      name: 'Git commits',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {},
      query: { source: { pluginId: 'git', sourceId: 'commits' }, scope: { parameters: {} }, sort: [] },
    },
  },
}
const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
  field = id,
): PanelPlan['columns'][number] => ({ id, label, type, bind: { commits: { field: `/${field}` } } })
const plan = (title: string, rest: Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [source],
  ...rest,
})
const authoredAfter = (right: DataBinding): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/authoredAt' } }, operator: 'gt', right },
})
const authored = column('authoredAt', 'Authored', 'datetime')
const project = column('projectName', 'Project', 'text')

const commitStarterPlans: PanelPlan[] = [
  plan('Commits by day by project, this month', {
    columns: [authored, project],
    stages: [
      authoredAfter({ address: { from: 'context', name: 'calendar', boundary: 'startOfMonth' } }),
      {
        op: 'summarize',
        by: [{ column: 'authoredAt', bucket: 'day' }, { column: 'projectName' }],
        measures: [{ id: 'commits', label: 'Commits', kind: 'count' }],
      },
    ],
    view: {
      kind: 'chart',
      shape: 'bar',
      x: 'authoredAt',
      series: 'projectName',
      stacked: true,
      aggregate: 'sum',
      field: 'commits',
    },
  }),
  plan('When commits land, last four weeks', {
    // Two columns read the same author time: one buckets it by weekday, the other by hour.
    columns: [
      authored,
      column('weekday', 'Weekday', 'datetime', 'authoredAt'),
      column('hour', 'Hour', 'datetime', 'authoredAt'),
    ],
    stages: [
      authoredAfter({ address: { from: 'context', name: 'now', offset: '-P28D' } }),
      {
        op: 'summarize',
        by: [
          { column: 'weekday', bucket: 'weekday' },
          { column: 'hour', bucket: 'hour' },
        ],
        measures: [{ id: 'commits', label: 'Commits', kind: 'count' }],
      },
    ],
    view: { kind: 'heatmap', y: 'weekday', x: 'hour', aggregate: 'sum', field: 'commits' },
  }),
  plan('Lines added by project, last 30 days', {
    columns: [authored, project, column('linesAdded', 'Lines added', 'number')],
    stages: [
      authoredAfter({ address: { from: 'context', name: 'now', offset: '-P30D' } }),
      {
        op: 'summarize',
        by: [{ column: 'projectName' }],
        measures: [{ id: 'added', label: 'Lines added', kind: 'sum', column: 'linesAdded' }],
      },
    ],
    sort: [{ column: 'added', direction: 'desc' }],
    view: { kind: 'chart', shape: 'bar', x: 'projectName', aggregate: 'sum', field: 'added' },
  }),
  plan('Commits this week', {
    columns: [
      column('subject', 'Subject', 'text'),
      project,
      column('branch', 'Branch', 'text'),
      column('authorName', 'Author', 'text'),
      authored,
    ],
    stages: [authoredAfter({ address: { from: 'context', name: 'calendar', boundary: 'startOfWeek' } })],
    sort: [{ column: 'authoredAt', direction: 'desc' }],
    view: { kind: 'list' },
  }),
]

export const commitSourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(fields.map(({ key, type }) => [key, { type }])),
    required: fields.map(({ key }) => key),
  },
  fields: fields.map(({ key, type: _type, ...field }) => ({
    pointer: `/${key}`,
    origin: 'declared' as const,
    ...field,
  })),
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'events', retention: 'As long as a local branch reaches the commit', complete: true },
  starterPlans: commitStarterPlans,
  consistency:
    'One row per commit reachable from a local branch, counted once per project; the branch is one that reaches it. The read never fetches. Merge commits count no files or lines. A lower bound on the author time narrows the read by commit time, so a commit dated before its author time can be missed.',
}
