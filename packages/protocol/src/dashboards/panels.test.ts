import { describe, expect, it } from 'vitest'
import { dashboardPanelContentSchema, storedDashboardPanelContentSchema } from './panels'

const content = (mapped: boolean, display: { fields?: string[]; groupBy?: string }) => ({
  title: 'Issues',
  queries: [{ id: 'mine', label: 'Mine', reference: { kind: 'inline', bindings: {}, content: {
    name: 'Mine', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
    query: { source: { pluginId: 'linear', sourceId: 'issues' }, scope: { parameters: {} }, sort: [] },
  } } }],
  mapping: { columns: [], fields: mapped ? { mine: { status: '/state' } } : {}, values: {}, unmapped: 'catch-all' },
  display: { view: { kind: 'board' }, ...display },
})

describe('dashboard display references', () => {
  it('takes panel field ids on a mapped panel and source pointers otherwise', () => {
    expect(dashboardPanelContentSchema.safeParse(content(true, { fields: ['title'], groupBy: 'status' })).success).toBe(true)
    expect(dashboardPanelContentSchema.safeParse(content(false, { fields: ['/title'], groupBy: '/state' })).success).toBe(true)
    const wrong = dashboardPanelContentSchema.safeParse(content(true, { groupBy: '/state' }))
    expect(wrong.error?.issues.map(issue => issue.path)).toEqual([['display', 'groupBy']])
    expect(dashboardPanelContentSchema.safeParse(content(false, { fields: ['status'] })).success).toBe(false)
  })

  it('reads an older stored row by dropping references that cannot resolve', () => {
    const stored = storedDashboardPanelContentSchema.parse(content(true, { fields: ['title', '/title'], groupBy: '/state' }))
    expect(stored.display).toEqual({ view: { kind: 'board' }, fields: ['title'] })
  })
})
