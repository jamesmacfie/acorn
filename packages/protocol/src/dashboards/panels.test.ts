import { describe, expect, it } from 'vitest'
import { dashboardPanelContentSchema, panelPlanSchema, storedDashboardPanelContentSchema } from './panels'

const content = (mapped: boolean, display: { fields?: string[]; groupBy?: string }) => ({
  title: 'Issues',
  queries: [
    {
      id: 'mine',
      label: 'Mine',
      reference: {
        kind: 'inline',
        bindings: {},
        content: {
          name: 'Mine',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          sourceParameters: {},
          query: { source: { pluginId: 'linear', sourceId: 'issues' }, scope: { parameters: {} }, sort: [] },
        },
      },
    },
  ],
  mapping: { columns: [], fields: mapped ? { mine: { status: '/state' } } : {}, values: {}, unmapped: 'catch-all' },
  display: { view: { kind: 'board' }, ...display },
})

describe('dashboard display references', () => {
  it('round-trips an exact and nullable board write value per source', () => {
    const reference = content(false, {}).queries[0]!.reference
    const parsed = panelPlanSchema.parse({
      version: 2,
      title: 'Issues',
      time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
      sources: [{ id: 'mine', label: 'Mine', role: 'primary', reference }],
      columns: [
        {
          id: 'state',
          label: 'State',
          type: 'enum',
          bind: { mine: { field: '/state' } },
          choices: [{ id: 'done', label: 'Done', writeValues: { mine: null } }],
        },
      ],
      stages: [],
      view: { kind: 'board' },
      group: [{ column: 'state' }],
    })
    expect(parsed.columns[0]?.choices?.[0]?.writeValues).toEqual({ mine: null })
    expect(panelPlanSchema.parse(JSON.parse(JSON.stringify(parsed))).columns[0]?.choices?.[0]?.writeValues).toEqual({
      mine: null,
    })
  })
  it('takes panel field ids on a mapped panel and source pointers otherwise', () => {
    expect(dashboardPanelContentSchema.safeParse(content(true, { fields: ['title'], groupBy: 'status' })).success).toBe(
      true,
    )
    expect(
      dashboardPanelContentSchema.safeParse(content(false, { fields: ['/title'], groupBy: '/state' })).success,
    ).toBe(true)
    const wrong = dashboardPanelContentSchema.safeParse(content(true, { groupBy: '/state' }))
    expect(wrong.error?.issues.map((issue) => issue.path)).toEqual([['display', 'groupBy']])
    expect(dashboardPanelContentSchema.safeParse(content(false, { fields: ['status'] })).success).toBe(false)
  })

  it('reads an older stored row by dropping references that cannot resolve', () => {
    const stored = storedDashboardPanelContentSchema.parse(
      content(true, { fields: ['title', '/title'], groupBy: '/state' }),
    )
    expect(stored.display).toEqual({ view: { kind: 'board' }, fields: ['title'] })
  })
})

describe('supplied rows', () => {
  const plan = (reference: Record<string, unknown>) => ({
    version: 2,
    title: 'Forecast',
    time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
    sources: [
      {
        id: 'forecast',
        label: 'Forecast',
        role: 'primary',
        reference: {
          kind: 'supplied',
          origin: { says: 'Open-Meteo forecast for Wellington', urls: ['https://open-meteo.com/'], readAt: 1 },
          schema: {
            type: 'object',
            properties: { day: { type: 'string' }, high: { type: 'number' } },
            required: ['day', 'high'],
          },
          fields: [
            { pointer: '/day', label: 'Day', origin: 'declared' },
            { pointer: '/high', label: 'High', origin: 'declared' },
          ],
          rows: [
            { day: '2026-10-20', high: 17 },
            { day: '2026-10-21', high: 15 },
          ],
          ...reference,
        },
      },
    ],
    columns: [],
    stages: [],
    view: { kind: 'table' },
  })
  const paths = (input: unknown) =>
    panelPlanSchema.safeParse(input).error?.issues.map((issue) => `${issue.path.join('/')}: ${issue.message}`)

  it('carries its rows, origin, schema, and fields', () => {
    const parsed = panelPlanSchema.parse(plan({}))
    expect(parsed.sources[0]!.reference).toMatchObject({ kind: 'supplied', rows: [{ high: 17 }, { high: 15 }] })
  })
  it('names the row and field a value breaks', () => {
    expect(
      paths(
        plan({
          rows: [
            { day: '2026-10-20', high: 17 },
            { day: '2026-10-21', high: 'warm' },
          ],
        }),
      ),
    ).toEqual(['sources/0/reference/rows/1/high: Value does not match number'])
    expect(paths(plan({ rows: [{ day: '2026-10-20' }] }))).toEqual([
      'sources/0/reference/rows/0/high: Missing required field: high',
    ])
  })
  it('refuses rows past the caps, a field the schema lacks, and a link that is not https', () => {
    const many = Array.from({ length: 1001 }, (_, index) => ({ day: String(index), high: index }))
    expect(paths(plan({ rows: many }))?.[0]).toMatch(/^sources\/0\/reference\/rows: /)
    const big = Array.from({ length: 300 }, (_, index) => ({ day: 'x'.repeat(1000), high: index }))
    expect(paths(plan({ rows: big }))).toEqual(['sources/0/reference/rows: Supplied rows are over 256 KiB'])
    expect(paths(plan({ fields: [{ pointer: '/low', label: 'Low', origin: 'declared' }] }))).toEqual([
      "sources/0/reference/fields/0/pointer: /low isn't in the schema",
    ])
    expect(paths(plan({ origin: { says: 'A page', urls: ['javascript:alert(1)'], readAt: 1 } }))).toEqual([
      'sources/0/reference/origin/urls/0: Expected an https URL',
    ])
    expect(paths(plan({ schema: { type: 'array', items: { type: 'string' } } }))).toEqual([
      'sources/0/reference/schema: Supplied rows need an object schema',
    ])
  })
})
