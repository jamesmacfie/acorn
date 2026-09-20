import { expect, it } from 'vitest'
import { workflowRecoveryStore } from './recoveryStore'

it('preserves unfinished drafts and clears only the acknowledged exact copy', () => {
  const entries = new Map<string, string>()
  const storage = { get length() { return entries.size }, key: (i: number) => [...entries.keys()][i] ?? null,
    getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) }, removeItem: (key: string) => { entries.delete(key) }, clear: () => entries.clear() }
  const store = workflowRecoveryStore(storage)
  const base = { name: 'unfinished', steps: [] }
  const copy = { nodeId: 'node', entityId: 'def', baseRevision: 3, base, local: { ...base, name: 'edited' }, savedAt: 1 }
  expect(store.save(copy)).toBe(true)
  expect(workflowRecoveryStore(storage).latest('node', 'def')).toEqual(copy)
  expect(store.latest('other-node', 'def')).toBeUndefined()
  store.acknowledge(copy, 5, copy.local)
  expect(store.latest('node', 'def')).toEqual(copy)
  store.save({ ...copy, savedAt: 2 })
  store.acknowledge(copy, 4, copy.local)
  expect(store.latest('node', 'def')?.savedAt).toBe(2)
  const newer = store.latest('node', 'def')!
  store.acknowledge(newer, 4, newer.local)
  expect(store.latest('node', 'def')).toBeUndefined()
  expect(workflowRecoveryStore().save(copy)).toBe(false)
})
