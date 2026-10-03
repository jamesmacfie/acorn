import { describe, expect, it } from 'vitest'
import { dataSourceDescriptionSchema, type DataSourceResult } from '@acorn/protocol/dataSources.ts'
import { dashboardPanelContentSchema, panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { bindPanelRows, groupPlanRows, matchesPlanFilter, resolvePlanColumns, runPlanStages, sortPlanRows, upgradePanelContent, validatePanelPlan, type PlanRow, type PlanSource } from './plan'
import { PANEL_CAPABILITIES } from './capabilities'

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
    expect(matchesPlanFilter(missing, plan.stages[0]!.where)).toBe(false)
  })

  it('keeps calendar days in their named zone and refuses mixed-currency ordering', () => {
    const plan = base()
    plan.group = [{ column: 'due', bucket: 'day', order: 'label' }]
    const rows = bindPanelRows(plan, [source('a', [{ recordId: '1', data: { title: 'One', amount: 1, currency: 'NZD', due: '2026-10-03' } }])])
    expect(groupPlanRows(plan, rows, Date.UTC(2026, 9, 2))[0]).toMatchObject({ key: '2026-10-03', count: 1 })
    plan.sort = [{ column: 'amount', direction: 'desc' }]
    expect(validatePanelPlan(plan, [source('a', [])])).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/sort/0/column' })]))
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
