import { describe, expect, it } from 'vitest'
import type { DataSourceDescription, DataSourceQuery, DataSourceResult } from '@acorn/protocol/dataSources.ts'
import {
  beginPreview, editPreview, initialPreviewState, previewIsStale, resolvePreview, setScopeParameter,
} from './editorModel'

const description: DataSourceDescription = {
  revision: '1', consistency: 'fixture',
  schema: { type: 'object', properties: { state: { type: 'string' } }, required: ['state'] },
  fields: [{ pointer: '/state', label: 'State', origin: 'declared', query: { operators: ['eq'], sortable: false }, choices: { kind: 'dynamic', dependsOn: ['/project'] } }],
  parameters: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'], additionalProperties: false },
  parameterFields: [{ pointer: '/project', label: 'Project', origin: 'declared', choices: { kind: 'dynamic', dependsOn: [] } }],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
}

const query: DataSourceQuery = {
  source: { pluginId: 'linear', sourceId: 'issues' },
  scope: { workspaceId: 'w', projectId: 'p', connectionId: 'c', parameters: { project: 'old' } },
  predicate: { kind: 'all', predicates: [{ kind: 'comparison', left: { address: { from: 'item', pointer: '/state' } }, operator: 'eq', right: { address: { from: 'literal', value: 'started' } } }] },
  sort: [],
}

const result = (id: string): DataSourceResult => ({
  mode: 'preview', evaluationTime: 1, revision: '1', readTime: 1, completeness: { kind: 'complete' },
  records: [{ ref: { pluginId: 'fixture', sourceId: 'records', recordId: id }, data: { id } }],
})

describe('shared source editor model', () => {
  it('invalidates a dependent state selection when its project changes', () => {
    const changed = setScopeParameter(query, description, '/project', 'new')
    expect(changed.query.scope.parameters).toEqual({ project: 'new' })
    expect(changed.invalidated).toEqual(['/state'])
    expect(changed.query.predicate).toBeUndefined()
  })

  it('retains prior rows while edits mark them stale and ignores an obsolete response', () => {
    const first = beginPreview(initialPreviewState('first'))
    let state = resolvePreview(first.state, first.token, result('first'))
    state = editPreview(state, 'second')
    expect(previewIsStale(state)).toBe(true)
    expect(state.result?.records[0]?.ref.recordId).toBe('first')

    const second = beginPreview(state)
    state = resolvePreview(second.state, first.token, result('obsolete'))
    expect(state.result?.records[0]?.ref.recordId).toBe('first')
    state = resolvePreview(state, second.token, result('second'))
    expect(state.result?.records[0]?.ref.recordId).toBe('second')
    expect(previewIsStale(state)).toBe(false)
  })

  it('does not begin a preview merely because the query digest changed', () => {
    const state = editPreview(initialPreviewState('first'), 'typed-but-not-refreshed')
    expect(state.generation).toBe(0)
    expect(state.loading).toBe(false)
    expect(state.requestedDigest).toBeUndefined()
  })
})
