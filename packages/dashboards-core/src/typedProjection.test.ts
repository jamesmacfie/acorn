import { describe, expect, it } from 'vitest'
import type { DashboardQueryProjection } from './typedProjection'
import { dashboardQuerySourceKey, projectDashboardPanel, suggestStateCategoryMapping } from './typedProjection'

const preview = (instanceId: string, state: string, category: string): DashboardQueryProjection => ({
  instanceId,
  label: instanceId,
  query: { source: { pluginId: 'linear', sourceId: 'issues' }, scope: { parameters: {} }, sort: [] },
  description: {
    schema: { type: 'object', properties: { title: { type: 'string' }, state: { type: 'object', properties: { id: { type: 'string' }, category: { type: 'string' } } } } },
    fields: [
      { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
      { pointer: '/state/id', label: 'State', origin: 'declared', display: { kind: 'status', role: 'status' }, choices: { kind: 'static', values: [{ id: 'started', label: 'Started' }, { id: 'review', label: 'Review' }] } },
      { pointer: '/state/category', label: 'Category', origin: 'declared', display: { kind: 'enum' } },
    ],
    parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
    operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
    revision: 'one', consistency: 'test',
  },
  result: {
    records: [{ ref: { pluginId: 'linear', sourceId: 'issues', recordId: instanceId }, data: { title: instanceId, state: { id: state, category } } }],
    revision: 'one', readTime: 1, completeness: { kind: 'complete' }, mode: 'preview', evaluationTime: 1,
  },
})

describe('typed dashboard projection', () => {
  it('keeps mappings independent for two instances of the same source', () => {
    const first = preview('mine', 'started', 'active')
    const second = preview('team', 'review', 'active')
    expect(dashboardQuerySourceKey(first.query, first.instanceId)).not.toBe(dashboardQuerySourceKey(second.query, second.instanceId))
    const projected = projectDashboardPanel({
      title: 'Issues',
      queries: [
        { id: 'mine', label: 'Mine', reference: { kind: 'inline', content: { name: 'Mine', parameters: { type: 'object', properties: {}, additionalProperties: false }, query: first.query, sourceParameters: {} }, bindings: {} } },
        { id: 'team', label: 'Team', reference: { kind: 'inline', content: { name: 'Team', parameters: { type: 'object', properties: {}, additionalProperties: false }, query: second.query, sourceParameters: {} }, bindings: {} } },
      ],
      mapping: {
        columns: [{ id: 'doing', label: 'Doing' }, { id: 'checking', label: 'Checking' }],
        fields: { mine: { title: '/title', status: '/state/id' }, team: { title: '/title', status: '/state/id' } },
        values: { mine: { doing: ['started'] }, team: { checking: ['review'] } },
        unmapped: 'catch-all',
      },
      display: { view: { kind: 'board' }, fields: [], groupBy: 'status' },
    }, [first, second])
    expect(projected.rows.map(row => row.values.status)).toEqual(['doing', 'checking'])
    expect(projected.rows.map(row => row.values.source)).toHaveLength(2)
  })

  it('uses categories only as suggestions and retains exact state identities', () => {
    const source = preview('mine', 'started', 'active')
    source.result.records.push({ ref: { pluginId: 'linear', sourceId: 'issues', recordId: 'two' }, data: { title: 'two', state: { id: 'review', category: 'active' } } })
    expect(suggestStateCategoryMapping(source, '/state/id', '/state/category')).toEqual({
      columns: [{ id: 'active', label: 'active' }],
      values: { active: ['started', 'review'] },
    })
  })
})
