import { describe, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { createTreeState } from './treeState'

// The pre-flight check in treeState.ts, which decides whether a whole batch may be applied
// (docs/plugins.md § The tree contract). The drawing half is TreeHost.test.tsx and Slot.test.tsx;
// this file is the arithmetic, so it runs in the bare-Node project.

const transport = { send: () => {}, onBatch: () => () => {}, onFailed: () => () => {} } as never
const now = { schedule: (run: () => void) => (run(), 0), cancel: () => {} }

const host = () => {
  const refusals: string[] = []
  const state = createTreeState({ pluginId: 'perf', transport, scheduler: now, onRefused: (reason) => refusals.push(reason) })
  return { state, refusals }
}

type TreeNode = Extract<TreeMutation, { op: 'insert' }>['node']
const leaf = (id: string, children: TreeNode[] = []): TreeNode => ({ id, type: 'Text', props: {}, children })

describe('a remove takes its whole subtree with it', () => {
  it('refuses a later op addressing a grandchild of a removed node', () => {
    const { state, refusals } = host()
    state._apply([
      { op: 'insert', parent: null, index: 0, node: leaf('parent') },
      { op: 'insert', parent: 'parent', index: 0, node: leaf('child') },
      { op: 'insert', parent: 'child', index: 0, node: leaf('grandchild') },
    ])
    expect(Object.keys(state.nodes)).toHaveLength(3)

    // Both ops in one batch. The grandchild is gone with its grandparent, so patching it is the
    // sandbox and the host disagreeing about the tree, which costs the whole batch.
    state._apply([{ op: 'remove', id: 'parent' }, { op: 'patch', id: 'grandchild', props: { value: 'x' } }])
    expect(refusals.at(-1)).toContain('patch of an unknown node grandchild')
    expect(Object.keys(state.nodes)).toHaveLength(3)
  })
})

describe('a batch edits each child list in op order', () => {
  it('lands inserts, moves and removes where a one-op-at-a-time apply would', () => {
    const { state, refusals } = host()
    state._apply([
      { op: 'insert', parent: null, index: 0, node: leaf('list') },
      { op: 'insert', parent: 'list', index: 0, node: leaf('a') },
      { op: 'insert', parent: 'list', index: 1, node: leaf('b') },
      { op: 'insert', parent: 'list', index: 2, node: leaf('c') },
      { op: 'insert', parent: 'list', index: 1, node: leaf('d') },
      { op: 'move', id: 'c', parent: 'list', index: 0 },
      { op: 'remove', id: 'b' },
      { op: 'insert', parent: null, index: 0, node: leaf('other') },
      { op: 'move', id: 'a', parent: 'other', index: 0 },
    ])
    expect(refusals).toEqual([])
    expect(state.roots()).toEqual(['other', 'list'])
    expect(state.nodes.list!.children).toEqual(['c', 'd'])
    expect(state.nodes.other!.children).toEqual(['a'])
  })

  it('forgets children added earlier in the same batch as their removed parent', () => {
    const { state, refusals } = host()
    state._apply([
      { op: 'insert', parent: null, index: 0, node: leaf('parent') },
      { op: 'insert', parent: 'parent', index: 0, node: leaf('child') },
      { op: 'insert', parent: 'child', index: 0, node: leaf('grandchild') },
      { op: 'remove', id: 'parent' },
    ])
    expect(Object.keys(state.nodes)).toEqual([])
    expect(state.roots()).toEqual([])

    // A leaked parent entry would make this a duplicate id.
    state._apply([{ op: 'insert', parent: null, index: 0, node: leaf('child') }])
    expect(refusals).toEqual([])
    expect(state.roots()).toEqual(['child'])
  })
})

describe('a batch costs its own ops, not the tree', () => {
  it('empties a tree at the node cap without blocking a second', () => {
    const { state, refusals } = host()
    const size = 4_500
    for (let at = 0; at < size; at += 1_500) {
      state._apply(Array.from({ length: Math.min(1_500, size - at) }, (_, i) => ({
        op: 'insert' as const, parent: null, index: at + i, node: leaf(`leaf-${at + i}`),
      })))
    }
    expect(refusals).toEqual([])
    expect(Object.keys(state.nodes)).toHaveLength(size)

    const removes: TreeMutation[] = Array.from({ length: 4_000 }, (_, i) => ({ op: 'remove', id: `leaf-${i}` }))
    const originalIterator = Map.prototype[Symbol.iterator]
    let mapVisits = 0
    const iteratorSpy = vi.spyOn(Map.prototype, Symbol.iterator).mockImplementation(function (this: Map<unknown, unknown>) {
      const iterator = originalIterator.call(this)
      const next = iterator.next.bind(iterator)
      iterator.next = () => {
        const result = next()
        if (!result.done) mapVisits++
        return result
      }
      return iterator
    })
    try {
      state._apply(removes)
    } finally {
      iteratorSpy.mockRestore()
    }

    expect(Object.keys(state.nodes)).toHaveLength(size - 4_000)
    // The pre-flight builds its child index with one scan of the projected tree. The old path
    // scanned the whole projected map for every remove, visiting millions of entries here.
    expect(mapVisits).toBeLessThan(size * 4)
  })
})
