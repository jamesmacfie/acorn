import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataBinding } from '@acorn/protocol/dataBindings.ts'
import type { DataSourceDescription } from '@acorn/protocol/dataSources.ts'
import { memorySource } from './memorySourceRegistration'

// One record per memory in the library: its frontmatter, never its body (docs/notes-and-memory.md § Memory).

const equals = { operators: ['eq' as const], sortable: false }
const time = { operators: ['gt' as const, 'gte' as const, 'lt' as const, 'lte' as const], sortable: true }

const source: PanelPlan['sources'][number] = {
  id: 'memories',
  label: memorySource.name,
  role: 'primary',
  reference: {
    kind: 'inline',
    bindings: {},
    content: {
      name: memorySource.name,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {},
      query: {
        source: { pluginId: 'memory', sourceId: memorySource.sourceId },
        scope: { parameters: {} },
        sort: [],
      },
    },
  },
}
const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
): PanelPlan['columns'][number] => ({ id, label, type, bind: { memories: { field: `/${id}` } } })
const plan = (title: string, rest: Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>): PanelPlan => ({
  version: 2,
  title,
  time: { zone: 'UTC', mode: 'viewer', weekStart: 'monday' },
  sources: [source],
  ...rest,
})
const compare = (pointer: string, operator: 'gt' | 'lt', right: DataBinding): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: { kind: 'comparison', left: { address: { from: 'item', pointer } }, operator, right },
})
const count = { id: 'memories', label: 'Memories', kind: 'count' as const }
const name = column('name', 'Memory', 'text')
const description = column('description', 'Description', 'text')
const type = column('type', 'Type', 'enum')
// A record names no action, so a press must ask for the record's target: a project memory's route.
const opensMemory: PanelPlan['actions'] = { press: { kind: 'record', prefer: 'route' }, buttons: [] }

const memoryStarterPlans: PanelPlan[] = [
  plan('Memories added this month', {
    columns: [
      name,
      description,
      type,
      column('writtenBy', 'Written by', 'enum'),
      column('createdAt', 'Created', 'datetime'),
    ],
    stages: [compare('/createdAt', 'gt', { address: { from: 'context', name: 'calendar', boundary: 'startOfMonth' } })],
    sort: [{ column: 'createdAt', direction: 'desc' }],
    view: { kind: 'list' },
    actions: opensMemory,
  }),
  plan('Memories by type', {
    columns: [type],
    stages: [{ op: 'summarize', by: [{ column: 'type' }], measures: [count] }],
    sort: [{ column: 'memories', direction: 'desc' }],
    view: { kind: 'chart', shape: 'bar', x: 'type', aggregate: 'sum', field: 'memories' },
  }),
  plan('Memories added each week by type', {
    columns: [type, column('createdAt', 'Created', 'datetime')],
    stages: [
      compare('/createdAt', 'gt', { address: { from: 'context', name: 'now', offset: '-P12W' } }),
      {
        op: 'summarize',
        by: [{ column: 'createdAt', bucket: 'week' }, { column: 'type' }],
        measures: [count],
      },
    ],
    view: {
      kind: 'chart',
      shape: 'bar',
      x: 'createdAt',
      series: 'type',
      stacked: true,
      aggregate: 'sum',
      field: 'memories',
    },
  }),
  plan('Memories untouched for 90 days', {
    columns: [name, description, type, column('updatedAt', 'Updated', 'datetime')],
    stages: [compare('/updatedAt', 'lt', { address: { from: 'context', name: 'now', offset: '-P90D' } })],
    sort: [{ column: 'updatedAt', direction: 'asc' }],
    view: { kind: 'list' },
    actions: opensMemory,
  }),
]

const choices = (values: [id: string, label: string][]) => ({
  kind: 'static' as const,
  values: values.map(([id, label]) => ({ id, label })),
})

export const memorySourceDescription: DataSourceDescription = {
  revision: '1',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      type: { type: 'string' },
      scope: { type: 'string' },
      projectId: { type: ['string', 'null'] },
      projectName: { type: ['string', 'null'] },
      writtenBy: { type: ['string', 'null'] },
      sessionId: { type: ['string', 'null'] },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
      superseded: { type: 'boolean' },
    },
    required: [
      'name',
      'description',
      'type',
      'scope',
      'projectId',
      'projectName',
      'writtenBy',
      'sessionId',
      'createdAt',
      'updatedAt',
      'superseded',
    ],
  },
  fields: [
    { pointer: '/name', label: 'Name', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/description', label: 'Description', origin: 'declared' },
    {
      pointer: '/type',
      display: { kind: 'enum' },
      label: 'Type',
      origin: 'declared',
      query: equals,
      choices: choices([
        ['user', 'User'],
        ['feedback', 'Feedback'],
        ['project', 'Project'],
        ['reference', 'Reference'],
      ]),
    },
    {
      pointer: '/scope',
      display: { kind: 'enum' },
      label: 'Scope',
      origin: 'declared',
      description: 'A project memory applies to its project. A private one applies to you in every project.',
      query: equals,
      choices: choices([
        ['project', 'Project'],
        ['private', 'Private'],
      ]),
    },
    { pointer: '/projectId', label: 'Project', origin: 'declared', query: equals },
    { pointer: '/projectName', label: 'Project name', origin: 'declared' },
    {
      pointer: '/writtenBy',
      display: { kind: 'enum' },
      label: 'Written by',
      origin: 'declared',
      description: 'Who wrote the current version, as the memory file records it. Empty for a file edited by hand.',
      query: equals,
      choices: choices([
        ['owner', 'You'],
        ['agent', 'An agent'],
        ['import', 'Import'],
      ]),
    },
    { pointer: '/sessionId', label: 'Agent session', origin: 'declared', query: equals },
    { pointer: '/createdAt', label: 'Created', origin: 'declared', display: { kind: 'datetime' }, query: time },
    {
      pointer: '/updatedAt',
      label: 'Updated',
      origin: 'declared',
      display: { kind: 'datetime', role: 'updated' },
      query: time,
    },
    {
      pointer: '/superseded',
      label: 'Superseded',
      origin: 'declared',
      description: 'Another memory replaces this one.',
      query: equals,
    },
  ],
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
  coverage: { kind: 'snapshot' },
  starterPlans: memoryStarterPlans,
  consistency:
    "One row per memory file in the library, read when the query runs. A project scope reads that project's memories and your private ones, because private memories apply in every project. A workspace scope reads each of its projects' memories and your private ones once.",
  targets: [{ kind: 'memory.entry' }],
}
