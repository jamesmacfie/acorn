import { describe, expect, it } from 'vitest'
import { dataSourceDescriptionSchema, type DataSourceResult } from '@acorn/protocol/dataSources.ts'
import { dashboardPanelContentSchema, panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { bindPanelRows, deriveDrilldownPlan, describePanelPlan, displayPlanRun, groupPlanRows, matchesPlanFilter, relatePanelRows, resolvePlanColumns, runPlanStages, sortPlanRows, upgradePanelContent, validatePanelPlan, type PlanRow, type PlanSource } from './plan'
import { PANEL_CAPABILITIES } from './capabilities'
import { aggregateRows } from './shaping'
import { buildChart } from './chart'

const description = dataSourceDescriptionSchema.parse({
  schema: { type: 'object', properties: { title: { type: 'string' }, amount: { type: 'number' }, currency: { type: 'string' }, due: { type: 'string' } }, additionalProperties: false },
  fields: [
    { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
    { pointer: '/amount', label: 'Amount', origin: 'declared', display: { kind: 'number' } },
    { pointer: '/currency', label: 'Currency', origin: 'declared', display: { kind: 'text' } },
    { pointer: '/due', label: 'Due', origin: 'declared', display: { kind: 'datetime' } },
  ],
  parameters: { type: 'object', additionalProperties: false }, parameterFields: [],
  operations: { query: true, options: false, details: false, incremental: false, groups: ['all', 'any'] },
  revision: 'one', consistency: 'fixture',
})
const source = (id: string, records: { recordId: string; data: Record<string, string | number> }[]): PlanSource => ({
  instanceId: id, label: id, description,
  query: { source: { pluginId: 'fixture', sourceId: id }, scope: { workspaceId: 'w', parameters: {} }, sort: [] },
  result: { records: records.map(record => ({ data: record.data, ref: { pluginId: 'fixture', sourceId: id, recordId: record.recordId } })),
    revision: 'one', readTime: 0, completeness: { kind: 'complete' }, mode: 'execution', evaluationTime: 0 } satisfies DataSourceResult,
})
const base = () => panelPlanSchema.parse({
  version: 2, title: 'Invoices', time: { zone: 'Pacific/Auckland', mode: 'fixed', weekStart: 'monday' },
  sources: ['a', 'b'].map(id => ({ id, label: id, role: 'primary', reference: { kind: 'inline', content: {
    name: id, parameters: { type: 'object', additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'fixture', sourceId: id }, scope: { workspaceId: 'w', parameters: {} }, sort: [] },
  }, bindings: {} } })),
  columns: [
    { id: 'title', label: 'Title', type: 'text', bind: { a: { field: '/title' }, b: { field: '/title' } } },
    { id: 'amount', label: 'Amount', type: 'number', unit: { column: 'currency' }, bind: { a: { field: '/amount' }, b: { field: '/amount' } } },
    { id: 'currency', label: 'Currency', type: 'text', bind: { a: { field: '/currency' }, b: { field: '/currency' } } },
    { id: 'due', label: 'Due', type: 'datetime', precision: 'day', bind: { a: { field: '/due' }, b: { field: '/due' } } },
  ], stages: [], view: { kind: 'table' },
})

describe('panel plan', () => {
  it('example 5: counts filtered pull request measures independently and retains exact rows for each cell', () => {
    const plan = base()
    const where = (currency: string) => ({ kind: 'comparison' as const, left: { address: { from: 'item' as const, pointer: '/currency' } }, operator: 'eq' as const, right: { address: { from: 'literal' as const, value: currency } } })
    plan.stages = [{ op: 'summarize', by: [{ column: 'title' }], measures: [
      { id: 'all', label: 'All', kind: 'count' }, { id: 'usd', label: 'USD', kind: 'count-where', where: where('USD') },
      { id: 'eur', label: 'EUR', kind: 'count-where', where: where('EUR') },
    ] }]
    const inputs = [source('a', [{ recordId: '1', data: { title: 'Acme', amount: 4, currency: 'USD' } }, { recordId: '2', data: { title: 'Acme', amount: 6, currency: 'EUR' } }])]
    const result = runPlanStages(plan, bindPanelRows(plan, inputs), 0)
    expect(result.rows[0]?.values).toMatchObject({ title: 'Acme', all: 2, usd: 1, eur: 1 })
    expect(result.rows[0]?.measureRows?.usd.map(row => row.records[0]?.recordId)).toEqual(['1'])
    expect(result.rows[0]?.measureRows?.eur.map(row => row.records[0]?.recordId)).toEqual(['2'])
  })

  it('runs repeated summaries and a calculation over their measures', () => {
    const plan = base()
    plan.stages = [
      { op: 'summarize', by: [{ column: 'title' }], measures: [{ id: 'runs', label: 'Runs', kind: 'count' }, { id: 'failures', label: 'Failures', kind: 'count-where', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/currency' } }, operator: 'eq', right: { address: { from: 'literal', value: 'FAIL' } } } }] },
      { op: 'compute', columns: [{ id: 'rate', label: 'Rate', expression: { kind: 'arithmetic', operator: 'divide', left: { kind: 'column', column: 'failures' }, right: { kind: 'column', column: 'runs' } } }] },
      { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/rate' } }, operator: 'gt', right: { address: { from: 'literal', value: 0 } } } },
    ]
    const rows: PlanRow[] = [
      { id: '1', values: { title: 'A', currency: 'FAIL' }, records: [] },
      { id: '2', values: { title: 'A', currency: 'PASS' }, records: [] },
      { id: '3', values: { title: 'B', currency: 'PASS' }, records: [] },
    ]
    expect(runPlanStages(plan, rows, 0).rows.map(row => row.values.rate)).toEqual([0.5])
  })

  it('flaky-test fixture: two summaries preserve a test with both outcomes on one commit', () => {
    const plan = base()
    plan.columns.push({ id: 'commit', label: 'Commit', type: 'text', bind: {} })
    plan.stages = [
      { op: 'summarize', by: [{ column: 'title' }, { column: 'commit' }], measures: [
        { id: 'runs', label: 'Runs', kind: 'count' },
        { id: 'passes', label: 'Passes', kind: 'count-where', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/currency' } }, operator: 'eq', right: { address: { from: 'literal', value: 'pass' } } } },
        { id: 'failures', label: 'Failures', kind: 'count-where', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/currency' } }, operator: 'eq', right: { address: { from: 'literal', value: 'fail' } } } },
      ] },
      { op: 'compute', columns: [{ id: 'flaky', label: 'Both outcomes', expression: { kind: 'min', values: [{ kind: 'column', column: 'passes' }, { kind: 'column', column: 'failures' }] } }] },
      { op: 'summarize', by: [{ column: 'title' }], measures: [{ id: 'runsTotal', label: 'Runs', kind: 'sum', column: 'runs' }, { id: 'failuresTotal', label: 'Failures', kind: 'sum', column: 'failures' },
        { id: 'flakyCommits', label: 'Flaky commits', kind: 'count-where', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/flaky' } }, operator: 'gt', right: { address: { from: 'literal', value: 0 } } } }] },
      { op: 'compute', columns: [{ id: 'failureRate', label: 'Failure rate', expression: { kind: 'arithmetic', operator: 'divide', left: { kind: 'column', column: 'failuresTotal' }, right: { kind: 'column', column: 'runsTotal' } } }] },
      { op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/flakyCommits' } }, operator: 'gt', right: { address: { from: 'literal', value: 0 } } } },
    ]
    const rows: PlanRow[] = [
      { id: '1', values: { title: 'test-a', commit: 'c1', currency: 'pass' }, records: [] },
      { id: '2', values: { title: 'test-a', commit: 'c1', currency: 'fail' }, records: [] },
      { id: '3', values: { title: 'test-a', commit: 'c2', currency: 'pass' }, records: [] },
      { id: '4', values: { title: 'test-b', commit: 'c1', currency: 'fail' }, records: [] },
    ]
    expect(validatePanelPlan(plan, [source('a', []), source('b', [])]).filter(problem => problem.severity === 'error')).toEqual([])
    expect(runPlanStages(plan, rows, 0).rows.map(row => row.values)).toMatchObject([{ title: 'test-a', runsTotal: 3, failuresTotal: 1, flakyCommits: 1, failureRate: 1 / 3 }])
  })

  it('example 9: keeps unmatched lookups and warns on a many-to-one cardinality violation', () => {
    const plan = base()
    plan.sources[1]!.role = 'lookup'
    plan.relations = [{ id: 'mirror', from: 'a', to: 'b', kind: 'references', cardinality: 'many-to-one', unmatched: 'keep', maxMatches: 10,
      keys: [{ from: '/currency', to: '/currency', scope: 'provider' }, { from: '/title', to: '/title', scope: 'account' }, { from: '/amount', to: '/amount', scope: 'identity' }] }]
    const sources = [source('a', [{ recordId: '1', data: { title: 'A', amount: 1, currency: 'USD' } }, { recordId: '2', data: { title: 'B', amount: 2, currency: 'USD' } }]),
      source('b', [{ recordId: '3', data: { title: 'A', amount: 1, currency: 'USD' } }, { recordId: '4', data: { title: 'A', amount: 1, currency: 'USD' } }])]
    const result = relatePanelRows(plan, sources, bindPanelRows(plan, sources))
    expect(result.rows).toHaveLength(2)
    expect(result.problems[0]?.message).toContain('violates many-to-one')
    expect(result.rows[1]?.records).toHaveLength(1)
  })

  it('examples 18 and 30: marks unknown and incomplete measures partial and refuses mixed currencies', () => {
    const plan = base()
    plan.stages = [{ op: 'summarize', by: [], measures: [{ id: 'total', label: 'Total', kind: 'sum', column: 'amount' }] }]
    const rows: PlanRow[] = [{ id: '1', values: { amount: 5, currency: 'USD' }, records: [] }, { id: '2', values: { amount: null, currency: 'EUR' }, records: [] }]
    const result = runPlanStages(plan, rows, 0, true)
    expect(result.rows[0]?.partial?.total).toContain('incomplete')
    expect(result.problems[0]?.message).toContain('mixes units')
  })

  it('examples 10 and 30: merges only declared equivalence and retains both record references', () => {
    const plan = base()
    plan.columns[0]!.precedence = ['b', 'a']
    plan.relations = [{ id: 'same', from: 'a', to: 'b', kind: 'equivalence', cardinality: 'one-to-one', unmatched: 'keep', maxMatches: 10,
      keys: [{ from: '/currency', to: '/currency', scope: 'provider' }, { from: '/amount', to: '/amount', scope: 'account' }, { from: '/title', to: '/title', scope: 'identity' }] }]
    const sources = [source('a', [{ recordId: '1', data: { title: 'Mirror', amount: 1, currency: 'USD' } }]),
      source('b', [{ recordId: '2', data: { title: 'Mirror', amount: 1, currency: 'USD' } }])]
    const result = relatePanelRows(plan, sources, bindPanelRows(plan, sources))
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.records.map(ref => ref.recordId)).toEqual(['1', '2'])
  })

  it('example 15: fills missing daily buckets, pivots a declared choice, and keeps count gaps at zero', () => {
    const plan = base()
    plan.columns.push({ id: 'kind', label: 'Kind', type: 'enum', choices: [{ id: 'pass', label: 'Passed' }, { id: 'fail', label: 'Failed' }], bind: {} })
    plan.stages = [{ op: 'summarize', by: [{ column: 'due', bucket: 'day' }, { column: 'kind' }],
      measures: [{ id: 'runs', label: 'Runs', kind: 'count' }], pivot: { column: 'kind', measure: 'runs' } }]
    const rows: PlanRow[] = [{ id: '1', values: { due: '2026-10-01', kind: 'pass' }, records: [] },
      { id: '2', values: { due: '2026-10-01', kind: 'fail' }, records: [] }]
    const result = runPlanStages(plan, rows, 0)
    expect(result.rows[0]?.values).toMatchObject({ runs_pass: 1, runs_fail: 1 })
    plan.stages = [{ op: 'summarize', by: [{ column: 'due', bucket: 'day' }], measures: [{ id: 'runs', label: 'Runs', kind: 'count' }], fill: true }]
    const filled = runPlanStages(plan, [...rows, { id: '3', values: { due: '2026-10-03' }, records: [] }], 0)
    expect(filled.rows.map(row => row.values.runs)).toEqual([2, 0, 1])
  })

  it('example 28: finds only intersecting intervals and caps an overlap without losing pair provenance', () => {
    const plan = base()
    plan.stages = [{ op: 'overlap', start: 'due', end: 'title', maxPairs: 1 }]
    const rows: PlanRow[] = [
      { id: 'google', values: { due: 0, title: 10, currency: 'a' }, records: [{ pluginId: 'google', sourceId: 'events', recordId: '1' }] },
      { id: 'outlook', values: { due: 5, title: 15, currency: 'a' }, records: [{ pluginId: 'outlook', sourceId: 'events', recordId: '2' }] },
      { id: 'later', values: { due: 20, title: 30, currency: 'a' }, records: [] },
    ]
    const result = runPlanStages(plan, rows, 0)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.values.overlapDuration).toBe(5)
    expect(result.rows[0]?.records.map(ref => ref.pluginId)).toEqual(['google', 'outlook'])
  })

  it('example 28 calendar fixture: merges duplicate invitations before finding cross-provider conflicts', () => {
    const plan = base()
    plan.columns.push({ id: 'end', label: 'End', type: 'datetime', bind: { a: { field: '/end' }, b: { field: '/end' } } },
      { id: 'attendee', label: 'Attendee', type: 'text', bind: { a: { field: '/attendee' }, b: { field: '/attendee' } } })
    plan.relations = [{ id: 'sameOccurrence', from: 'a', to: 'b', kind: 'equivalence', cardinality: 'one-to-one', unmatched: 'keep', maxMatches: 10,
      keys: [{ from: '/currency', to: '/currency', scope: 'provider' }, { from: '/amount', to: '/amount', scope: 'account' },
        { from: '/title', to: '/title', scope: 'identity' }, { from: '/due', to: '/due', scope: 'container' }] }]
    plan.stages = [{ op: 'overlap', start: 'due', end: 'end', partition: 'attendee', maxPairs: 10 }]
    const google = source('a', [{ recordId: 'g1', data: { title: 'event-1', amount: 1, currency: 'calendar', due: 0, end: 10, attendee: 'x' } }])
    const outlook = source('b', [{ recordId: 'o1', data: { title: 'event-1', amount: 1, currency: 'calendar', due: 0, end: 10, attendee: 'x' } },
      { recordId: 'o2', data: { title: 'event-2', amount: 1, currency: 'calendar', due: 5, end: 15, attendee: 'x' } }])
    google.query.source.pluginId = 'google'
    outlook.query.source.pluginId = 'outlook'
    for (const record of google.result!.records) record.ref.pluginId = 'google'
    for (const record of outlook.result!.records) record.ref.pluginId = 'outlook'
    const related = relatePanelRows(plan, [google, outlook], bindPanelRows(plan, [google, outlook]))
    const result = runPlanStages(plan, related.rows, 0)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.records.map(ref => ref.recordId)).toEqual(['g1', 'o1', 'o2'])
  })

  it('example 7: computes weekly median, 95th percentile, and previous change', () => {
    const plan = base()
    plan.stages = [{ op: 'summarize', by: [{ column: 'due', bucket: 'week' }], measures: [
      { id: 'median', label: 'Median', kind: 'median', column: 'amount', previous: 'amount' },
      { id: 'p95', label: '95th', kind: 'percentile', column: 'amount', percentile: 95 },
    ] }]
    const rows: PlanRow[] = [
      { id: '1', values: { due: '2026-09-28', amount: 2 }, records: [] },
      { id: '2', values: { due: '2026-09-29', amount: 4 }, records: [] },
      { id: '3', values: { due: '2026-10-05', amount: 9 }, records: [] },
    ]
    const result = runPlanStages(plan, rows, 0)
    expect(result.rows.map(row => [row.values.median, row.values.p95, row.values.medianPrevious])).toEqual([[3, 3.9, null], [9, 9, 6]])
  })

  it('represents a share and previous ratio in percentage points', () => {
    const plan = base()
    plan.stages = [{ op: 'summarize', by: [{ column: 'due', bucket: 'day' }], measures: [
      { id: 'runs', label: 'Runs', kind: 'count', share: true, previous: 'ratio' },
    ] }]
    const rows: PlanRow[] = [
      { id: '1', values: { due: '2026-10-01' }, records: [] },
      { id: '2', values: { due: '2026-10-02' }, records: [] },
    ]
    const result = runPlanStages(plan, rows, 0)
    expect(result.rows.map(row => [row.values.runs, row.values.runsPrevious])).toEqual([[50, null], [50, 0]])
  })

  it('draws a stat and chart from the same summary measures', () => {
    const plan = base()
    plan.columns.push({ id: 'kind', label: 'Kind', type: 'enum', choices: [{ id: 'pass', label: 'Passed' }, { id: 'fail', label: 'Failed' }], bind: {} })
    plan.stages = [{ op: 'summarize', by: [{ column: 'kind' }], measures: [{ id: 'runs', label: 'Runs', kind: 'count' }] }]
    const rows: PlanRow[] = [
      { id: '1', values: { kind: 'pass' }, records: [] }, { id: '2', values: { kind: 'pass' }, records: [] },
      { id: '3', values: { kind: 'fail' }, records: [] },
    ]
    const display = displayPlanRun(plan, runPlanStages(plan, rows, 0).rows)
    const stat = aggregateRows(display.rows, display.schema, { kind: 'stat', aggregate: 'sum', field: 'runs' })
    const chart = buildChart(display.rows, display.schema, { kind: 'chart', shape: 'bar', aggregate: 'sum', field: 'runs', x: 'kind' }, {})
    expect(stat).toBe(3)
    expect(chart?.shape === 'bar' ? chart.bars.map(bar => bar.value).toSorted() : []).toEqual([1, 2])
  })

  it('example 14: expands children into rows with parent provenance', () => {
    const plan = base()
    plan.columns.push({ id: 'children', label: 'Dependencies', type: 'text', list: true, bind: {} })
    plan.stages = [{ op: 'expand', column: 'children', output: 'child', perRow: 2 }]
    const rows: PlanRow[] = [{ id: 'issue', values: { children: ['a', 'b'] }, records: [{ pluginId: 'linear', sourceId: 'issues', recordId: 'issue' }] }]
    const result = runPlanStages(plan, rows, 0)
    expect(result.rows.map(row => [row.values.child, row.records[0]?.recordId])).toEqual([['a', 'issue'], ['b', 'issue']])
  })

  it('example 25: a missing related schedule leaves the document visible', () => {
    const plan = base()
    plan.sources[1]!.role = 'lookup'
    plan.relations = [{ id: 'review', from: 'a', to: 'b', kind: 'references', cardinality: 'many-to-one', unmatched: 'keep', maxMatches: 10,
      keys: [{ from: '/currency', to: '/currency', scope: 'provider' }, { from: '/amount', to: '/amount', scope: 'account' }, { from: '/title', to: '/title', scope: 'identity' }] }]
    const sources = [source('a', [{ recordId: 'doc', data: { title: 'Plan', amount: 1, currency: 'USD' } }]), source('b', [])]
    expect(relatePanelRows(plan, sources, bindPanelRows(plan, sources)).rows[0]?.values.title).toBe('Plan')
  })
  it('keeps each advertised operation example inside the version 2 schema', () => {
    for (const operation of PANEL_CAPABILITIES.operations) {
      const candidate = { ...base(), stages: [operation.example] }
      expect(panelPlanSchema.safeParse(candidate).success).toBe(true)
    }
  })

  it('binds one row per primary record, filters missing values safely, and sorts across sources', () => {
    const plan = base()
    plan.stages = [{ op: 'filter', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/amount' } }, operator: 'gt', right: { address: { from: 'literal', value: 4 } } } }]
    plan.sort = [{ column: 'title', direction: 'asc' }]
    const sources = [source('a', [{ recordId: '1', data: { title: 'Zulu', amount: 5, currency: 'USD', due: '2026-10-03' } }]),
      source('b', [{ recordId: '2', data: { title: 'Alpha', amount: 6, currency: 'USD', due: '2026-10-04' } }])]
    const rows = sortPlanRows(plan, runPlanStages(plan, bindPanelRows(plan, sources)).rows)
    expect(rows.map(row => row.values.title)).toEqual(['Alpha', 'Zulu'])
    expect(rows.map(row => row.records[0]?.sourceId)).toEqual(['b', 'a'])
    const missing: PlanRow = { id: 'missing', records: [], values: {} }
    const filter = plan.stages[0]!
    expect(filter.op === 'filter' && matchesPlanFilter(missing, filter.where)).toBe(false)
  })

  it('keeps calendar days in their named zone and refuses mixed-currency ordering', () => {
    const plan = base()
    plan.group = [{ column: 'due', bucket: 'day', order: 'label' }]
    const rows = bindPanelRows(plan, [source('a', [{ recordId: '1', data: { title: 'One', amount: 1, currency: 'NZD', due: '2026-10-03' } }])])
    expect(groupPlanRows(plan, rows, Date.UTC(2026, 9, 2))[0]).toMatchObject({ key: '2026-10-03', count: 1 })
    plan.sort = [{ column: 'amount', direction: 'desc' }]
    expect(validatePanelPlan(plan, [source('a', [])])).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/sort/0/column' })]))
  })

  it('derives the rows behind a group without carrying its grouping into the detail view', () => {
    const plan = base()
    plan.group = [{ column: 'currency', bucket: 'value' }]
    const records = Array.from({ length: 9 }, (_, index) => ({ recordId: String(index), data: { title: `PR ${index}`, amount: index, currency: index < 7 ? 'NZD' : 'USD', due: '2026-10-03' } }))
    const rows = bindPanelRows(plan, [source('a', records)])
    const group = groupPlanRows(plan, rows, Date.UTC(2026, 9, 4)).find(item => item.key === 'NZD')!
    const derived = panelPlanSchema.parse(deriveDrilldownPlan(plan, group.rows))
    expect(derived.group).toEqual([])
    expect(derived.view.kind).toBe('table')
    expect(runPlanStages(derived, rows).rows).toHaveLength(7)
    expect(group.rows[0]?.recordItems?.[0]?.ref.recordId).toBe('0')
  })

  it('describes the source target of a configured press and rejects a missing link destination', () => {
    const plan = base()
    plan.actions = { press: { kind: 'record', source: 'a', prefer: 'refPanel' }, buttons: [] }
    const named = source('a', [])
    named.description = { ...named.description, targets: [{ kind: 'github.pull-request' }] }
    expect(describePanelPlan(plan, [named])).toContain('Pressing a row opens the pull request in a side panel.')
    plan.actions.press = { kind: 'link', column: 'missing', prefer: 'refPanel' }
    expect(validatePanelPlan(plan, [named])).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/actions/press' })]))
  })

  it('upgrades a published version 1 definition without changing its original content', () => {
    const legacy = dashboardPanelContentSchema.parse({
      title: 'Work', queries: [{ id: 'one', label: 'Items', reference: base().sources[0]!.reference }],
      mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all' },
      display: { view: { kind: 'list' }, fields: ['/title'] },
    })
    const old = JSON.stringify(legacy)
    const plan = upgradePanelContent(legacy)
    expect(plan).toMatchObject({ version: 2, time: { zone: 'UTC', mode: 'fixed' }, columns: [{ id: 'title', bind: { one: { field: '/title' } } }] })
    expect(JSON.stringify(legacy)).toBe(old)
  })

  it('resolves the legacy all-fields display from the source description', () => {
    const legacy = dashboardPanelContentSchema.parse({
      title: 'Work', queries: [{ id: 'a', label: 'Items', reference: base().sources[0]!.reference }],
      display: { view: { kind: 'table' }, fields: [] },
    })
    const resolved = resolvePlanColumns(upgradePanelContent(legacy), [source('a', [])])
    expect(resolved.columns.map(column => column.id)).toContain('title')
  })
})
