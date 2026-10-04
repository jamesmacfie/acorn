import { describe, expect, it } from 'vitest'
import { dashboardPanelContentSchema, type DashboardPanelContent, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import type { SourceQueryEditorState } from '../dataSources/SourceQueryEditor'
import {
  addStatusColumns, applyCategoryColumns, availableDashboardViews, defaultPlanColumns, displaySchema, emptyDashboardContent, exactStatusOptions,
  latestUnpublishedDashboard, mapExactStatus, setDashboardQuery, setFieldVisible, suggestRoleFields, unavailableViewReason, unbindMissingFields,
} from './dashboardEditorModel'

const query = { kind: 'inline' as const, bindings: {}, content: {
  name: 'Issues', parameters: { type: 'object' as const, properties: {}, additionalProperties: false,
  }, query: { source: { pluginId: 'linear', sourceId: 'issues' }, scope: { workspaceId: 'workspace', parameters: {} }, sort: [] }, sourceParameters: {},
} }
const content: DashboardPanelContent = {
  title: 'Issues', queries: [], mapping: { columns: [{ id: 'doing', label: 'Doing' }], fields: {}, values: {}, unmapped: 'catch-all' },
  display: { view: { kind: 'list' }, fields: [] },
}

describe('dashboard editor model', () => {
  it('starts a panel with the fields a source gives a display role, or its first six', () => {
    const field = (id: string, role?: 'title' | 'status') => ({ id: `/${id}`, name: id, type: 'text' as const, ...(role ? { role } : {}) })
    const roled = defaultPlanColumns('s', [field('id'), field('name', 'title'), field('body'), field('state', 'status')])
    expect(roled.map(column => column.label)).toEqual(['name', 'state'])
    expect(roled[0]).toEqual({ id: 'name', label: 'name', type: 'text', bind: { s: { field: '/name' } } })
    expect(defaultPlanColumns('s', ['a', 'b', 'c'].map(id => field(id))).map(column => column.id)).toEqual(['a', 'b', 'c'])
    expect(defaultPlanColumns('s', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => field(id)))).toHaveLength(6)
  })

  it('keeps display edits separate from query semantics', () => {
    const withQuery = setDashboardQuery(content, 'mine', query)
    const displayed = { ...withQuery, display: { ...withQuery.display, view: { kind: 'table' as const }, fields: ['/title'] } }
    expect(displayed.queries).toEqual(withQuery.queries)
    expect(displayed.queries[0]!.reference).toBe(query)
  })

  it('suggests semantic roles without replacing explicit choices', () => {
    const first = suggestRoleFields(content.mapping, 'mine', [
      { pointer: '/name', label: 'Name', origin: 'declared', display: { kind: 'text', role: 'title' } },
      { pointer: '/state/id', label: 'State', origin: 'declared', display: { kind: 'status', role: 'status' } },
    ])
    const retained = suggestRoleFields({ ...first, fields: { mine: { ...first.fields.mine, title: '/summary' } } }, 'mine', [
      { pointer: '/name', label: 'Name', origin: 'declared', display: { kind: 'text', role: 'title' } },
    ])
    expect(retained.fields.mine).toMatchObject({ title: '/summary', status: '/state/id' })
  })

  it('uses a finite state field as the status suggestion and offers board after explicit mapping', () => {
    const fields = [
      { pointer: '/state', label: 'State', origin: 'dynamic' as const, choices: { kind: 'dynamic' as const, dependsOn: ['/project'] } },
    ]
    const mapping = suggestRoleFields(content.mapping, 'mine', fields)
    expect(mapping.fields.mine?.status).toBe('/state')
    const states: Record<string, SourceQueryEditorState> = { mine: {
      stale: false,
      query: query.content.query,
      description: {
        schema: { type: 'object', properties: { state: { type: 'string' } } }, fields,
        parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
        operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] }, revision: 'one', consistency: 'test',
      },
    } }
    expect(availableDashboardViews(states, mapping)).toContain('board')
    expect(displaySchema(states, mapping).fields.map(field => field.id)).toContain('status')
    expect(displaySchema(states, mapping).fields.map(field => field.id)).not.toContain('/state')
  })

  it('moves an exact status identity between columns instead of duplicating it', () => {
    const first = mapExactStatus({ ...content.mapping, columns: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }, 'mine', 'started-id', 'one')
    const second = mapExactStatus(first, 'mine', 'started-id', 'two')
    expect(second.values.mine).toEqual({ one: [], two: ['started-id'] })
  })

  it('retains incompatible field and status mappings when a query changes', () => {
    const mapped: DashboardPanelContent = {
      ...setDashboardQuery(content, 'mine', query),
      mapping: {
        ...content.mapping,
        fields: { mine: { title: '/removed/title', status: '/removed/state' } },
        values: { mine: { doing: ['removed-state-id'] } },
      },
    }
    const changed = setDashboardQuery(mapped, 'mine', {
      ...query,
      content: { ...query.content, query: { ...query.content.query, source: { pluginId: 'github', sourceId: 'pulls' } } },
    })
    expect(changed.mapping).toEqual(mapped.mapping)
    expect(exactStatusOptions({ stale: true }, changed.mapping.fields.mine?.status)).toEqual([])
  })

  it('explains unavailable view prerequisites', () => {
    expect(availableDashboardViews({})).not.toContain('board')
    expect(unavailableViewReason('board')).toContain('fixed set of values')
    expect(unavailableViewReason('chart')).toContain('date field')
  })

  it('resumes the newest unpublished draft without replacing a placed publication', () => {
    const draft = (id: string, updatedAt: number, publishedRevision: number | null) => ({
      id, workspaceId: 'workspace', content, draftRevision: 1, basePublishedRevision: publishedRevision,
      publishedRevision, createdAt: 1, updatedAt,
    })
    expect(latestUnpublishedDashboard([
      draft('published', 30, 1), draft('older', 10, null), draft('newer', 20, null),
    ])?.id).toBe('newer')
  })

  it('derives exact dynamic status ids and labels from retained records', () => {
    const options = exactStatusOptions({
      stale: false,
      description: {
        schema: { type: 'object', properties: { state: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } } },
        fields: [{ pointer: '/state/id', label: 'State', origin: 'declared', choices: { kind: 'dynamic', dependsOn: ['/project'] } }],
        parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
        operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] }, revision: 'one', consistency: 'test',
      },
      preview: {
        records: [{ ref: { pluginId: 'linear', sourceId: 'issues', recordId: 'one' }, data: { state: { id: 'state-uuid', name: 'In review' } } }],
        revision: 'one', readTime: 1, completeness: { kind: 'complete' }, mode: 'preview', evaluationTime: 1,
      },
    }, '/state/id')
    expect(options).toEqual([{ id: 'state-uuid', label: 'In review' }])
  })

  describe('drafts built through the model parse with the panel schema', () => {
    const issueState = (instanceId: string): SourceQueryEditorState => ({
      stale: false,
      query: query.content.query,
      description: {
        schema: { type: 'object', properties: { title: { type: 'string' }, state: { type: 'string' }, category: { type: 'string' } } },
        fields: [
          { pointer: '/title', label: 'Title', origin: 'declared', display: { kind: 'text', role: 'title' } },
          { pointer: '/state', label: 'State', origin: 'declared', display: { kind: 'status', role: 'status' },
            choices: { kind: 'static', values: [{ id: 'todo', label: 'Todo' }, { id: 'done', label: 'Done' }] } },
          { pointer: '/category', label: 'Category', origin: 'declared' },
        ],
        parameters: { type: 'object', properties: {}, additionalProperties: false }, parameterFields: [],
        operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] }, revision: instanceId, consistency: 'test',
      },
    })
    const withQuery = (current: DashboardPanelContent, id: string, states: Record<string, SourceQueryEditorState>) => {
      const next = setDashboardQuery(current, id, query)
      return { ...next, mapping: suggestRoleFields(next.mapping, id, states[id]!.description!.fields) }
    }

    it('builds a board', () => {
      const states = { mine: issueState('mine') }
      let board = withQuery(emptyDashboardContent(), 'mine', states)
      board = { ...board, display: { ...board.display, view: { kind: 'board' } } }
      board = addStatusColumns(board, states)
      board = applyCategoryColumns(board, 'mine', { columns: [{ id: 'open', label: 'Open' }], values: { open: ['todo'] } })
      board = setFieldVisible(board, states, 'assignee', false)
      expect(board.display.groupBy).toBe('status')
      expect(board.display.fields).toEqual(['title', 'status'])
      expect(dashboardPanelContentSchema.safeParse(board).success).toBe(true)
    })

    it('builds a combined panel', () => {
      const states = { mine: issueState('mine'), team: issueState('team') }
      let combined = withQuery(withQuery(emptyDashboardContent(), 'mine', states), 'team', states)
      combined = setFieldVisible(combined, states, 'source', false)
      expect(combined.display.fields).toEqual(['title', 'status'])
      expect(dashboardPanelContentSchema.safeParse(combined).success).toBe(true)
      // A source pointer on a mapped panel names nothing in its projected schema.
      expect(dashboardPanelContentSchema.safeParse({ ...combined, display: { ...combined.display, groupBy: '/state' } }).success).toBe(false)
    })
  })
})

describe('unbindMissingFields', () => {
  it('drops bindings a switched source cannot fill and keeps the rest', () => {
    const columns: PanelPlan['columns'] = [
      { id: 'title', label: 'Title', type: 'text', bind: { tasks: { field: '/title' } } },
      { id: 'status', label: 'Status', type: 'enum', bind: { tasks: { field: '/status' }, linear: { field: '/state' } } },
      { id: 'updated', label: 'Updated', type: 'text', bind: { tasks: { field: '/updatedAt' } } },
      { id: 'url', label: 'Url', bind: { tasks: { field: '/url' } } },
      { id: 'source', label: 'Source', type: 'text', bind: { tasks: { value: 'Tasks' } } },
    ]
    const github = [{ id: '/title', type: 'text' }, { id: '/state', type: 'enum' }, { id: '/updatedAt', type: 'datetime' }, { id: '/url', type: 'link' }]
    expect(unbindMissingFields(columns, 'tasks', github).map(column => column.bind)).toEqual([
      { tasks: { field: '/title' } },
      { linear: { field: '/state' } },
      {},
      { tasks: { field: '/url' } },
      { tasks: { value: 'Tasks' } },
    ])
  })
})
