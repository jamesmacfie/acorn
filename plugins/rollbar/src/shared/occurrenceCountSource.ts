import type { PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { DataSourceDescription, DataSourceRegistration } from '@acorn/protocol/dataSources.ts'

// One record per error group per UTC day, counted by Rollbar's Metrics API
// (docs/integrations/rollbar.md § Occurrence counts source).

export const occurrenceCountSource: DataSourceRegistration = {
  sourceId: 'occurrence-counts',
  name: 'Rollbar occurrence counts',
  singular: 'Daily count',
  plural: 'Daily counts',
  providerId: 'rollbar',
  identityScope: 'System item ID and UTC day, scoped to one project connection',
  handler: '/v1/p/rollbar/data/occurrence-counts',
  titlePointer: '/title',
  urlPointer: '/url',
  icon: 'brand:rollbar',
}

const equals = { operators: ['eq' as const], sortable: false }
const fields: (Omit<DataSourceDescription['fields'][number], 'pointer' | 'origin'> & {
  key: string
  type: 'string' | 'number' | ['string', 'null']
})[] = [
  { key: 'title', type: 'string', label: 'Title', display: { kind: 'text', role: 'title' } },
  { key: 'id', type: 'string', label: 'Item' },
  { key: 'counter', type: 'string', label: 'Counter', query: equals },
  { key: 'url', type: ['string', 'null'], label: 'URL', display: { kind: 'link', role: 'url' } },
  { key: 'level', type: 'string', label: 'Level', query: equals },
  { key: 'environment', type: 'string', label: 'Environment', query: equals },
  {
    key: 'day',
    type: 'number',
    label: 'Day',
    description: 'The start of the UTC day the occurrences fell in.',
    display: { kind: 'datetime', role: 'updated' },
    query: { operators: ['gt', 'gte', 'lt', 'lte'], sortable: true },
  },
  {
    key: 'occurrences',
    type: 'number',
    label: 'Occurrences',
    display: { kind: 'number' },
    query: { operators: [], sortable: true },
  },
]

const source: PanelPlan['sources'][number] = {
  id: 'counts',
  label: 'Rollbar occurrence counts',
  role: 'primary',
  reference: {
    kind: 'inline',
    bindings: {},
    content: {
      name: 'Rollbar occurrence counts',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      sourceParameters: {},
      query: { source: { pluginId: 'rollbar', sourceId: 'occurrence-counts' }, scope: { parameters: {} }, sort: [] },
    },
  },
}
const column = (
  id: string,
  label: string,
  type: PanelPlan['columns'][number]['type'],
): PanelPlan['columns'][number] => ({
  id,
  label,
  type,
  bind: { counts: { field: `/${id}` } },
})
const plan = (title: string, rest: Omit<PanelPlan, 'version' | 'title' | 'time' | 'sources'>): PanelPlan => ({
  version: 2,
  title,
  // Rollbar buckets by UTC day, so the panel does too. A viewer's zone would move a day's count onto
  // the day before or after.
  time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
  sources: [source],
  ...rest,
})
const since = (offset: string): PanelPlan['stages'][number] => ({
  op: 'filter',
  where: {
    kind: 'comparison',
    left: { address: { from: 'item', pointer: '/day' } },
    operator: 'gte',
    right: { address: { from: 'context', name: 'now', offset } },
  },
})
const day = column('day', 'Day', 'datetime')
const title = column('title', 'Title', 'text')
const occurrences = column('occurrences', 'Occurrences', 'number')
const total = { id: 'total', label: 'Occurrences', kind: 'sum' as const, column: 'occurrences' }
const perDayBy = (key: 'level' | 'environment', label: string): PanelPlan =>
  plan(`Errors per day by ${label.toLowerCase()}, last 30 days`, {
    columns: [day, occurrences, column(key, label, 'text')],
    stages: [
      since('-P30D'),
      { op: 'summarize', by: [{ column: 'day', bucket: 'day' }, { column: key }], measures: [total] },
    ],
    view: { kind: 'chart', shape: 'bar', x: 'day', series: key, stacked: true, aggregate: 'sum', field: 'total' },
  })

const occurrenceCountStarterPlans: PanelPlan[] = [
  perDayBy('level', 'Level'),
  perDayBy('environment', 'Environment'),
  plan('Error spikes, last 14 days', {
    columns: [day, occurrences, title],
    stages: [
      since('-P14D'),
      { op: 'summarize', by: [{ column: 'title' }, { column: 'day', bucket: 'day' }], measures: [total] },
    ],
    view: { kind: 'heatmap', y: 'title', x: 'day', aggregate: 'sum', field: 'total' },
  }),
  plan('Noisiest errors, last 7 days', {
    columns: [day, occurrences, title],
    stages: [since('-P7D'), { op: 'summarize', by: [{ column: 'title' }], measures: [total] }],
    sort: [{ column: 'total', direction: 'desc' }],
    limit: 20,
    view: { kind: 'chart', shape: 'bar', x: 'title', aggregate: 'sum', field: 'total' },
  }),
]

export const occurrenceCountSourceDescription: DataSourceDescription = {
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
  coverage: { kind: 'events', retention: "Rollbar's occurrence retention for the account's plan", complete: true },
  starterPlans: occurrenceCountStarterPlans,
  consistency:
    "One Rollbar project connection, read through Rollbar's Metrics API, which the account's plan must include. One row per error group per UTC day with at least one occurrence; a day with none has no row. Day bounds, level, environment, and counter narrow the Rollbar query, which counts whole UTC days. One read keeps the newest 5,000 rows and reports the rest incomplete. Continuations reuse the read for 60 seconds.",
}
