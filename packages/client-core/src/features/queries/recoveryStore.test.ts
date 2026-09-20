import { describe, expect, it } from 'vitest'
import { queryContentSchema, type QueryRecovery, type QueryDraft } from '@acorn/protocol/dataQueries.ts'
import { queryRecoveryStore } from './recoveryStore'

function storage() {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}
const content = queryContentSchema.parse({ name: 'Draft', parameters: { type: 'object', additionalProperties: false }, query: { source: { pluginId: 'missing', sourceId: 'items' }, scope: { workspaceId: 'workspace' } } })
const copy: QueryRecovery = { nodeId: 'node', entityId: 'query', baseRevision: 1, baseContent: content, content, savedAt: 1 }
const remote: QueryDraft = { id: 'query', workspaceId: 'workspace', content, draftRevision: 2, publishedRevision: null, basePublishedRevision: null, createdAt: 1, updatedAt: 2 }

describe('query draft recovery', () => {
  it('restores by entity even after the Node base revision changes and isolates Nodes', () => {
    const disk = storage()
    const store = queryRecoveryStore(disk)
    expect(store.save(copy)).toBe('saved-on-device')
    expect(queryRecoveryStore(disk).list('node', 'query')).toEqual([copy])
    expect(store.list('another-node', 'query')).toEqual([])
    expect(store.reconcile(copy, remote)).toBe('conflict')
    expect(store.read('node', 'query', 1)).toEqual(copy)
  })
  it('clears only the acknowledged copy and retains edits made during an in-flight save', () => {
    const store = queryRecoveryStore(storage())
    store.save(copy)
    const newer = { ...copy, content: { ...content, name: 'Later edit' }, savedAt: 2 }
    store.save(newer)
    expect(store.acknowledge(copy, remote)).toBe(false)
    expect(store.list('node', 'query')).toEqual([newer])
    expect(store.acknowledge(newer, { ...remote, content: newer.content })).toBe(true)
    expect(store.list('node', 'query')).toEqual([])
  })
  it('reports storage failure honestly and never promotes a local write to Node acknowledgment', () => {
    expect(queryRecoveryStore().save(copy)).toBe('not-saved')
    expect(queryRecoveryStore({ ...storage(), setItem: () => { throw new Error('quota') } }).save(copy)).toBe('not-saved')
  })
})
