import { afterEach, describe, expect, it } from 'vitest'
import type { DashboardPanelContent } from '@acorn/protocol/dashboards.ts'
import { makeTestDb } from '../../testkit/db'
import { dashboardStore } from './store'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
const scope = { workspaceId: 'workspace' }
const content = (title = 'Issues'): DashboardPanelContent => ({
  title,
  queries: [{
    id: 'mine', label: 'Mine', reference: { kind: 'inline', bindings: {}, content: {
      name: 'Mine', parameters: { type: 'object', properties: {}, additionalProperties: false },
      query: { source: { pluginId: 'linear', sourceId: 'issues' }, scope: { ...scope, parameters: {} }, sort: [] }, sourceParameters: {},
    } },
  }],
  mapping: { columns: [], fields: {}, values: {}, unmapped: 'catch-all' },
  display: { view: { kind: 'list' }, fields: [] },
})

describe('dashboard draft and publication store', () => {
  it('uses compare-and-swap saves and immutable revisions', () => {
    const test = makeTestDb(); cleanups.push(test.cleanup)
    const store = dashboardStore(test.db)
    const draft = store.create(scope, content())
    const saved = store.save(scope, draft.id, draft.draftRevision, content('Team issues'))
    expect(() => store.save(scope, draft.id, draft.draftRevision, content('Stale'))).toThrow('conflict')
    const first = store.publish(scope, draft.id, saved.draftRevision)
    const changed = store.save(scope, draft.id, saved.draftRevision + 1, content('Changed again'))
    const second = store.publish(scope, draft.id, changed.draftRevision)
    expect(first.revision).toBe(1)
    expect(second.revision).toBe(2)
    expect(store.published(scope, draft.id, 1).content.title).toBe('Team issues')
    expect(store.published(scope, draft.id).content.title).toBe('Changed again')
  })

  it('keeps project drafts out of workspace-wide reads', () => {
    const test = makeTestDb(); cleanups.push(test.cleanup)
    const store = dashboardStore(test.db)
    store.create(scope, content('Workspace'))
    store.create({ ...scope, projectId: 'project' }, content('Project'))
    expect(store.list(scope).map(draft => draft.content.title)).toEqual(['Workspace'])
    expect(store.list({ ...scope, projectId: 'project' }).map(draft => draft.content.title).sort()).toEqual(['Project', 'Workspace'])
  })
})
