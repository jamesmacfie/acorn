import { describe, expect, it } from 'vitest'
import { type DashboardPanelContent, type PanelPlan } from '@acorn/protocol/dashboards.ts'
import {
  bindColumnField,
  defaultPlanColumns,
  exactStatusOptions,
  unbindMissingFields,
  unpublishedDashboards,
} from './dashboardEditorModel'

const content: DashboardPanelContent = {
  title: 'Issues',
  queries: [],
  mapping: { columns: [{ id: 'doing', label: 'Doing' }], fields: {}, values: {}, unmapped: 'catch-all' },
  display: { view: { kind: 'list' }, fields: [] },
}

describe('dashboard editor model', () => {
  it('starts a panel with the fields a source gives a display role, or its first six', () => {
    const field = (id: string, role?: 'title' | 'status') => ({
      id: `/${id}`,
      name: id,
      type: 'text' as const,
      ...(role ? { role } : {}),
    })
    const roled = defaultPlanColumns('s', [
      field('id'),
      field('name', 'title'),
      field('body'),
      field('state', 'status'),
    ])
    expect(roled.map((column) => column.label)).toEqual(['name', 'state'])
    expect(roled[0]).toEqual({ id: 'name', label: 'name', type: 'text', bind: { s: { field: '/name' } } })
    expect(
      defaultPlanColumns(
        's',
        ['a', 'b', 'c'].map((id) => field(id)),
      ).map((column) => column.id),
    ).toEqual(['a', 'b', 'c'])
    expect(
      defaultPlanColumns(
        's',
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => field(id)),
      ),
    ).toHaveLength(6)
  })

  it('lists unpublished drafts newest first, leaving out published panels', () => {
    const draft = (id: string, updatedAt: number, publishedRevision: number | null) => ({
      id,
      workspaceId: 'workspace',
      content,
      draftRevision: 1,
      basePublishedRevision: publishedRevision,
      publishedRevision,
      createdAt: 1,
      updatedAt,
    })
    expect(
      unpublishedDashboards([draft('published', 30, 1), draft('older', 10, null), draft('newer', 20, null)]).map(
        (entry) => entry.id,
      ),
    ).toEqual(['newer', 'older'])
  })

  it('derives exact dynamic status ids and labels from retained records', () => {
    const options = exactStatusOptions(
      {
        stale: false,
        description: {
          schema: {
            type: 'object',
            properties: { state: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } },
          },
          fields: [
            {
              pointer: '/state/id',
              label: 'State',
              origin: 'declared',
              choices: { kind: 'dynamic', dependsOn: ['/project'] },
            },
          ],
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          parameterFields: [],
          operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
          revision: 'one',
          consistency: 'test',
        },
        preview: {
          records: [
            {
              ref: { pluginId: 'linear', sourceId: 'issues', recordId: 'one' },
              data: { state: { id: 'state-uuid', name: 'In review' } },
            },
          ],
          revision: 'one',
          readTime: 1,
          completeness: { kind: 'complete' },
          mode: 'preview',
          evaluationTime: 1,
        },
      },
      '/state/id',
    )
    expect(options).toEqual([{ id: 'state-uuid', label: 'In review' }])
  })
})

describe('bindColumnField', () => {
  const fields = [
    { id: '/title', name: 'Title', type: 'text' as const },
    { id: '/files', name: 'Modified files', type: 'number' as const },
    { id: '/state', name: 'State', type: 'enum' as const, values: [{ id: 'open', label: 'Open' }] },
  ]
  const fresh = { id: 'newColumn', label: 'New column', type: 'text' as const, bind: {} }

  it('names and types a new column after the field it reads', () => {
    expect(bindColumnField(fresh, 's', '/files', fields, 'New column')).toEqual({
      id: 'newColumn',
      label: 'Modified files',
      type: 'number',
      bind: { s: { field: '/files' } },
    })
    expect(bindColumnField(fresh, 's', '/state', fields, 'New column')).toMatchObject({
      label: 'State',
      type: 'enum',
      choices: [{ id: 'open', label: 'Open' }],
    })
  })

  it("keeps a name the person chose, and follows a field switch only while the name was the field's", () => {
    const renamed = { ...fresh, label: 'Files', type: 'number' as const, bind: { s: { field: '/files' } } }
    expect(bindColumnField(renamed, 's', '/title', fields, 'New column')).toMatchObject({
      label: 'Files',
      type: 'text',
    })
    expect(bindColumnField({ ...renamed, label: 'Modified files' }, 's', '/title', fields, 'New column')).toMatchObject(
      { label: 'Title', type: 'text' },
    )
  })

  it('leaves a column that another source feeds as it was, apart from the binding', () => {
    const shared = { ...fresh, bind: { other: { field: '/name' } } }
    expect(bindColumnField(shared, 's', '/files', fields, 'New column')).toEqual({
      ...shared,
      bind: { other: { field: '/name' }, s: { field: '/files' } },
    })
  })
})

describe('unbindMissingFields', () => {
  it('drops bindings a switched source cannot fill and keeps the rest', () => {
    const columns: PanelPlan['columns'] = [
      { id: 'title', label: 'Title', type: 'text', bind: { tasks: { field: '/title' } } },
      {
        id: 'status',
        label: 'Status',
        type: 'enum',
        bind: { tasks: { field: '/status' }, linear: { field: '/state' } },
      },
      { id: 'updated', label: 'Updated', type: 'text', bind: { tasks: { field: '/updatedAt' } } },
      { id: 'url', label: 'Url', bind: { tasks: { field: '/url' } } },
      { id: 'source', label: 'Source', type: 'text', bind: { tasks: { value: 'Tasks' } } },
    ]
    const github = [
      { id: '/title', type: 'text' },
      { id: '/state', type: 'enum' },
      { id: '/updatedAt', type: 'datetime' },
      { id: '/url', type: 'link' },
    ]
    expect(unbindMissingFields(columns, 'tasks', github).map((column) => column.bind)).toEqual([
      { tasks: { field: '/title' } },
      { linear: { field: '/state' } },
      {},
      { tasks: { field: '/url' } },
      { tasks: { value: 'Tasks' } },
    ])
  })
})
