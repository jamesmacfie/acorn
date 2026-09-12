import { describe, expect, it } from 'vitest'
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
    const started = performance.now()
    state._apply(removes)
    const elapsed = performance.now() - started

    expect(Object.keys(state.nodes)).toHaveLength(size - 4_000)
    // A wall-clock bound rather than a counter, because the cost this guards is a nested walk and
    // there is nothing else to count. It is deliberately loose: the same batch took 1,104 ms when the
    // pre-flight scanned every live node per `remove`, and a few tens of milliseconds now, so a
    // machine four times slower than this one still passes and a return to the old shape still fails.
    expect(elapsed).toBeLessThan(400)
  })
})
