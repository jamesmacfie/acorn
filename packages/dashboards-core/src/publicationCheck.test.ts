import { describe, expect, it } from 'vitest'
import type { DashboardPanelContent } from '@acorn/protocol/dashboards.ts'
import { checkDashboardPanel, type DescribedDashboardQuery } from './publicationCheck'

const query: DescribedDashboardQuery = {
  instanceId: 'mine',
  label: 'My issues',
  query: { source: { pluginId: 'linear', sourceId: 'issues' }, scope: { parameters: {} }, sort: [] },
  description: {
    schema: { type: 'object', properties: { title: { type: 'string' }, points: { type: 'number' }, updatedAt: { type: 'number' }, state: { type: 'string' } } },
    fields: [
      { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
      { pointer: '/points', label: 'Points', origin: 'declared', display: { kind: 'number' } },
      { pointer: '/updatedAt', label: 'Updated', origin: 'declared', display: { kind: 'datetime', role: 'updated' } },
      { pointer: '/state', label: 'State', origin: 'declared', display: { kind: 'status', role: 'status' } },
    ],
    parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
    operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
    revision: 'one', consistency: 'test',
  },
}

const content = (display: Partial<DashboardPanelContent['display']>, mapping: Partial<DashboardPanelContent['mapping']> = {}): DashboardPanelContent => ({
  title: 'Issues',
  queries: [{ id: 'mine', label: 'My issues', reference: { kind: 'inline', bindings: {}, content: {
    name: 'Mine', parameters: { type: 'object', properties: {}, additionalProperties: false }, query: query.query, sourceParameters: {},
  } } }],
  mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all', ...mapping },
  display: { view: { kind: 'list' }, fields: [], ...display },
})

const paths = (value: DashboardPanelContent) => checkDashboardPanel(value, [query]).map(problem => problem.path)

describe('publication check', () => {
  it('accepts a panel whose references all resolve', () => {
    expect(paths(content({ view: { kind: 'stat', aggregate: 'sum', field: '/points' }, fields: ['/title'] }))).toEqual([])
    expect(paths(content({ view: { kind: 'board' }, groupBy: 'status' }, { fields: { mine: { status: '/state' } } }))).toEqual([])
  })

  it('names the path of an unknown field and grouping', () => {
    const problems = checkDashboardPanel(content({ fields: ['/title', '/missing'], groupBy: '/gone' }), [query])
    expect(problems.map(problem => problem.path)).toEqual(['/display/fields/1', '/display/groupBy'])
    expect(problems[0]!.message).toContain('/missing')
  })

  it('refuses a view the projected schema cannot draw', () => {
    const unmapped = { ...query, description: { ...query.description, fields: query.description.fields.slice(0, 2) } }
    expect(checkDashboardPanel(content({ view: { kind: 'board' } }), [unmapped]).map(problem => problem.path)).toEqual(['/display/view/kind'])
  })

  it('refuses view options that name a field of the wrong type', () => {
    expect(paths(content({ view: { kind: 'stat', aggregate: 'avg', field: '/title' } }))).toEqual(['/display/view/field'])
    expect(paths(content({ view: { kind: 'stat', aggregate: 'sum' } }))).toEqual(['/display/view/field'])
    expect(paths(content({ view: { kind: 'chart', shape: 'line', x: '/state' } }))).toEqual(['/display/view/x'])
    expect(paths(content({ view: { kind: 'chart', series: '/points' } }))).toEqual(['/display/view/series'])
  })

  it('refuses a mapped role that points at a field the source does not describe', () => {
    expect(paths(content({}, { fields: { mine: { title: '/title', status: '/removed' } } }))).toEqual(['/mapping/fields/mine/status'])
  })
})
